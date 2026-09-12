# Configuration

Two distinct layers, frequently confused: **build arguments** (baked into an image) and
**environment variables** (read at runtime).

## Build arguments

| Argument | Where | Default | Effect |
| --- | --- | --- | --- |
| `TORCH_INDEX_URL` | [`server/Dockerfile`](../../server/Dockerfile) | `https://download.pytorch.org/whl/cpu` | which torch/torchaudio wheel is installed |

Set by Compose — the base file passes `${TORCH_INDEX_URL:-…/cpu}`, the GPU overlay hardcodes
`…/cu124`. **Changing it requires a rebuild.** Switching between CPU and GPU is therefore not a
restart; it's `--build`.

## Server environment variables

[`config.py`](../../server/app/core/config.py) is a `pydantic_settings.BaseSettings` subclass,
so **every field is overridable by an environment variable of the same name**, case-insensitive.
A `.env` file next to the process is also picked up.

| Variable | Default | Notes |
| --- | --- | --- |
| `DEVICE` | `cuda` | `cpu` or `cuda`. Falls back to CPU if CUDA is unavailable. Compose sets `${DEVICE:-cpu}` in the base file and `cuda` in the overlay. |
| `DEMUCS_MODEL` | `htdemucs_6s` | **See the warning below.** |
| `ENABLE_CHORD_DETECTION` | `true` | `false` skips the madmom stage entirely — no `analyzing` status, no `chords.json`, no key. |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Only relevant when the browser talks to the server directly (local dev). Irrelevant behind nginx. |
| `DATA_DIR` | `<repo>/server/data` | |
| `DB_PATH` | `<repo>/server/data/db.sqlite3` | |
| `JOBS_DIR` | `<repo>/server/data/jobs` | |
| `MODELS_CACHE_DIR` | `<repo>/server/data/models_cache` | becomes `TORCH_HOME` |

> **The four path settings are independent defaults, not layered.** Each is computed from
> `SERVER_DIR` separately, so setting `DATA_DIR` alone moves *nothing* — the database and jobs
> directory stay where they were. Override all four, or none.

> **`DEMUCS_MODEL` is not safely configurable on its own.** `STEM_NAMES` in
> [`schemas.py`](../../server/app/models/schemas.py) is a hardcoded six-element list, and
> `_row_to_response` reports it verbatim for any `done` job. Point `DEMUCS_MODEL` at the
> four-source `htdemucs` and the API will still advertise `guitar` and `piano`, which the browser
> will then request and get 404s for. Changing the model means changing `STEM_NAMES` and both
> view orderings — see [../api/contract-sync.md](../api/contract-sync.md).

### `TORCH_HOME`

Not a setting you pass; [`main.py`](../../server/app/main.py) sets it from
`models_cache_dir` before anything imports torch:

```python
os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))
```

`setdefault`, so an explicitly provided `TORCH_HOME` wins. Without this, Demucs would download
its weights into the container's ephemeral `~/.cache` and lose them on every recreate.

## Compose variables

Read by Docker Compose itself, from the shell or a `.env` beside
[`docker-compose.yml`](../../docker-compose.yml):

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8080` | host port mapped to nginx's 80 |
| `DEVICE` | `cpu` | passed into the server container |
| `TORCH_INDEX_URL` | CPU wheel index | build argument |

```bash
PORT=9000 DEVICE=cpu ./scripts/start.sh
```

## Web build-time configuration

There is almost none, deliberately.

| Value | Source |
| --- | --- |
| `__APP_VERSION__` | `version` from [`package.json`](../../web/package.json), injected by [`vite.config.ts`](../../web/vite.config.ts)'s `define`; declared in [`vite-env.d.ts`](../../web/src/vite-env.d.ts); rendered in the footer |
| `API_BASE` | the literal `"/api"` in [`client.ts`](../../web/src/api/client.ts) |

No `VITE_*` variables, no `.env` files, no configurable API host. The app always talks to its
own origin and something in front of it routes `/api` — nginx in production, the Vite dev proxy
locally. Introducing a configurable host means adding a `VITE_API_BASE` and threading it into
`API_BASE`, remembering that Vite inlines such values at **build** time, so it would become an
image-build argument rather than a runtime setting.

## Hardcoded values worth knowing

Not configuration, but the numbers most likely to be asked about. Each is a module-level
constant, not a magic literal.

**Server**

| Constant | Value | File |
| --- | --- | --- |
| `ALLOWED_UPLOAD_EXTENSIONS` | `{".mp3", ".flac"}` | `routes_jobs.py` |
| SSE poll interval | `0.5` s | `routes_jobs.py` |
| `_RMS_HOP_SECONDS` | `0.25` s | `lyrics.py` |
| `_RMS_ACTIVITY_RATIO` | `0.12` | `lyrics.py` |
| `_MAX_OFFSET_SECONDS` | `30` | `lyrics.py` |
| `_MIN_SCORE_IMPROVEMENT` | `1.15` | `lyrics.py` |
| lrclib timeout | `10.0` s | `lyrics.py` |
| ffprobe timeout | `15` s | `metadata.py` |
| ffmpeg timeout | `30` s | `thumbnail.py` |
| yt-dlp audio quality | `192` kbps mp3 | `source.py` |

**Web**

| Constant | Value | File |
| --- | --- | --- |
| `SILENCE_RMS_THRESHOLD` | `0.01` | `utils/hasVocals.ts` |
| `MIN_TRANSPOSE` / `MAX_TRANSPOSE` | `-11` / `11` | `ChordTimeline.tsx` **and** `MasterUnit.tsx` |
| `VIEW_TRANSITION_MS` | `150` | `StemMixer.tsx` |
| knob drag `sensitivity` | `200` px for full range | `useKnobDrag.ts` |
| metronome click | 1 kHz, 50 ms decay | `playbackEngine.ts` |
| `AMP_WIDTH` / `AMP_MOBILE_WIDTH` | `480` / `340` | `studio/constants.ts` |
| mobile breakpoint | `(max-width: 639px)` | `StemMixer.tsx`, `StudioMixer.tsx` |
| `localStorage` key | `chord:viewMode` | `StemMixer.tsx`, `App.tsx` |
