# Map: `server/`

FastAPI service. Python 3.10, uvicorn, SQLite.

```
server/
├── Dockerfile
├── .dockerignore
├── README.md
├── requirements.txt
├── scripts/patch_madmom.sh
└── app/
    ├── main.py
    ├── api/        routes_jobs.py  routes_stems.py  routes_analysis.py
    ├── core/       config.py
    ├── db/         database.py
    ├── models/     schemas.py
    └── pipeline/   pipeline.py  worker.py  source.py  separation.py
                    chords.py  tempo.py  lyrics.py  metadata.py  thumbnail.py
```

Dependency direction is strictly downward: `api → pipeline, db, models`;
`pipeline → db, models, core`; nothing imports back up into `api`.

---

## Build and dependencies

### `Dockerfile` — the server image (29 lines)
**Notes:** `python:3.10-slim` (pinned by madmom's compatibility ceiling). Installs `ffmpeg`,
`build-essential`, `pkg-config`, `libopus-dev`; then torch via the `TORCH_INDEX_URL` build arg;
then `requirements.txt`; then madmom separately with `--no-build-isolation` followed by
`patch_madmom.sh`; then `COPY app app` last so code edits rebuild only the final layers. Creates
and switches to a non-root `chord` user (uid/gid 1000) — **the host's `server/data` must be
writable by uid 1000**. `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000`.

### `requirements.txt`
**Notes:** `demucs`, `librosa`, `soundfile`, `fastapi`, `uvicorn[standard]`,
`python-multipart`, `pydantic-settings`, `yt-dlp`, `httpx`. **torch and madmom are deliberately
absent** — torch because the right wheel depends on the CUDA driver, madmom because it needs
`--no-build-isolation` plus patches. Both omissions are explained in comments in the file.

### `scripts/patch_madmom.sh` — make madmom importable (22 lines)
**Notes:** resolves site-packages via `sysconfig.get_paths()["purelib"]` and **errors out if
madmom isn't on the active interpreter's path** — activate the venv first. Applies two `sed`
fixes: `from collections import MutableSequence` → `collections.abc` (Python 3.10), and
`np.float`/`np.int`/`np.bool`/`np.object`/`np.complex`/`np.str` → the builtins (numpy 1.24+).
Effectively idempotent. Extend it if a third incompatibility appears.
**See:** [../architecture/server.md](../architecture/server.md#the-madmom-problem)

### `.dockerignore` — excludes `.venv/`, `data/`, Python caches, `.env*`.

### `README.md` — local setup for the server, including the three-step madmom install.

---

## Application

### `app/main.py` — app assembly (38 lines)
**Exports:** `app` (FastAPI), `lifespan`, `health`
**Imports from:** `api.routes_analysis`, `api.routes_jobs`, `api.routes_stems`, `core.config`,
`db.database`, `pipeline.worker`
**Used by:** the `CMD`/uvicorn entry point
**Notes:** sets `TORCH_HOME` from `settings.models_cache_dir` via `os.environ.setdefault`
**before any torch import** — without it Demucs' weights land in the container's ephemeral
cache. `lifespan` runs `init_db()` then `start_worker()`. Adds CORS from `settings.cors_origins`
(irrelevant behind nginx). Mounts the three routers plus `GET /health`.

### `app/core/config.py` — settings and paths (24 lines)
**Exports:** `SERVER_DIR`, `Settings`, `settings`
**Imports from:** —
**Used by:** `db.database`, `pipeline.pipeline`, `pipeline.separation`, `pipeline.chords` (via
callers), `main`
**Notes:** `pydantic_settings.BaseSettings`, so **every field is an environment variable of the
same name**. Fields: `data_dir`, `db_path`, `jobs_dir`, `models_cache_dir`, `demucs_model`
(`htdemucs_6s`), `device` (`cuda`), `enable_chord_detection` (`True`), `cors_origins`. The four
path fields are **independent defaults, not layered** — overriding `DATA_DIR` alone moves
nothing. Has an import-time side effect: `mkdir(parents=True, exist_ok=True)` on `jobs_dir` and
`models_cache_dir`.
**See:** [../operations/configuration.md](../operations/configuration.md)

### `app/models/schemas.py` — the vocabulary (62 lines)
**Exports:** `JobStatus`, `ChordSegment`, `KeyEstimate`, `LyricsLine`, `LyricsResponse`,
`CreateJobFromUrlRequest`, `JobResponse`, `STEM_NAMES`
**Imports from:** —
**Used by:** all three route modules, `pipeline.pipeline`, `pipeline.chords`
**Notes:** the single source of truth for the API contract's server side, hand-mirrored in
`web/src/api/client.ts`. `JobStatus` is a `str, Enum` so `.value` is a plain string for SQLite.
`STEM_NAMES` is a hardcoded six-element list matching `htdemucs_6s` — changing `DEMUCS_MODEL`
without changing this produces 404s. `JobResponse.stems_model` exists but is **never written**.
**Start here** when learning the codebase.

---

## `app/db/`

### `app/db/database.py` — SQLite access and migrations (64 lines)
**Exports:** `SCHEMA`, `MIGRATED_COLUMNS`, `get_connection`, `init_db`, `now_iso`, `db_cursor`
**Imports from:** `core.config`
**Used by:** `api.routes_jobs`, `api.routes_analysis`, `pipeline.pipeline`, `main`
**Notes:** no ORM. `db_cursor()` is a context manager opening a **fresh connection per block**
and committing on normal exit only — which sidesteps SQLite's cross-thread rules between the
worker and request handlers. `row_factory = sqlite3.Row`, so all access is by column name.
`init_db()` runs `CREATE TABLE IF NOT EXISTS` then diffs `PRAGMA table_info(jobs)` against
`MIGRATED_COLUMNS` and `ALTER TABLE ADD COLUMN`s what's missing — **additive only**, no renames,
drops, rollbacks or version table. Adding a column means editing `SCHEMA` *and*
`MIGRATED_COLUMNS`. Note `author` lives only in `MIGRATED_COLUMNS`, not in `SCHEMA`.
**See:** [../data/schema.md](../data/schema.md)

---

## `app/api/`

### `app/api/routes_jobs.py` — job lifecycle and SSE (173 lines)
**Exports:** `router`, `ALLOWED_UPLOAD_EXTENSIONS`, `TERMINAL_STATUSES`
**Imports from:** `db.database`, `models.schemas`, `pipeline.pipeline` (`job_dir`),
`pipeline.thumbnail` (`THUMBNAIL_FILENAME`), `pipeline.worker` (`enqueue`)
**Used by:** `main`
**Routes:** `POST /jobs`, `POST /jobs/from-url`, `GET /jobs`, `GET /jobs/{id}`,
`POST /jobs/{id}/cancel`, `POST /jobs/{id}/discard`, `GET /jobs/{id}/events`
**Notes:** `_row_to_response()` computes two fields rather than reading them — `stem_names` is
the **constant** `STEM_NAMES` gated on `status == "done"` (not a directory listing), and
`has_thumbnail` is a filesystem `.exists()` on every serialization including each 0.5 s SSE
tick. Both create endpoints `await file.read()` the **entire upload into memory**. Upload
validation is extension-only. The SSE generator polls the row every 0.5 s, yields only on a
changed payload, and breaks on a terminal status — it calls blocking SQLite from the event loop.
`discard` branches: non-terminal → cancel and keep files; terminal → `DELETE` + `rmtree`.
**See:** [../api/jobs.md](../api/jobs.md)

### `app/api/routes_stems.py` — artifact serving (51 lines)
**Exports:** `router`
**Imports from:** `models.schemas` (`STEM_NAMES`), `pipeline.pipeline` (`job_dir`),
`pipeline.thumbnail` (`THUMBNAIL_FILENAME`)
**Used by:** `main`
**Routes:** `GET /jobs/{id}/thumbnail.jpg`, `GET /jobs/{id}/stems/{name}.wav`,
`GET /jobs/{id}/download`
**Notes:** touches no database. `FileResponse` for stems specifically because it supports **HTTP
range requests**, which WaveSurfer's media element needs to seek. `download_stems` is declared
`def`, **not `async def`**, so FastAPI runs the blocking zip in a threadpool — preserve that. It
globs the real directory (unlike `stem_names`) and holds the whole archive in memory twice
(`BytesIO` + `getvalue()`), ~250 MB for a four-minute song.
**See:** [../api/artifacts.md](../api/artifacts.md)

### `app/api/routes_analysis.py` — chords and lyrics (55 lines)
**Exports:** `router`
**Imports from:** `db.database`, `models.schemas`, `pipeline.lyrics`, `pipeline.pipeline`
(`job_dir`)
**Used by:** `main`
**Routes:** `GET /jobs/{id}/chords`, `GET /jobs/{id}/lyrics`
**Notes:** `/chords` reads `analysis/chords.json` and returns it verbatim. `/lyrics` is **the one
handler that does real work and an outbound network call** — it looks up lrclib on a cache miss,
applies the vocal-energy offset, and caches the result *or a literal `null`* to
`analysis/lyrics.json`, translating a cached `null` into a 404. Latency on a miss is seconds.
**See:** [../api/analysis.md](../api/analysis.md), [../features/lyrics.md](../features/lyrics.md)

---

## `app/pipeline/`

`pipeline.py` orchestrates and is the only module that writes job status. Everything else is a
leaf: value or artifact in, value or artifact out, no database access.

### `app/pipeline/worker.py` — the job queue (32 lines)
**Exports:** `job_queue`, `enqueue`, `start_worker`
**Imports from:** `pipeline.pipeline` (`run_job`)
**Used by:** `api.routes_jobs`, `main`
**Notes:** one `queue.Queue` and one `daemon=True` thread named `chord-job-worker`.
`start_worker()` is idempotent per process. **The queue is in-memory** — a restart orphans every
queued and in-flight job, leaving rows permanently non-terminal with nothing to reap them.
Strictly serial by design (Demucs wants the whole GPU). Multiple uvicorn workers would create
one queue per process and break the model.
**See:** [../architecture/server.md](../architecture/server.md#the-worker)

### `app/pipeline/pipeline.py` — the orchestrator (109 lines)
**Exports:** `job_dir`, `run_job`
**Imports from:** `core.config`, `db.database`, `models.schemas`, and the leaf modules
`chords`, `metadata`, `separation`, `source`, `tempo`, `thumbnail`
**Used by:** `pipeline.worker`, and all three route modules (for `job_dir`)
**Notes:** **the only module that writes job status.** Stage order: fetch-or-read-metadata →
thumbnail → duration → separate → tempo → chords → done, with a `_is_cancelled()` checkpoint
between each. Results accumulate in a local `done_fields` dict and land in the **same `UPDATE`
that sets `status=done`**, which is why a terminal status guarantees complete data. Tempo runs
under `status=separating` (only progress/message change). One catch-all `except Exception`
re-checks cancellation first, then writes `status=error, error_message=str(exc)` — so `str(exc)`
reaches the browser. `_update_job` interpolates its `**fields` **keys** into SQL (values are
bound) — keep call sites literal.
**See:** [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md)

### `app/pipeline/source.py` — URL download (53 lines)
**Exports:** `SourceDownloadError`, `download_audio`
**Imports from:** `pipeline.thumbnail`
**Used by:** `pipeline.pipeline`
**Notes:** wraps yt-dlp with `format: bestaudio/best` plus an `FFmpegExtractAudio` postprocessor
pinned to **192 kbps mp3**, so URL jobs always yield `original.mp3` regardless of source.
`noplaylist`, `writethumbnail`. Returns `(path, title, author)` where author is
`uploader`/`channel`. `SourceDownloadError` carries a **message written for users**, exploiting
the fact that `str(exc)` reaches the browser. `_normalize_downloaded_thumbnail` resolves the
name collision where yt-dlp writes artwork as `original.<ext>` — it must run before anything
else globs the directory. No URL allowlist, size cap or duration cap.

### `app/pipeline/separation.py` — Demucs (34 lines)
**Exports:** `separate`
**Imports from:** `core.config`
**Used by:** `pipeline.pipeline`
**Notes:** lazy module-level `Separator` singleton (weights are hundreds of MB; loaded once per
process). `_resolve_device()` falls back to `cpu` when `device == "cuda"` but
`torch.cuda.is_available()` is false. Writes one uncompressed WAV per stem at the model's native
sample rate — ~10 MB per stem-minute. Returns the names it wrote, but `run_job` ignores the
return value. The unguarded `global` is safe only because a single thread calls this.
**See:** [../features/stem-separation.md](../features/stem-separation.md)

### `app/pipeline/chords.py` — chord and key detection (93 lines)
**Exports:** `NOTE_NAMES`, `analyze_audio`
**Imports from:** `models.schemas`
**Used by:** `pipeline.pipeline`
**Notes:** three lazy madmom singletons — `CNNChordFeatureProcessor` +
`CRFChordRecognitionProcessor` (a CNN for frame features, a CRF for temporal smoothing) and
`CNNKeyRecognitionProcessor`. Normalizes labels on the way in: `_FLAT_TO_SHARP` (madmom's key
model emits flats), and `_madmom_label_to_chord` (`C:maj`→`C`, `C:min`→`Cm`, `N`→`N`).
`_resolve_relative_ambiguity` breaks major/relative-minor ties by comparing the **total played
duration of each tonic chord**, matching on root only — a heuristic, and the reason the UI
exposes a manual transpose. `ChordSegment.confidence` is **hardcoded to `1.0`**. `NOTE_NAMES` is
duplicated in `web/src/utils/transpose.ts`.
**See:** [../features/chords-and-key.md](../features/chords-and-key.md)

### `app/pipeline/tempo.py` — BPM detection (11 lines)
**Exports:** `detect_tempo`
**Imports from:** —
**Used by:** `pipeline.pipeline`
**Notes:** `librosa.beat.beat_track` on the **original mix** (not the drums stem), `sr=None` to
keep the native rate, rounded to one decimal. **`beat_track`'s beat frame positions are
discarded** — only the scalar BPM is kept, which is why the metronome can't phase-align to the
downbeat. `np.atleast_1d(tempo)[0]` normalizes across librosa versions.
**See:** [../features/tempo-and-metronome.md](../features/tempo-and-metronome.md)

### `app/pipeline/lyrics.py` — lrclib lookup and offset correction (147 lines)
**Exports:** `LRCLIB_BASE`, `guess_candidates`, `estimate_lyrics_offset`, `fetch_lyrics`
**Imports from:** —
**Used by:** `api.routes_analysis` (**not** `pipeline.pipeline`)
**Notes:** the only pipeline module called from a route rather than the orchestrator.
`guess_candidates` strips extensions and bracketed YouTube noise (`_TITLE_NOISE_RE`), then tries
`(title, author)` and — only when the title contains `" - "` — `(song, artist)`.
`fetch_lyrics` tries lrclib `/get` (needs a duration; matches precisely) then `/search`; every
`httpx.HTTPError` degrades to `None`. `estimate_lyrics_offset` cross-correlates LRC-expected
vocal activity against measured RMS activity of the separated vocals stem, searching −10 s…+30 s
in 0.25 s bins and accepting a shift only if it beats no-shift by 15%
(`_MIN_SCORE_IMPROVEMENT`); wrapped in a bare `except Exception` returning `0.0`.
**See:** [../features/lyrics.md](../features/lyrics.md)

### `app/pipeline/metadata.py` — ID3 artist tag (37 lines)
**Exports:** `extract_author`
**Imports from:** —
**Used by:** `pipeline.pipeline`
**Notes:** shells out to `ffprobe -v quiet -print_format json -show_format`, 15 s timeout, and
returns the first present tag among `artist`, `ARTIST`, `Artist`, `album_artist`,
`ALBUM_ARTIST`. **Every** failure mode returns `None` — ffprobe missing, timeout, non-zero exit,
unparseable JSON, no tag — so the job proceeds without an author. Used only for uploads; URL
jobs get their author from yt-dlp.

### `app/pipeline/thumbnail.py` — cover art via ffmpeg (30 lines)
**Exports:** `THUMBNAIL_FILENAME`, `extract_embedded_cover`, `convert_to_jpg`
**Imports from:** —
**Used by:** `pipeline.pipeline`, `pipeline.source`, `api.routes_jobs`, `api.routes_stems`
**Notes:** `THUMBNAIL_FILENAME = "thumbnail.jpg"` is imported by the routes rather than
retyped. `extract_embedded_cover` pulls an ID3 `APIC` frame (`-an -vcodec mjpeg -frames:v 1` —
cover art is carried as a video stream); `convert_to_jpg` normalizes yt-dlp's webp/png artwork.
Both go through `_run_ffmpeg`, which uses a 30 s timeout and validates **more than the exit
code**: `returncode == 0 and output_path.exists() and st_size > 0`, because ffmpeg can exit 0
having written a zero-byte file.
**See:** [../features/theming.md](../features/theming.md)

### `app/*/__init__.py` — all empty package markers.
