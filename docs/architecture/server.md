# Server architecture

FastAPI service in [`server/`](../../server/). Python 3.10 (pinned by the Dockerfile base image
and by madmom's compatibility ceiling), uvicorn, SQLite.

## Startup

[`app/main.py`](../../server/app/main.py) is the whole assembly:

1. `os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))` — set **before**
   anything imports torch. demucs reaches it only on its fallback path; the weights it normally
   loads are baked into the image under `HF_HOME` (see
   [../operations/configuration.md](../operations/configuration.md#demucs-weights)).
2. `lifespan` → `init_db()` then `start_worker()`.
3. CORS middleware from `settings.cors_origins` (default `["http://localhost:5173"]`, the Vite
   dev server). In the Docker deployment CORS is irrelevant — nginx proxies `/api` so the
   browser sees one origin.
4. Three routers, all mounted at prefix `/jobs`, plus `GET /health`.

Note that `settings` itself has a side effect at import time:
[`config.py`](../../server/app/core/config.py) calls `mkdir(parents=True, exist_ok=True)` on
`jobs_dir` and `models_cache_dir`.

## Configuration

[`app/core/config.py`](../../server/app/core/config.py) is a `pydantic_settings.BaseSettings`
subclass, so **every field is overridable by an environment variable of the same name**
(case-insensitive):

| Field | Default | Notes |
| --- | --- | --- |
| `data_dir` | `<server>/data` | derived from `SERVER_DIR`, the repo's `server/` directory |
| `db_path` | `<server>/data/db.sqlite3` | not derived from `data_dir` — set both if you move it |
| `jobs_dir` | `<server>/data/jobs` | same caveat |
| `models_cache_dir` | `<server>/data/models_cache` | becomes `TORCH_HOME`, demucs' fallback download cache |
| `demucs_model` | `htdemucs_6s` | the 6-source model; see [../features/stem-separation.md](../features/stem-separation.md). The Docker image sets it from the build argument whose weights it carries. The processing screen's *Six-source model* label is hardcoded, not read from this |
| `device` | `cuda` | `DEVICE=cpu` in the CPU Compose path; falls back to CPU if CUDA is absent |
| `enable_chord_detection` | `True` | set false to skip the madmom stage entirely |
| `max_duration_seconds` | `720` | longer tracks are refused before separation — a URL job from yt-dlp's metadata, before downloading; `0` disables. The landing page's *"up to 12 minutes"* is hardcoded against this default |
| `cors_origins` | `["http://localhost:5173"]` | |

The four path fields are independent defaults, not layered on each other. Overriding
`DATA_DIR` alone will *not* move the database or the jobs directory.

## The API layer

Three routers, all under `/jobs`, split by concern rather than by path:

- [`routes_jobs.py`](../../server/app/api/routes_jobs.py) — create (from an upload or a URL),
  list, read, cancel, resume, discard, and the SSE event stream.
- [`routes_stems.py`](../../server/app/api/routes_stems.py) — static artifact serving:
  thumbnail, one stem, all stems as a zip.
- [`routes_analysis.py`](../../server/app/api/routes_analysis.py) — chords, the lyrics lookup,
  and saving pasted lyrics.

Shared helpers live where they are used rather than in a common module: `job_dir()` comes from
`pipeline.pipeline`, `THUMBNAIL_FILENAME` from `pipeline.thumbnail`, and `_row_to_response()` /
`_get_job_row()` / `TERMINAL_STATUSES` are private to `routes_jobs.py`. (`pipeline.py` has a
`_get_job_row` of its own, which returns `None` for a missing row where the API's raises 404.)

`_row_to_response()` maps columns to fields one by one, so a new column is invisible to clients
until it is added there — `error_log` and `audio_format` are; `attempt` deliberately isn't. Two
fields are computed rather than stored:

- `stem_names` is `STEM_NAMES` when the job is `done`, `[]` otherwise. It is **not** the actual
  directory listing — it's the constant list from `schemas.py`. A job that somehow produced
  fewer stems would still advertise six.
- `has_thumbnail` is a filesystem `.exists()` check on every serialization, including every
  0.5s SSE tick.

`create_job` accepts `.mp3` and `.flac` by extension only, then copies the upload into
`original.<ext>` with `shutil.copyfileobj` in 1 MB chunks, through `run_in_threadpool`: the
handler is `async`, and a blocking copy of a file that can run to hundreds of MB would otherwise
stall the event loop, every open SSE stream included. The body has already arrived by then —
nginx buffers request bodies before proxying, and Starlette spools the multipart file to a
temporary file — so the chunked copy keeps the upload out of process memory rather than streaming
it off the network. An empty file is a 400, and the job directory is removed with it. Nothing
here checks the audio's duration; the pipeline does.

`GET /jobs/{id}/lyrics` blocks for longer still, so it is a plain `def` and FastAPI runs the
whole handler in its threadpool. On a cache miss it calls lrclib through a synchronous
`httpx.Client` (10 s timeout per request, up to two requests per title guess) and, when it finds
synced lyrics, reads the whole vocals WAV to estimate their offset — seconds of work that would
stall every other request, SSE streams included, if it ran on the event loop.
`PUT /jobs/{id}/lyrics` only parses the pasted text and writes the cache file, and stays `async`.

See [../api/README.md](../api/README.md) for the endpoint-by-endpoint reference.

## The worker

[`app/pipeline/worker.py`](../../server/app/pipeline/worker.py) is 32 lines and deliberately
minimal:

```python
job_queue: "queue.Queue[str]" = queue.Queue()

def enqueue(job_id): job_queue.put(job_id)

def _consume():
    while True:
        job_id = job_queue.get()
        try: run_job(job_id)
        except Exception: logger.exception(...)
        finally: job_queue.task_done()

def start_worker():        # idempotent; one thread per process
    ...threading.Thread(target=_consume, daemon=True, name="chord-job-worker").start()
```

Consequences you need to hold in mind:

- **The queue is in-process and in-memory.** Restarting the server loses every queued job.
  Rows left in `queued`/`separating` are never picked up again, and nothing reaps them. Resume
  accepts only `cancelled`, so such a row can be revived only from a page that still has it open,
  by cancelling and then resuming it.
- **Strictly serial.** One Demucs pass at a time. Concurrency would need a real broker.
- **Enqueueing isn't idempotent.** `enqueue` doesn't know whether the id is already waiting, so a
  job resumed while its first entry still waits is in the queue twice. `run_job` makes that
  harmless by starting only on a `queued` row: whichever entry reaches the worker second finds the
  job already run and returns. See [job-lifecycle.md](job-lifecycle.md#resuming).
- **`daemon=True`** means the thread dies with the process, mid-job if necessary.
- Because uvicorn runs a single process by default, one worker exists. Running multiple
  uvicorn workers would create one queue *per process* and route enqueues arbitrarily —
  don't, without replacing the queue.

## The pipeline

[`app/pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) `run_job(job_id)` is the
orchestrator (~215 lines). It is the only module that writes job status, and the only one that
knows the stage order. Every other pipeline module is a leaf: pure-ish function in, artifact or
value out, no database access. [`errors.py`](../../server/app/pipeline/errors.py) holds the
exception types that carry a user-facing message across that boundary.

```text
run_job
 ├─ row missing, or not queued? → return; attempt = row["attempt"]
 ├─ if source_url:  source.download_audio()             → original.mp3, title, author
 │                  _record_track_identity()            → title, author (unscoped)
 │                  (both skipped when original.mp3 already exists)
 │  else:           metadata.extract_author()            → author from ID3
 ├─ _is_superseded?                                     ← checkpoint
 ├─ thumbnail.extract_embedded_cover()   (if none yet)
 ├─ metadata.read_audio_info()                          → duration, format label
 │     over max_duration_seconds → raise TrackTooLongError
 ├─ _update_job(status=separating, duration_seconds, audio_format)
 ├─ separation.separate(on_progress=…)   (unless stems/ is complete)
 │     on_progress: a progress write per 1%; _is_superseded every ≥ 2 s → raise _Superseded
 ├─ _is_superseded?                                     ← checkpoint
 ├─ tempo.detect_tempo()                                → tempo_bpm, null for 0 BPM
 ├─ _is_superseded?                                     ← checkpoint
 ├─ if enable_chord_detection: chords.analyze_audio()   → chords.json, key.json
 ├─ _is_superseded?                                     ← checkpoint
 └─ _update_job(**done_fields)                          one UPDATE: status, progress,
                                                        stage_message, tempo, key
```

Details that are easy to misread:

- **Every write is scoped to the attempt — but one.** `_update_job(job_id, attempt, **fields)`
  issues `UPDATE jobs SET … WHERE id = ? AND attempt = ? AND status != 'cancelled'` and never checks
  how many rows matched, so a run that was cancelled, deleted or superseded by a resume writes
  nothing, silently. `_is_superseded(job_id, attempt)` is the matching read: the row is missing,
  `cancelled`, or on a different `attempt`. The exception is `_record_track_identity`, which writes
  a download's title and author by id alone: a resume skips the download, so a run cancelled
  mid-download must still leave them on the row. It touches no other column.
- **A run starts only on a `queued` row.** A job cancelled while it waited and then resumed is in
  the queue twice; the check keeps the second entry from running it again.
- **Results are batched into the final write — except duration and format.** `tempo_bpm`,
  `key_estimate` and `key_confidence` accumulate in a local `done_fields` dict and land in the
  *same* `UPDATE` that sets `status=done`. `duration_seconds` and `audio_format` go out earlier,
  with `status=separating`, so the processing screen can show them. Either way no client ever
  observes `done` without every result field — which is exactly why the SSE stream can stop at the
  first terminal status without missing data.
- **Tempo detection happens under `status=separating`.** Only `progress` (0.5) and
  `stage_message` ("Detecting tempo") change. There is no `TEMPO` status. librosa reports 0 BPM
  when it finds no beat at all, and `run_job` stores that as null (`detect_tempo(...) or None`).
- **The Demucs `Separator` is a process-wide singleton**, built on first use.
  [`separation.py`](../../server/app/pipeline/separation.py) swaps its `callback` per job with
  `update_parameter` rather than fixing it at construction. The callback fires as each chunk
  starts; with Demucs' default `jobs=0` chunks run in order, so the starting chunk's offset is the
  share of the pass already done. An exception raised from the callback unwinds out of Demucs and
  abandons the pass — that is how `_Superseded` interrupts separation.
- **Stems are all-or-nothing on disk.** `separate()` writes into `stems.partial/`, then removes
  any old `stems/` and renames the scratch directory into place. `_stems_complete` (all six
  `STEM_NAMES` WAVs present) is therefore enough for a resume to skip separation.
- **Stems keep a 44.1 or 48 kHz source's rate.** Demucs always works at the model's own rate
  (44.1 kHz for `htdemucs_6s`); stems from a 48 kHz source are resampled back with
  `julius.resample_frac`, and any other source rate keeps the model's. `julius` is imported
  directly, so `requirements.txt` lists it, although Demucs would install it anyway.

`_update_job` builds its `SET` clause by interpolating the **keys** of `fields` into SQL. Values
are bound parameters, so this is safe as written — every call site passes literal keyword names —
but it means a caller-supplied key would be injected verbatim. Keep call sites literal.

### Error handling

`run_job` has two handlers:

1. `except _Superseded: return` — the signal the separation callback raises.
2. `except Exception`: re-check `_is_superseded` first — a cancelled or resumed job that blew up
   mid-stage is left alone rather than overwritten with `error`. Otherwise log with
   `logger.exception` (the traceback reaches stderr and nowhere else) and write `status=error`
   with the `error_message` and `error_log` that `_describe_failure(stage, exc)` returns.

`stage` is a local the run updates as it advances — `downloading` (a link job's yt-dlp pass),
`reading` (metadata, cover art, duration), `separating`, `tempo`, `analyzing`. `_describe_failure`
splits on the exception's type:

- A `UserFacingError` — `SourceDownloadError` from [`source.py`](../../server/app/pipeline/source.py),
  or `TrackTooLongError` from `source.py` or `run_job` — is written for a person. Its `str()`
  becomes `error_message` verbatim, and the exception it was raised `from` becomes `error_log`:
  yt-dlp's own error text, for a failed download.
- Anything else gets `_STAGE_FAILURE_MESSAGES[stage]` — *"Stem separation stopped with an
  error."* and the like — as the message, and `"TypeName: text"` as the log.

So an unexpected exception's text never reaches the browser as the message; it arrives as the log,
which the failure panel shows in a monospace block with *Copy log*. Making a new failure
user-facing means subclassing `UserFacingError` and chaining the cause with `raise … from exc`.

Either way the error write leaves `stage_message` alone, except when the run failed while
`reading`. Reading falls between stages, so that write sets the message to null rather than leave a
finished download's *Downloading audio* naming a stage that succeeded. The client doesn't read it
on a failed job: every failure panel is titled *Separation failed*.

`metadata.read_audio_info` deliberately raises on a file libsndfile can't open — nothing after it
can run without a duration — while `metadata.extract_author` and the thumbnail helpers degrade to
`None` or `False`.

## The database layer

[`app/db/database.py`](../../server/app/db/database.py), 71 lines, no ORM.

```python
@contextmanager
def db_cursor():
    conn = get_connection()      # new connection every time
    try:
        cur = conn.cursor(); yield cur; conn.commit()
    finally:
        conn.close()
```

- **A fresh connection per block.** SQLite handles this fine at this scale, and it sidesteps
  cross-thread connection sharing between the worker thread and request threads entirely.
  `check_same_thread=False` is set anyway.
- **Commit happens on normal exit only** — an exception inside the `with` propagates before
  `commit()`, so the transaction is discarded when the connection closes.
- `row_factory = sqlite3.Row`, so rows are indexed by column name throughout.
- **Migrations are additive and hardcoded.** `init_db()` runs `CREATE TABLE IF NOT EXISTS`,
  then diffs `PRAGMA table_info(jobs)` against `MIGRATED_COLUMNS` and `ALTER TABLE ADD COLUMN`s
  whatever is missing. To add a column: put it in `SCHEMA` *and* append it to
  `MIGRATED_COLUMNS`, so both fresh and existing databases get it. There is no down-migration,
  no version table, and no support for altering or dropping a column.
- Every column in `MIGRATED_COLUMNS` is also in `SCHEMA`, so a fresh database never needs the
  migration step. On a database that predates a column, `ADD COLUMN` appends it after `updated_at`,
  wherever `SCHEMA` places it; rows are read by name, so the order never matters. `attempt` is
  `INTEGER NOT NULL DEFAULT 0`, which SQLite accepts in `ADD COLUMN` only because the default is
  not null.

Schema and the on-disk layout are documented in [../data/README.md](../data/README.md).

## Long responses and streaming

- **SSE** (`GET /jobs/{id}/events`) is an `async` generator inside a `StreamingResponse` that
  re-reads the row every 0.5s and yields only when the serialized payload changed, then breaks
  on a terminal status. It is polling, not push — there is no notification from the worker.
  The handler looks the job up once before building the response, so an unknown id is a plain
  404; a job deleted mid-stream can only end the connection, because the `200` is already out.
  Note the generator calls the synchronous `_get_job_row` (and thus blocking SQLite) from the
  event loop; fine at this scale, a real concern under load.
- **Stems** are served with `FileResponse`, which sends `Content-Length` and implements HTTP range
  requests. Nothing in the client uses ranges — `PlaybackEngine` fetches each stem whole and reads
  `Content-Length` to report download progress — so that support goes unused.
- **The zip** (`GET /jobs/{id}/download`) is built entirely in memory in a `BytesIO` and
  returned as one `Response`. Six WAVs of a full-length song is a few hundred MB of
  uncompressed audio; this endpoint is `def`, not `async def`, so FastAPI runs it in a
  threadpool and it doesn't block the loop — but it does hold the whole archive in RAM. Its
  `Content-Disposition` names the file `<job_id>_stems.zip`, but the client saves it through a
  blob URL under its own name, so that header is never what the user sees.

## The madmom problem

madmom has been unmaintained since 2018 and does not install cleanly on anything modern. It
is therefore *not* in [`requirements.txt`](../../server/requirements.txt) — that file carries a
comment pointing elsewhere instead. The install is three steps, encoded in the
[Dockerfile](../../server/Dockerfile):

```dockerfile
RUN pip install --no-cache-dir cython wheel && \
    pip install --no-cache-dir madmom --no-build-isolation
COPY scripts/patch_madmom.sh scripts/patch_madmom.sh
RUN bash scripts/patch_madmom.sh
```

`--no-build-isolation` is required because madmom's `setup.py` imports numpy and Cython at
build time and cannot declare them as build dependencies. Then
[`patch_madmom.sh`](../../server/scripts/patch_madmom.sh) rewrites the installed package
in site-packages for two Python/numpy breakages:

- `from collections import MutableSequence` → `collections.abc` (moved in Python 3.10).
- `np.float` / `np.int` / `np.bool` / `np.object` / `np.complex` / `np.str` → the plain
  builtins (removed in numpy 1.24).

The patch is idempotent-ish (the `sed` expressions are no-ops once applied) but must run
against the same interpreter that will import madmom — it resolves site-packages via
`sysconfig.get_paths()["purelib"]` and errors out if madmom isn't there. Locally, activate the
venv first.

`build-essential`, `pkg-config` and `libopus-dev` in the Dockerfile exist for this compile
step and for the audio stack; `ffmpeg` is a runtime dependency of yt-dlp, of the thumbnail and
metadata helpers, and of librosa's decoding path.

## Container hardening

The image creates and switches to a non-root `chord` user (uid/gid 1000) after installing
dependencies, and `chown`s `/app`. The bind-mounted `./server/data` must therefore be writable
by uid 1000 on the host — the usual cause of a permission error on first run.
