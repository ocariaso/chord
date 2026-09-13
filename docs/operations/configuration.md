# Configuration

Two distinct layers, frequently confused: **build arguments** (baked into an image) and
**environment variables** (read at runtime).

## Build arguments

| Argument | Where | Default | Effect |
| --- | --- | --- | --- |
| `TORCH_INDEX_URL` | [`server/Dockerfile`](../../server/Dockerfile) | `https://download.pytorch.org/whl/cpu` | which torch/torchaudio wheel is installed |
| `DEMUCS_MODEL` | [`server/Dockerfile`](../../server/Dockerfile) | `htdemucs_6s` | which Demucs model's weights are baked into the image; the image also sets it as the runtime `DEMUCS_MODEL` |

`TORCH_INDEX_URL` is set by Compose — the base file passes `${TORCH_INDEX_URL:-…/cpu}`, the GPU
overlay hardcodes `…/cu124`. **Changing it requires a rebuild.** Switching between CPU and GPU is
therefore not a restart; it's `--build`. Compose doesn't pass `DEMUCS_MODEL`, so the image gets
the Dockerfile default unless the build is given `--build-arg DEMUCS_MODEL=…`.

## Server environment variables

[`config.py`](../../server/app/core/config.py) is a `pydantic_settings.BaseSettings` subclass,
so **every field is overridable by an environment variable of the same name**, case-insensitive.
No `.env` file is read — `Settings` declares no `env_file` — and list values such as
`CORS_ORIGINS` are given as JSON.

| Variable | Default | Notes |
| --- | --- | --- |
| `DEVICE` | `cuda` | `cpu` or `cuda`. Falls back to CPU if CUDA is unavailable. Compose sets `${DEVICE:-cpu}` in the base file and `cuda` in the overlay. |
| `DEMUCS_MODEL` | `htdemucs_6s` | The Docker image sets it from the build argument of the same name. **See the warning below.** |
| `ENABLE_CHORD_DETECTION` | `true` | `false` skips the madmom stage entirely — no `analyzing` status, no `chords.json`, no key. |
| `MAX_DURATION_SECONDS` | `720` | The longest track, in seconds, a job will separate; `0` disables the check. A URL job is refused from yt-dlp's metadata before anything downloads, an upload once the worker reads it and before separation. Both fail with *"This track is M:SS long. CHORD separates tracks up to N minutes."* |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Only relevant when the browser talks to the server directly (local dev). Irrelevant behind nginx. |
| `DATA_DIR` | `<repo>/server/data` | |
| `DB_PATH` | `<repo>/server/data/db.sqlite3` | |
| `JOBS_DIR` | `<repo>/server/data/jobs` | |
| `MODELS_CACHE_DIR` | `<repo>/server/data/models_cache` | becomes `TORCH_HOME`, demucs' fallback download cache — see [Demucs weights](#demucs-weights) |

> **The four path settings are independent defaults, not layered.** Each is computed from
> `SERVER_DIR` separately, so setting `DATA_DIR` alone moves *nothing* — the database and jobs
> directory stay where they were. Override all four, or none.

