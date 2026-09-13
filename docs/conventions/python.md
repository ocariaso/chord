# Python conventions

Observed in [`server/`](../../server/). Python 3.10, 4-space indent, double quotes, ~110 column
lines.

## Layering

Dependencies run strictly downward, and nothing imports back up:

```
api/        →  pipeline/, db/, models/
pipeline/   →  db/, models/, core/     (pipeline.py → the leaf modules)
db/         →  core/
models/     →  nothing
core/       →  nothing
```

**`pipeline/pipeline.py` is the only module that writes job status**, and the only one that
knows the stage order. Every other pipeline module is a leaf: a value or artifact in, a value
or artifact out, no database access. That's what would let the worker be replaced with a real
broker without touching them.

**API handlers don't do work.** They validate, read or write the row, and serve files. The one
documented exception is the lyrics endpoint — see
[../architecture/decisions.md](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline).

## Type hints

On every signature, using modern syntax:

```python
def download_audio(url: str, output_dir: Path) -> tuple[Path, str, str | None]: ...
def extract_author(audio_path: Path) -> str | None: ...
def analyze_audio(audio_path: Path) -> tuple[list[ChordSegment], KeyEstimate]: ...
```

`X | None`, not `Optional[X]`; `list[X]` / `dict[K, V]`, not `typing.List`. `pathlib.Path` for
every filesystem path — never a string, except where an external library demands one
(`str(audio_path)` at madmom and Demucs call boundaries).

Un-annotated returns appear only where the value is an opaque `sqlite3.Row`
(`_get_job_row(job_id)`).

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

Used in [`separation.py`](../../server/app/pipeline/separation.py) and three times in
[`chords.py`](../../server/app/pipeline/chords.py). The unguarded `global` is safe **only
because a single worker thread calls these**. Introducing concurrency means adding a lock.

## Error handling

Three distinct patterns, each for a different purpose:

**1. One catch-all at the orchestrator**, so no failure can escape without reaching the user:

```python
except Exception as exc:  # noqa: BLE001 - any failure must reach the job row
    if _is_cancelled(job_id):
        return
    logger.exception("Job %s failed", job_id)
    _update_job(job_id, status=JobStatus.ERROR.value, error_message=str(exc))
```

Note the cancellation re-check first — a cancelled job that blew up mid-stage stays `cancelled`
rather than being overwritten with `error`.

**2. A domain exception carrying a user-facing message**, because `str(exc)` reaches the
browser:

```python
class SourceDownloadError(Exception):
    """Raised with a message safe to show directly to the user."""
```

**3. Narrow catches that degrade**, for optional features:

```python
try:
    result = subprocess.run([...], capture_output=True, timeout=15, text=True)
except (OSError, subprocess.TimeoutExpired) as exc:
    logger.warning("ffprobe metadata read failed for %s: %s", audio_path, exc)
    return None
```

Every broad `except Exception` carries a `# noqa: BLE001` with the reason. `logger.exception`
for unexpected failures (it includes the traceback), `logger.warning` for expected degradation.

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
- Explicit `status_code=` where it isn't 200 (`status.HTTP_202_ACCEPTED`,
  `status.HTTP_204_NO_CONTENT`).
- `HTTPException(status_code=..., detail="...")` with a message written for a human — `detail`
  reaches the user verbatim through the client.
- `async def` by default; **plain `def` when the body blocks**, so FastAPI runs it in a
  threadpool. `download_stems` is `def` for exactly this reason, and that should be preserved.
