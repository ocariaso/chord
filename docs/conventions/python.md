# Python conventions

Observed in [`server/`](../../server/). Python 3.10, 4-space indent, double quotes, ~110 column
lines.

## Layering

Dependencies run strictly downward, and nothing imports back up:

```text
api/        →  pipeline/, db/, models/
pipeline/   →  db/, models/, core/     (pipeline.py → the leaf modules)
db/         →  core/
models/     →  nothing
core/       →  nothing
```

**`pipeline/pipeline.py` is the only pipeline module that touches the database**, and the only
one that knows the stage order. Every other pipeline module is a leaf: a value or artifact in, a
value or artifact out, no database access. [`errors.py`](../../server/app/pipeline/errors.py),
the exceptions that carry a message for the user, imports nothing at all. That's what would let
the worker be replaced with a real broker without touching them.

The API writes the row too, but only for the transitions a person asks for: create, cancel,
resume and discard.

**API handlers don't do work.** They validate, read or write the row, and serve files. The one
documented exception is the lyrics lookup — see
[../architecture/decisions.md](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline).
Saving pasted lyrics is parsing plus one file write.

## Type hints

On every signature, using modern syntax:

```python
def download_audio(url: str, output_dir: Path, max_duration_seconds: float) -> tuple[Path, str, str | None]: ...
def read_audio_info(audio_path: Path) -> tuple[float, str]: ...
def separate(input_path: Path, output_dir: Path, on_progress: Callable[[float], None] | None = None) -> list[str]: ...
```

`X | None`, not `Optional[X]`; `list[X]` / `dict[K, V]`, not `typing.List`; `Callable` from
`collections.abc`. `pathlib.Path` for every filesystem path — never a string, except where an
external library demands one (`str(...)` at the soundfile, madmom and Demucs `save_audio` call
boundaries).

Un-annotated signatures are the exception: helpers that pass an opaque `sqlite3.Row` around
(`_get_job_row(job_id)`, `_row_to_response(row)`), and generator plumbing (`db_cursor`, the SSE
`event_stream`).

## Pydantic

Request/response models and enums live in
[`models/schemas.py`](../../server/app/models/schemas.py) and nowhere else. `JobStatus` is a
`str, Enum` so `.value` is a plain string for SQLite and JSON:

```python
class JobStatus(str, Enum):
    QUEUED = "queued"
```

Always compare with `.value` against a database column:
`row["status"] == JobStatus.CANCELLED.value`.

Request limits are declared on the model, so FastAPI rejects an oversized body with a 422 before
the handler runs:

```python
class SaveLyricsRequest(BaseModel):
    text: str = Field(max_length=100_000)
```

Settings are a `pydantic_settings.BaseSettings` subclass, which makes every field an
environment variable automatically. See
[../operations/configuration.md](../operations/configuration.md).

## Database access

Always through the context manager; never a bare connection:

```python
with db_cursor() as cur:
    cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = cur.fetchone()
```

- **Parameterized queries, always.** The one place SQL is built dynamically is `_update_job`,
  which interpolates the *keys* of its `**fields` and binds the values — safe as written because
  every call site passes literal keyword names. Keep them literal.
- Rows are `sqlite3.Row`, so access by column name.
- Commit is implicit on normal exit; an exception discards the transaction.

### Pipeline writes are scoped to the run

`run_job` reads the row's `attempt` once, at the start, and every write it makes goes through
`_update_job` with that value:

```python
def _update_job(job_id: str, attempt: int, **fields) -> None:
    # Scoped to this run, so a superseded attempt or a job the user cancelled is never overwritten.
    fields["updated_at"] = now_iso()
    columns = ", ".join(f"{key} = ?" for key in fields)
    with db_cursor() as cur:
        cur.execute(
            f"UPDATE jobs SET {columns} WHERE id = ? AND attempt = ? AND status != ?",
            (*fields.values(), job_id, attempt, JobStatus.CANCELLED.value),
        )
```

