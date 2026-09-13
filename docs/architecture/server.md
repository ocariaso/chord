# Server architecture

FastAPI service in [`server/`](../../server/). Python 3.10 (pinned by the Dockerfile base image
and by madmom's compatibility ceiling), uvicorn, SQLite.

## Startup

[`app/main.py`](../../server/app/main.py) is the whole assembly:

1. `os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))` — set **before**
   anything imports torch, so Demucs downloads pretrained weights into the mounted
   `data/models_cache/` rather than into the container's ephemeral `~/.cache`.
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
| `models_cache_dir` | `<server>/data/models_cache` | becomes `TORCH_HOME` |
| `demucs_model` | `htdemucs_6s` | the 6-source model; see [../features/stem-separation.md](../features/stem-separation.md) |
| `device` | `cuda` | `DEVICE=cpu` in the CPU Compose path; falls back to CPU if CUDA is absent |
| `enable_chord_detection` | `True` | set false to skip the madmom stage entirely |
| `cors_origins` | `["http://localhost:5173"]` | |

The four path fields are independent defaults, not layered on each other. Overriding
`DATA_DIR` alone will *not* move the database or the jobs directory.

## The API layer

Three routers, all under `/jobs`, split by concern rather than by path:

- [`routes_jobs.py`](../../server/app/api/routes_jobs.py) — create, list, read, cancel,
  discard, and the SSE event stream.
- [`routes_stems.py`](../../server/app/api/routes_stems.py) — static artifact serving:
  thumbnail, one stem, all stems as a zip.
- [`routes_analysis.py`](../../server/app/api/routes_analysis.py) — chords and lyrics.

Shared helpers live where they are used rather than in a common module: `job_dir()` comes from
`pipeline.pipeline`, `THUMBNAIL_FILENAME` from `pipeline.thumbnail`, and `_row_to_response()` /
`_get_job_row()` / `TERMINAL_STATUSES` are private to `routes_jobs.py`.

`_row_to_response()` is where two fields are computed rather than stored:

- `stem_names` is `STEM_NAMES` when the job is `done`, `[]` otherwise. It is **not** the actual
  directory listing — it's the constant list from `schemas.py`. A job that somehow produced
  fewer stems would still advertise six.
- `has_thumbnail` is a filesystem `.exists()` check on every serialization, including every
  0.5s SSE tick.

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
  Rows left in `queued`/`separating` are never picked up again — they are simply stale, and
  nothing reaps them.
- **Strictly serial.** One Demucs pass at a time. Concurrency would need a real broker.
- **`daemon=True`** means the thread dies with the process, mid-job if necessary.
- Because uvicorn runs a single process by default, one worker exists. Running multiple
  uvicorn workers would create one queue *per process* and route enqueues arbitrarily —
  don't, without replacing the queue.

## The pipeline

[`app/pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) `run_job(job_id)` is the
orchestrator. It is the only module that writes job status, and the only one that knows the
stage order. Every other pipeline module is a leaf: pure-ish function in, artifact or value out,
no database access.

```
run_job
 ├─ _is_cancelled?                                    ← checkpoint
 ├─ if source_url:  source.download_audio()            → original.mp3, title, author
 │  else:           metadata.extract_author()           → author from ID3
 ├─ _is_cancelled?                                    ← checkpoint
 ├─ thumbnail.extract_embedded_cover()   (if none yet)
 ├─ soundfile: duration_seconds
 ├─ separation.separate()                              → stems/*.wav
 ├─ _is_cancelled?                                    ← checkpoint
 ├─ tempo.detect_tempo()                               → tempo_bpm
 ├─ _is_cancelled?                                    ← checkpoint
 ├─ if enable_chord_detection: chords.analyze_audio()  → chords.json, key.json
 ├─ _is_cancelled?                                    ← checkpoint
 └─ _update_job(**done_fields)                         one UPDATE: status, progress,
                                                       stage_message, duration, tempo, key
```

Two details that are easy to misread:

- **Results are batched into the final write.** `tempo_bpm`, `key_estimate`, `key_confidence`
  and `duration_seconds` accumulate in a local `done_fields` dict and land in the *same*
  `UPDATE` that sets `status=done`. So no client ever observes a job with a tempo but no
  status change — which is exactly why the SSE stream can stop at the first terminal status
  without missing data.
- **Tempo detection happens under `status=separating`.** Only `progress` (0.5) and
  `stage_message` ("Detecting tempo") change. There is no `TEMPO` status.

`_update_job(job_id, **fields)` builds its `SET` clause by interpolating the **keys** of
`fields` into SQL. Values are bound parameters, so this is safe as written — every call site
passes literal keyword names — but it means a caller-supplied key would be injected verbatim.
Keep call sites literal.

### Error handling

`run_job` wraps everything in one `except Exception`, and:

1. Re-checks cancellation first — a cancelled job that blew up mid-stage stays `cancelled`
   rather than being overwritten with `error`.
2. Logs with `logger.exception`.
3. Writes `status=error, error_message=str(exc)`.

`str(exc)` goes straight to the browser. [`source.py`](../../server/app/pipeline/source.py)
takes advantage of this: `SourceDownloadError` carries a message written for a user
("Couldn't download audio from that link…"). Other exception types leak whatever their
`str()` is — a stack-free but internal-sounding message.

## The database layer

[`app/db/database.py`](../../server/app/db/database.py), 64 lines, no ORM.

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

Schema and the on-disk layout are documented in [../data/README.md](../data/README.md).

## Long responses and streaming

- **SSE** (`GET /jobs/{id}/events`) is an `async` generator inside a `StreamingResponse` that
  re-reads the row every 0.5s and yields only when the serialized payload changed, then breaks
  on a terminal status. It is polling, not push — there is no notification from the worker.
  Note the generator calls the synchronous `_get_job_row` (and thus blocking SQLite) from the
  event loop; fine at this scale, a real concern under load.
- **Stems** are served with `FileResponse`, which implements HTTP range requests. The `<audio>`
  element and WaveSurfer both need ranges to seek.
- **The zip** (`GET /jobs/{id}/download`) is built entirely in memory in a `BytesIO` and
  returned as one `Response`. Six WAVs of a full-length song is a few hundred MB of
  uncompressed audio; this endpoint is `def`, not `async def`, so FastAPI runs it in a
  threadpool and it doesn't block the loop — but it does hold the whole archive in RAM.

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