> **`DEMUCS_MODEL` is not safely configurable on its own.** `STEM_NAMES` in
> [`schemas.py`](../../server/app/models/schemas.py) is a hardcoded six-element list, and
> `_row_to_response` reports it verbatim for any `done` job. Point `DEMUCS_MODEL` at the
> four-source `htdemucs` and the API will still advertise `guitar` and `piano`, which the browser
> will then request and get 404s for — and `_stems_complete` never sees a full set, so a resumed
> job separates again every time. Changing the model means changing `STEM_NAMES` and `STEM_KEYS`
> together, since the web loads only the stems `STEM_KEYS` names — see
> [../api/contract-sync.md](../api/contract-sync.md#checklist-for-a-contract-change).

> **`MAX_DURATION_SECONDS` protects the browser more than the server.** A job's six stems are
> decoded into the tab's memory before playback — 1.5–1.7 GB at twelve minutes — and the zip
> endpoint builds its whole archive in server memory. Raise the limit and both grow in proportion.
> The landing page's *"up to 12 minutes"* is hardcoded in `landingCopy` in
> [`design/copy.ts`](../../web/src/design/copy.ts) and doesn't follow the setting.

### Demucs weights

The weights come from the image, not the data volume.
[`server/Dockerfile`](../../server/Dockerfile) sets three variables around the step that
downloads them:

| Variable | Value | Why |
| --- | --- | --- |
| `HF_HOME` | `/opt/models/huggingface` | demucs 4.1 loads a named model from the Hugging Face Hub and caches it here — a directory in the image |
| `HF_HUB_OFFLINE` | `1`, set after the download | the running server reads the baked copy and never contacts the Hub |
| `DEMUCS_MODEL` | the build argument | the runtime setting names the model the image carries |

None of them is a setting you pass. [`main.py`](../../server/app/main.py) also sets `TORCH_HOME`
from `models_cache_dir` before anything imports torch:

```python
os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))
```

demucs uses it only on its fallback path: `get_model` tries the Hub first and, if that fails for
any reason, downloads from its legacy AWS repo into `TORCH_HOME`. With the Hub offline, that is what
a `DEMUCS_MODEL` overridden at runtime to a model the image wasn't built with does — the first job
downloads it into `server/data/models_cache/`, where it survives recreation. To change the model,
rebuild with `--build-arg DEMUCS_MODEL=…` instead, after reading the `STEM_NAMES` warning above.

Outside Docker none of the image's variables is set, so the first separation downloads the weights
from the Hub into `~/.cache/huggingface` and logs the Hub's unauthenticated-requests warning; see
[local-development.md](local-development.md#first-run-is-slow).

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

`DEVICE` is the only setting Compose passes into the server container. Any other server variable
has to be added to the `server` service's `environment:` — that `.env` feeds Compose's own
`${…}` substitution, not the application:

```yaml
services:
  server:
    environment:
      DEVICE: ${DEVICE:-cpu}
      MAX_DURATION_SECONDS: "900"
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

Not configuration, but the numbers most likely to be asked about. Most are named module-level
constants; the timeouts and the SSE interval are literals where they're used.

**Server**

| Constant | Value | File |
| --- | --- | --- |
| `ALLOWED_UPLOAD_EXTENSIONS` | `{".mp3", ".flac"}` | `routes_jobs.py` |
| `_UPLOAD_COPY_CHUNK_BYTES` | 1 MB | `routes_jobs.py` |
| SSE poll interval | `0.5` s | `routes_jobs.py` |
| `SaveLyricsRequest.text` `max_length` | `100_000` characters | `schemas.py` |
| `_SEPARATION_PROGRESS` | `(0.1, 0.5)` — separation's span of the progress bar | `pipeline.py` |
| `_PROGRESS_WRITE_STEP` | `0.01` — at most one row write per percentage point | `pipeline.py` |
| `_SUPERSEDED_POLL_SECONDS` | `2.0` — how often separation checks for a cancel | `pipeline.py` |
| `_PRESERVED_SAMPLE_RATES` | `{44100, 48000}` | `separation.py` |
| `_RMS_HOP_SECONDS` | `0.25` s | `lyrics.py` |
| `_RMS_ACTIVITY_RATIO` | `0.12` | `lyrics.py` |
| `_MAX_OFFSET_SECONDS` | `30` | `lyrics.py` |
| `_MIN_SCORE_IMPROVEMENT` | `1.15` | `lyrics.py` |
| lrclib timeout | `10.0` s | `lyrics.py` |
| ffprobe timeout | `15` s | `metadata.py` |
| ffmpeg timeout | `30` s | `thumbnail.py` |
| yt-dlp audio quality | `192` kbps mp3 | `source.py` |

**Proxy** — [`web/nginx.conf`](../../web/nginx.conf)

| Directive | Value | Why |
| --- | --- | --- |
| `client_max_body_size` | `512m` | sized for a twelve-minute lossless upload |
| `proxy_read_timeout` | `1h` | keeps the SSE stream open through a long separation |

**Web** — paths under `web/src/`

| Constant | Value | File |
| --- | --- | --- |
| `SILENCE_RMS_THRESHOLD` | `0.01` | `utils/hasVocals.ts` |
| `STEM_KEYS` | vocals, drums, bass, guitar, piano, other — the only stems the web loads | `design/stems.ts` |
| `MIN_TRANSPOSE` / `MAX_TRANSPOSE` | `-11` / `11` | `design/player.ts`; clamped in `screens/results/playerReducer.ts` |
| `FADER_RANGE_DB` | `36` — a stem fader's travel spans −36…0 dB, the bottom is silent | `design/player.ts` |
| `MASTER_TICKS` | the master fader's law behind `masterDb()`: −36, −18, −6 and 0 dB at each third of its travel, the bottom silent; `MASTER_METER_SCALE` is derived from it | `design/player.ts` |
| `TONE_RANGE_DB` | `6` — shelf gain at either end of a Tone knob | `utils/levels.ts` |
| `KNOB_DRAG_PIXELS` | `160` px of vertical drag for a knob's full range | `hooks/useSliderControl.ts` |
| slider keyboard steps | `0.01`; `0.1` with Shift or PageUp/PageDown | `hooks/useSliderControl.ts` |
| `SPEED_OPTIONS` | `0.5`, `0.6`, `0.7`, `0.75`, `0.8`, `0.9`, `1`, `1.1`, `1.25` | `screens/results/Transport.tsx` |
| seek keyboard steps | `5` s; `30` s with Shift or PageUp/PageDown | `screens/results/Transport.tsx` |
| `MIN_LOOP_SECONDS` | `0.5` | `screens/results/ResultsScreen.tsx` |
| `MAX_RECONNECT_ATTEMPTS` | `10`; delay 1 s, doubling to a 10 s cap | `hooks/useJobEvents.ts` |
| stem meter ballistics | instant attack, 24 dB/s release | `screens/results/ConsoleView.tsx` |
| console Peak readout | true peak, 1.5 s hold | `screens/results/ConsoleView.tsx` |
| dial ballistics | 20 dB/s release; true peak held 1.5 s; loudness and correlation smoothed over 300 ms | `screens/results/AnalogView.tsx` |
| meter text refresh | every 125 ms | `ConsoleView.tsx`, `AnalogView.tsx` |
| momentary loudness | 400 ms window — the whole 32768-sample buffer above 81.9 kHz — recomputed at most every 100 ms | `audio/playbackEngine.ts` |
| parameter smoothing | 15 ms time constant | `audio/playbackEngine.ts` |
| metronome click | 1 kHz, 50 ms decay; scheduled 120 ms ahead every 25 ms | `audio/playbackEngine.ts` |
| stretch processor | 60 ms frames, ±15 ms similarity search, 1 s input blocks, 3 s lookahead, at most 12 blocks cached | `audio/stretchProcessor.js`; block size in `audio/playbackEngine.ts` |
| waveform envelope | 160 bins, every 8th sample | `utils/peaks.ts` |
| `WHOLE_SECOND_SLACK` | 5 ms added before `formatTime` floors, so a stem decoded a frame short still reads its whole length | `utils/time.ts` |
| `ESTIMATE_AFTER_SECONDS` | `3` s of separation before a time-remaining estimate | `screens/processing/ProcessingScreen.tsx` |
| `SEPARATION_PROGRESS_END` | `0.5` — duplicates `_SEPARATION_PROGRESS[1]` | `screens/processing/ProcessingScreen.tsx` |
| mobile breakpoint | `(max-width: 720px)` | the `@media` block in `styles/chord-theme.css`; `PHONE_QUERY` in `design/layout.ts`; the `max-[720px]:` utilities in `App.tsx`, `screens/results/MixerView.tsx` and `screens/results/AnalysisBar.tsx` |

No tool checks these values against each other — the breakpoint in particular has to agree in every
one of those places by hand. `npm run lint` does check design values: after oxlint it runs
[`scripts/check-design.mjs`](../../web/scripts/check-design.mjs), which fails on a colour, a spacing
step or a font written as a literal instead of a token from the vendored stylesheets — see
[../conventions/design.md](../conventions/design.md).
