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
    └── pipeline/   pipeline.py  worker.py  errors.py  source.py  separation.py
                    chords.py  tempo.py  lyrics.py  metadata.py  thumbnail.py
```

Dependency direction is strictly downward: `api → pipeline, db, models`;
`pipeline → db, models, core`; nothing imports back up into `api`.

---

## Build and dependencies

### `Dockerfile` — the server image (40 lines)
**Notes:** `python:3.10-slim` (pinned by madmom's compatibility ceiling). Installs `ffmpeg`,
`build-essential`, `pkg-config`, `libopus-dev`; then torch via the `TORCH_INDEX_URL` build arg;
then `requirements.txt`; then madmom separately with `--no-build-isolation` followed by
`patch_madmom.sh`; then **bakes in the Demucs weights** — the `DEMUCS_MODEL` build arg (default
`htdemucs_6s`, also exported as the runtime variable) is downloaded into
`HF_HOME=/opt/models/huggingface`, and `HF_HUB_OFFLINE=1` is set after it so the server never
contacts the Hub. The download calls `demucs.hf.get_hf_model`, not `get_model`, because
`get_model` swallows a Hub failure and falls back to the legacy AWS repo, which would pass the
build with nothing baked. Then `COPY app app` last so code edits rebuild only the final layers. Creates
and switches to a non-root `chord` user (uid/gid 1000) — **the host's `server/data` must be
writable by uid 1000**. `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000`.

### `requirements.txt`
**Notes:** `demucs`, `julius`, `librosa`, `soundfile`, `fastapi`, `uvicorn[standard]`,
`python-multipart`, `pydantic-settings`, `yt-dlp`, `httpx`. **torch and madmom are deliberately
absent** — torch because the right wheel depends on the CUDA driver, madmom because it needs
`--no-build-isolation` plus patches. Both omissions are explained in comments in the file.
`julius` is listed although `demucs` installs it, because `app/pipeline/separation.py` imports it
directly. Nothing is pinned, while `separation.py` relies on demucs behavior checked only against
4.1.0 (see its entry).

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
**before any torch import**. demucs reaches `TORCH_HOME` only on its legacy fallback — a model
the image doesn't carry — since the weights it normally loads are baked into the image under
`HF_HOME` (see the `Dockerfile` entry). `lifespan` runs `init_db()` then `start_worker()`. Adds CORS from `settings.cors_origins`
(irrelevant behind nginx). Mounts the three routers plus `GET /health`.

### `app/core/config.py` — settings and paths (28 lines)
**Exports:** `SERVER_DIR`, `Settings`, `settings`
**Imports from:** —
**Used by:** `db.database`, `pipeline.pipeline`, `pipeline.separation`, `main`
**Notes:** `pydantic_settings.BaseSettings`, so **every field is an environment variable of the
same name**. Fields: `data_dir`, `db_path`, `jobs_dir`, `models_cache_dir`, `demucs_model`
(`htdemucs_6s`), `device` (`cuda`), `enable_chord_detection` (`True`), `max_duration_seconds`
(`720`; `0` disables the limit), `cors_origins`. The four path fields are **independent defaults,
not layered** — overriding `DATA_DIR` alone moves nothing. `enable_chord_detection` and
`max_duration_seconds` are read only by `run_job`: `chords` never sees the flag, and `source`
receives the limit as an argument. The landing page's *"up to 12 minutes"* copy in
`web/src/design/copy.ts` hardcodes the `max_duration_seconds` default. Has an
import-time side effect: `mkdir(parents=True, exist_ok=True)` on `jobs_dir` and
`models_cache_dir`.
**See:** [../operations/configuration.md](../operations/configuration.md)

### `app/models/schemas.py` — the vocabulary (68 lines)
**Exports:** `JobStatus`, `ChordSegment`, `KeyEstimate`, `LyricsLine`, `LyricsResponse`,
`SaveLyricsRequest`, `CreateJobFromUrlRequest`, `JobResponse`, `STEM_NAMES`
**Imports from:** —
**Used by:** all three route modules, `pipeline.pipeline`, `pipeline.chords`
**Notes:** the single source of truth for the API contract's server side, hand-mirrored in
`web/src/api/client.ts`. `JobStatus` is a `str, Enum` so `.value` is a plain string for SQLite.
`STEM_NAMES` is a hardcoded six-element list matching `htdemucs_6s` — changing `DEMUCS_MODEL`
without changing this produces 404s, and `run_job`'s `_stems_complete()` looks for exactly these
files, so every resume would re-separate. `JobResponse.stems_model` exists but is **never
written**. `JobResponse` carries `error_log` and `audio_format` but deliberately not the internal
`attempt` column. `SaveLyricsRequest.text` has `Field(max_length=100_000)`, so an oversized paste
is FastAPI's 422, not the route's 400.
**Start here** when learning the codebase.

---

## `app/db/`

### `app/db/database.py` — SQLite access and migrations (71 lines)
**Exports:** `SCHEMA`, `MIGRATED_COLUMNS`, `get_connection`, `init_db`, `now_iso`, `db_cursor`
**Imports from:** `core.config`
**Used by:** `api.routes_jobs`, `api.routes_analysis`, `pipeline.pipeline`, `main`
**Notes:** no ORM. `db_cursor()` is a context manager opening a **fresh connection per block**
and committing on normal exit only — which sidesteps SQLite's cross-thread rules between the
worker and request handlers. `row_factory = sqlite3.Row`, so all access is by column name.
`init_db()` runs `CREATE TABLE IF NOT EXISTS` then diffs `PRAGMA table_info(jobs)` against
`MIGRATED_COLUMNS` and `ALTER TABLE ADD COLUMN`s what's missing — **additive only**, no renames,
drops, rollbacks or version table. Adding a column means editing `SCHEMA` *and*
`MIGRATED_COLUMNS`; `author`, `error_log`, `audio_format` and `attempt`
(`INTEGER NOT NULL DEFAULT 0`) are in both. `attempt` is internal: only `POST /jobs/{id}/resume`
changes it, `run_job` scopes its status, progress and result writes to the value it read at
start, and it never reaches `JobResponse`.
**See:** [../data/schema.md](../data/schema.md)

---

## `app/api/`

### `app/api/routes_jobs.py` — job lifecycle and SSE (206 lines)
**Exports:** `router`, `ALLOWED_UPLOAD_EXTENSIONS`, `TERMINAL_STATUSES`
**Imports from:** `db.database`, `models.schemas`, `pipeline.pipeline` (`job_dir`),
`pipeline.thumbnail` (`THUMBNAIL_FILENAME`), `pipeline.worker` (`enqueue`)
**Used by:** `main`
**Routes:** `POST /jobs`, `POST /jobs/from-url`, `GET /jobs`, `GET /jobs/{id}`,
`POST /jobs/{id}/cancel`, `POST /jobs/{id}/resume`, `POST /jobs/{id}/discard`,
`GET /jobs/{id}/events`
**Notes:** `_row_to_response()` maps columns **explicitly** — `error_log` and `audio_format`
included, `attempt` and `source_url` never — and computes two fields rather than reading them:
`stem_names` is the **constant** `STEM_NAMES` gated on `status == "done"` (not a directory
listing), and `has_thumbnail` is a filesystem `.exists()` on every serialization including each
0.5 s SSE tick. `create_job` copies the upload into `original.<ext>` with `_save_upload`
(`shutil.copyfileobj`, 1 MB chunks) via `run_in_threadpool`, keeping the file off the event loop;
Starlette has already spooled the multipart body to a temporary file by then, so a large upload
briefly occupies disk twice. An empty upload is a 400 **and** its job directory is removed.
Upload validation is extension-only with no server-side size cap — behind nginx,
`client_max_body_size 512m` in `web/nginx.conf` is the only limit. `resume` accepts only a
`cancelled` job (409 otherwise): it resets `status=queued, progress=0`, clears `stage_message`,
`error_message` and `error_log`, and increments `attempt`, which retires the cancelled run
(possibly still finishing a stage) — then enqueues without checking whether the id is already
queued. A job cancelled while still waiting is then queued twice; `run_job`'s queued-only start
guard makes the leftover entry a no-op. `job_events` looks the job up **before** it opens the
stream, so an unknown id is a real 404; the generator then polls the row every 0.5 s, yields only
on a changed payload, and breaks on a terminal status — it calls blocking SQLite from the event
loop, and a job deleted mid-stream ends the connection with an error. `discard` branches:
non-terminal → cancel and keep files; terminal → `DELETE` + `rmtree`.
**See:** [../api/jobs.md](../api/jobs.md)

### `app/api/routes_stems.py` — artifact serving (50 lines)
**Exports:** `router`
**Imports from:** `models.schemas` (`STEM_NAMES`), `pipeline.pipeline` (`job_dir`),
`pipeline.thumbnail` (`THUMBNAIL_FILENAME`)
**Used by:** `main`
**Routes:** `GET /jobs/{id}/thumbnail.jpg`, `GET /jobs/{id}/stems/{name}.wav`,
`GET /jobs/{id}/download`
**Notes:** touches no database. Stems go out as `FileResponse`, which supports HTTP range requests,
though nothing relies on them: the web client fetches every stem whole (`fetchStem` in
`web/src/audio/playbackEngine.ts`, `downloadFile` in `web/src/utils/download.ts`). Separation
renames `stems/` into place only when every stem is written,
so *"Stem not ready"* means absent, never half-written. `download_stems` is declared `def`, **not
`async def`**, so FastAPI runs the blocking zip in a threadpool — preserve that. It globs the real
directory (unlike `stem_names`) and holds the whole archive in memory twice (`BytesIO` +
`getvalue()`), ~250 MB for a four-minute song and about three times that at the twelve-minute
limit. Its `Content-Disposition` name (`<job_id>_stems.zip`) goes unused: the client saves the
blob under a title-based name.
**See:** [../api/artifacts.md](../api/artifacts.md)

### `app/api/routes_analysis.py` — chords and lyrics (77 lines)
**Exports:** `router`
**Imports from:** `db.database`, `models.schemas`, `pipeline.lyrics`, `pipeline.pipeline`
(`job_dir`)
**Used by:** `main`
**Routes:** `GET /jobs/{id}/chords`, `GET /jobs/{id}/lyrics`, `PUT /jobs/{id}/lyrics`
**Notes:** `/chords` reads `analysis/chords.json` and returns it verbatim. `GET /lyrics` is **the
one handler that does real work and an outbound network call** — it looks up lrclib on a cache
miss, applies the vocal-energy offset, and caches the result *or a literal `null`* to
`analysis/lyrics.json`, translating a cached `null` into a 404. Latency on a miss is seconds, which
is why it is a plain **`def`**: FastAPI runs it in its threadpool, where the blocking lookup can't
stall the event loop and every other request and event stream with it — keep it that way.
`PUT /lyrics` (`SaveLyricsRequest`) checks the job row exists (404), parses the text with
`parse_lyrics_text` (400 *"Paste the lyrics before saving"* when blank) and overwrites the same
`lyrics.json`, replacing any cached lookup — a cached `null` included. Pasted LRC timing is kept
as pasted: **no offset correction**. That file is the only store, so a `GET` after a `PUT` returns
the pasted lyrics and never asks lrclib again.
**See:** [../api/analysis.md](../api/analysis.md), [../features/lyrics.md](../features/lyrics.md)

---

## `app/pipeline/`

`pipeline.py` orchestrates and is the only pipeline module that writes job status. Everything
else is a leaf: value or artifact in, value or artifact out, no database access — `separation`
reaches the row only through the progress callback `run_job` passes it.

### `app/pipeline/worker.py` — the job queue (32 lines)
**Exports:** `job_queue`, `enqueue`, `start_worker`
**Imports from:** `pipeline.pipeline` (`run_job`)
**Used by:** `api.routes_jobs`, `main`
**Notes:** one `queue.Queue` and one `daemon=True` thread named `chord-job-worker`.
`start_worker()` is idempotent per process. **The queue is in-memory** — a restart orphans every
queued and in-flight job, leaving rows permanently non-terminal with nothing to reap them.
Strictly serial by design (Demucs wants the whole GPU). Multiple uvicorn workers would create
one queue per process and break the model. Cancellation is cooperative: a cancelled run keeps
the thread until `run_job` notices — a cancel or resume aborts a separation pass at the next
chunk boundary (the row is polled at most every 2 s), but a download, tempo or chord stage
already under way runs to completion first. `enqueue` never dedupes: a job cancelled while still
queued and then resumed sits in the queue twice, and `run_job`'s queued-only start guard makes the
stale copy a no-op.
**See:** [../architecture/server.md](../architecture/server.md#the-worker)

### `app/pipeline/pipeline.py` — the orchestrator (214 lines)
**Exports:** `job_dir`, `run_job`
**Imports from:** `core.config`, `db.database`, `models.schemas`, `pipeline.errors`, and the leaf
modules `chords`, `metadata`, `separation`, `source`, `tempo`, `thumbnail`
**Used by:** `pipeline.worker`, and all three route modules (for `job_dir`)
**Notes:** **the only module that advances job status** — the routes only insert `queued` rows
and set `cancelled` (cancel, discard) or `queued` (resume). `run_job` starts only on a `queued`
row, so a stale queue entry for a job that has already run does nothing. Stage order:
fetch-or-read-author → thumbnail → `metadata.read_audio_info` and the duration limit → separate →
tempo → chords → done, with an `_is_superseded()` checkpoint between stages. `run_job` reads
`attempt` once at start, and every status, progress and result write goes through
`_update_job(job_id, attempt, **fields)`, scoped
`WHERE id = ? AND attempt = ? AND status != 'cancelled'` — neither a cancelled job nor a run
retired by resume can be overwritten. The one exception is `_record_track_identity`, which saves
yt-dlp's title and author **unscoped**: a resume skips the download when `original.mp3` exists,
so a run cancelled mid-download must still keep them. `_is_superseded` is true when the row is
gone, `cancelled`, or on another attempt. Inside separation, `_separation_progress` maps Demucs'
fraction onto `_SEPARATION_PROGRESS` (0.1–0.5), writes the row only once progress has moved
`_PROGRESS_WRITE_STEP` (0.01 of the whole bar), and polls `_is_superseded` at most every
`_SUPERSEDED_POLL_SECONDS` (2 s), raising `_Superseded` — so a cancel or resume **aborts the
Demucs pass at the next chunk boundary**; download, tempo and chords still run to completion.
Resume skips: no download when `original.mp3` exists, no separation when `_stems_complete()` finds
every `STEM_NAMES` WAV; tempo and chords always rerun. Ladder: 0.05 download → 0.1…0.5 separation
(measured) → 0.5 tempo → 0.6 chords → 1.0; tempo runs under `status=separating` (only
progress/message change). `duration_seconds` and `audio_format` are written with
`status=separating`, so the processing screen can show them; `tempo_bpm`, `key_estimate` and
`key_confidence` still accumulate in `done_fields` and land in the **same `UPDATE` that sets
`status=done`**, so a terminal status still guarantees complete results; librosa's 0 BPM for a
track with no beat is stored as `null`, which keeps the metronome disabled. A track longer than
`max_duration_seconds` raises `TrackTooLongError` before separation. Failures: `_Superseded`
returns silently; the catch-all `except Exception` re-checks `_is_superseded`, then
`_describe_failure(stage, exc)` gives a `UserFacingError` its own message with its chained cause
as `error_log`, and anything else `_STAGE_FAILURE_MESSAGES[stage]` with `"<Type>: <message>"` as
`error_log` (no traceback — that goes only to the server log), so an unexpected exception's text
never reaches `error_message`. `stage` is `downloading` during a download, then `reading` until
separation starts. The error write keeps the `stage_message` the failing stage set — except that a
failure while `reading` clears it, so a downloaded file refused for its length doesn't keep the
message of a download that succeeded. The web doesn't read it on a failed job: every job failure is
titled *Separation failed* (`failureCopy` in `web/src/design/copy.ts`). `_update_job` interpolates
its `**fields`
**keys** into SQL (values are bound) — keep call sites literal.
**See:** [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md)

### `app/pipeline/errors.py` — failures written for users (17 lines)
**Exports:** `UserFacingError`, `TrackTooLongError`
**Imports from:** —
**Used by:** `pipeline.pipeline`, `pipeline.source`
**Notes:** the contract with `run_job`'s catch-all. A `UserFacingError`'s `str()` becomes
`error_message` verbatim, and only an **explicitly chained** cause (`raise … from exc`) becomes
`error_log`; any exception outside this hierarchy is treated as internal and replaced by a
sentence about the failing stage. `TrackTooLongError(duration_seconds, limit_seconds)` — raised by
`source` from yt-dlp metadata and by `run_job` from the file itself — builds *"This track is M:SS
long. CHORD separates tracks up to N minutes."* The duration is rounded **up** to whole seconds, so
a track a fraction of a second over a whole-minute limit never reads as exactly the limit.
**See:** [../architecture/server.md](../architecture/server.md#error-handling)

### `app/pipeline/source.py` — URL download (69 lines)
**Exports:** `SourceDownloadError`, `download_audio`
**Imports from:** `pipeline.errors`, `pipeline.thumbnail`
**Used by:** `pipeline.pipeline`
**Notes:** wraps yt-dlp with `format: bestaudio/best` plus an `FFmpegExtractAudio` postprocessor
pinned to **192 kbps mp3**, so URL jobs always yield `original.mp3` regardless of source.
`noplaylist`, `writethumbnail`. Returns `(path, title, author)` where author is
`uploader`/`channel`. `SourceDownloadError` is a `UserFacingError`: its message is written for
users and shown verbatim, and the chained yt-dlp `DownloadError` becomes the job's `error_log`.
The duration limit arrives as the `max_duration_seconds` argument (`0` = none): the `match_filter`
`skip_if_too_long` returns a reason when the metadata `duration` exceeds it, which makes yt-dlp
skip the download **without raising**, so `download_audio` records the duration and raises
`TrackTooLongError` itself. A source whose metadata has no `duration` (a direct file link, say)
downloads in full and is refused afterwards by `run_job`'s own check.
`_normalize_downloaded_thumbnail` resolves the name collision where yt-dlp writes artwork as
`original.<ext>` — it must run before anything else globs the directory. No URL allowlist or size
cap.

### `app/pipeline/separation.py` — Demucs (74 lines)
**Exports:** `separate`
**Imports from:** `core.config`
**Used by:** `pipeline.pipeline`
**Notes:** lazy module-level `Separator` singleton (loading the weights onto the device takes seconds; loaded once per
process). `_resolve_device()` falls back to `cpu` when `device == "cuda"` but
`torch.cuda.is_available()` is false. Because the singleton outlives jobs, `separate()` swaps the
progress callback in with `update_parameter` on every call. `_chunk_callback` counts only
chunk-`start` events, as `(model_idx_in_bag + segment_offset / audio_length) / models` — valid
because the default `jobs=0` runs chunks in order. demucs 4.1.0 calls the callback unguarded, so
an exception from `on_progress` aborts the pass; that is how `run_job` cancels mid-separation.
Stems are written into a sibling `stems.partial/` (cleared first) and renamed onto `stems/` only
once all are written, so **`stems/` is complete or absent** — which is what lets a resume skip
separation. An aborted pass leaves an empty `stems.partial/` until the next attempt or a discard.
Demucs works at the model's 44.1 kHz; a 44.1 or 48 kHz source keeps its rate
(`_PRESERVED_SAMPLE_RATES`, read from the file again with `soundfile`), 48 kHz stems being
resampled back with `julius.resample_frac`; any other rate gets the model's. The upload page's
*"44.1 / 48 kHz preserved"* copy depends on that set.
`save_audio`'s defaults make every stem a **16-bit** WAV whatever the source depth
(~10–11.5 MB per stem-minute), and its `clip="rescale"` scales down, on its own, any stem that
would clip. Returns the names it wrote, but `run_job` ignores the return value. The unguarded
`global` is safe only because a single thread calls this.
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

### `app/pipeline/lyrics.py` — lrclib lookup, pasted lyrics, offset correction (158 lines)
**Exports:** `LRCLIB_BASE`, `guess_candidates`, `parse_lyrics_text`, `estimate_lyrics_offset`,
`fetch_lyrics`
**Imports from:** —
**Used by:** `api.routes_analysis` (**not** `pipeline.pipeline`)
**Notes:** the only pipeline module called from a route rather than the orchestrator.
`guess_candidates` strips extensions and bracketed YouTube noise (`_TITLE_NOISE_RE`), then tries
`(title, author)` and — only when the title contains `" - "` — `(song, artist)`.
`fetch_lyrics` tries lrclib `/get` (needs a duration; matches precisely) then `/search`; every
`httpx.HTTPError` degrades to `None`. `parse_lyrics_text` runs pasted text through the same LRC
parser as lrclib's `syncedLyrics`: if any line carries a timestamp the result is synced, lines
without one are **dropped**, and `plain` is rebuilt from the timed lines; otherwise the stripped
text becomes `plain`; blank text is `None`. `estimate_lyrics_offset` cross-correlates LRC-expected
vocal activity against measured RMS activity of the separated vocals stem, searching −10 s…+30 s
in 0.25 s bins and accepting a shift only if it beats no-shift by 15%
(`_MIN_SCORE_IMPROVEMENT`); wrapped in a bare `except Exception` returning `0.0`.
**See:** [../features/lyrics.md](../features/lyrics.md)

### `app/pipeline/metadata.py` — audio info and artist tag (54 lines)
**Exports:** `read_audio_info`, `extract_author`
**Imports from:** —
**Used by:** `pipeline.pipeline`
**Notes:** `read_audio_info` reads the header with `soundfile.info` and returns
`(frames / samplerate, label)`: `"<FORMAT> <bits>/<kHz>"` for the fixed-depth subtypes in
`_BIT_DEPTHS` (`"FLAC 24/48"`), `"<FORMAT> <kHz> kHz"` for everything else (`"MP3 44.1 kHz"`). It
runs for every job and **raises** on audio libsndfile can't open — deliberately, since nothing
after it can run without a duration — which `run_job` reports as *"CHORD couldn't read the audio
source."* `extract_author` is the opposite: it shells out to
`ffprobe -v quiet -print_format json -show_format`, 15 s timeout, returns the first present tag
among `artist`, `ARTIST`, `Artist`, `album_artist`, `ALBUM_ARTIST`, and turns **every** failure
mode — ffprobe missing, timeout, non-zero exit, unparseable JSON, no tag — into `None`, so the
job proceeds without an author. It is used only for uploads; URL jobs get their author from
yt-dlp.

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