Checkpoints between stages call `_is_superseded(job_id, attempt)` — row gone, `cancelled`, or
`attempt` moved on — and return. Any new pipeline write must take the `attempt` too: an unscoped
`UPDATE` can overwrite a cancel, or clobber the run a resume started. The cost of the guard is that
a cancelled run's writes vanish silently, useful ones included, so a value a later attempt can't
produce again needs a deliberate exception. There is one: `_record_track_identity` writes a
download's title and author by id alone, because a resume skips the download that found them. It
touches no status, progress or result column. See [resume](../api/jobs.md#post-jobsjob_idresume).

Before any of that, `run_job` returns unless the row is `queued`. A job cancelled while it waited
and then resumed is in the in-memory queue twice, and the check is what stops the second entry from
running it again once the first has.

## Lazy singletons for expensive models

Model loading is deferred and cached at module level, guarded by a `None` check:

```python
_separator: Separator | None = None

def _get_separator() -> Separator:
    global _separator
    if _separator is None:
        _separator = Separator(model=settings.demucs_model, device=_resolve_device())
    return _separator
```

Used in [`separation.py`](../../server/app/pipeline/separation.py) and for the three madmom
processors in [`chords.py`](../../server/app/pipeline/chords.py). The unguarded `global` is safe
**only because a single worker thread calls these**. The separator also carries per-job state:
`separate()` swaps its progress callback in with `update_parameter(callback=…)` on every call.
Introducing concurrency means adding a lock — or a separator per job.

## Error handling

Four patterns, each for a different purpose:

**1. One catch-all at the orchestrator**, so no failure can escape without reaching the user:

```python
except _Superseded:
    return
except Exception as exc:  # noqa: BLE001 - any failure must reach the job row
    if _is_superseded(job_id, attempt):
        return
    logger.exception("Job %s failed", job_id)
    error_message, error_log = _describe_failure(stage, exc)
    failure = dict(status=JobStatus.ERROR.value, error_message=error_message, error_log=error_log)
    # Reading the audio falls between stages, so a failure there must not keep the finished download's
    # message: the row would name a stage that had already succeeded.
    if stage == "reading":
        failure["stage_message"] = None
    _update_job(job_id, attempt, **failure)
```

The superseded re-check comes first — a run that blew up after being cancelled or resumed stays
out of the row. `run_job` tracks which `stage` it is in (`downloading`, `reading`, `separating`,
`tempo`, `analyzing`) so `_describe_failure` can pick a sentence for anything unexpected, and so a
failure while reading clears a stage message that would name a stage already finished.

**2. `UserFacingError` for a message written for a person.** Only its subclasses reach the user
verbatim. Any other exception becomes the stage's fixed sentence from `_STAGE_FAILURE_MESSAGES`,
with `"<Type>: <message>"` in `error_log`, so a raw exception string never lands where the user
reads. Raise one where you can say something useful, and chain the underlying exception — its
text becomes the job's log:

```python
except yt_dlp.utils.DownloadError as exc:
    logger.warning("yt-dlp failed for %s: %s", url, exc)
    raise SourceDownloadError(
        "Couldn't download audio from that link. Check that the URL is correct and publicly accessible."
    ) from exc
```

Subclasses live in [`errors.py`](../../server/app/pipeline/errors.py) — `TrackTooLongError`
builds its message from the numbers — or beside the code that raises them, like
`SourceDownloadError` in `source.py`. Without `from exc`, `error_log` is `NULL`.

**3. An exception as a stop signal inside third-party work.** Demucs has no cancel, but it calls a
progress callback per chunk. Raising `_Superseded` from that callback abandons the pass, and
`run_job` catches it by name and returns without writing:

```python
if time.monotonic() - last_poll >= _SUPERSEDED_POLL_SECONDS:
    last_poll = time.monotonic()
    if _is_superseded(job_id, attempt):
        raise _Superseded
```

**4. Narrow catches that degrade**, for optional features:

```python
try:
    result = subprocess.run([...], capture_output=True, timeout=15, text=True)
except (OSError, subprocess.TimeoutExpired) as exc:
    logger.warning("ffprobe metadata read failed for %s: %s", audio_path, exc)
    return None
```

Whether to degrade is a question of whether anything downstream can do without the value. In
[`metadata.py`](../../server/app/pipeline/metadata.py), `extract_author` degrades to `None`, while
`read_audio_info` in the same file deliberately doesn't catch: nothing after it can run without a
duration.

The two orchestration-level `except Exception` blocks — in `run_job` and the worker loop — carry a
`# noqa: BLE001` with the reason; `estimate_lyrics_offset`'s broad catch, which degrades to no
correction, does not. `logger.exception` for unexpected failures (it includes the traceback),
`logger.warning` for expected degradation.

## Logging

`logger = logging.getLogger(__name__)` at module top. Lazy `%s` formatting, never f-strings, so
the interpolation is skipped when the level is disabled:

```python
logger.warning("yt-dlp failed for %s: %s", url, exc)
```

No structured logging, no metrics — stderr is the whole story.

## Subprocesses

External tools are invoked with an argument list (never `shell=True`), always with a timeout,
always with `capture_output=True`, and always checked beyond the return code:

```python
return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0
```

That last check matters: ffmpeg can exit 0 having written a zero-byte file when there was no
cover art to extract.

## FastAPI routes

- One `APIRouter` per module with a `prefix` and `tags`.
- `response_model=` on everything that returns data, so the OpenAPI schema stays accurate.
- Explicit `status_code=` where it isn't 200 (`status.HTTP_202_ACCEPTED` on the create and resume
  endpoints, `status.HTTP_204_NO_CONTENT` on discard).
- `HTTPException(status_code=..., detail="...")` with a message written for a human — the
  client's write functions show `detail` to the user verbatim.
- `async def` by default; **plain `def` when the body blocks**, so FastAPI runs it in a
  threadpool. `download_stems` (an in-memory zip) and `get_lyrics` (lrclib requests and a read of
  the vocals stem) are `def` for exactly this reason, and that should be preserved.
  When a single call in an `async` handler blocks, it goes through `run_in_threadpool` instead —
  `create_job` copies the upload to disk that way.
- A docstring on a handler whose semantics its name doesn't carry (`resume_job`, `discard_job`,
  `save_lyrics`).
