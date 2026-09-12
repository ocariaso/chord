# Troubleshooting

Failure modes that are inherent to the current design, with the reason behind each. Where a
cause is a known gap rather than a mistake, it links to the page that explains it.

## Startup and build

### `docker compose` says the GPU overlay is invalid, or no GPU is used

`start.sh` only adds [`docker-compose.gpu.yml`](../../docker-compose.gpu.yml) when **both**
`command -v nvidia-smi` and `nvidia-smi` itself succeed. A driver that's installed but
non-functional falls back to CPU silently, printing *"No NVIDIA GPU detected"*. Check:

```bash
nvidia-smi                                   # does it run?
docker info | grep -i runtime                # is the NVIDIA Container Toolkit installed?
docker compose logs server | grep -i cuda
```

Also note the GPU overlay changes a **build argument** (`TORCH_INDEX_URL`), so switching to GPU
needs `--build`, which `start.sh` always passes. See
[docker.md](docker.md#the-gpu-overlay).

### Permission denied writing to `/app/data`

The image runs as the non-root `chord` user (uid/gid 1000), created in the
[Dockerfile](../../server/Dockerfile). The bind-mounted `./server/data` must be writable by
uid 1000 on the host:

```bash
sudo chown -R 1000:1000 server/data
```

This is the most common first-run failure on Linux. On Docker Desktop (macOS/Windows) the file
sharing layer usually masks it.

### The madmom install fails during build

Three things have to line up, and the Dockerfile encodes all three — a change to any of them
breaks the build:

- `cython` and `wheel` installed *first*,
- `--no-build-isolation` (madmom's `setup.py` imports numpy/Cython at build time and can't
  declare them),
- `patch_madmom.sh` run afterwards, against the same interpreter.

If a *new* incompatibility appears (a third `np.*` alias, another `collections` move), extend
[`patch_madmom.sh`](../../server/scripts/patch_madmom.sh). As a stopgap, chord detection can be
switched off entirely with `ENABLE_CHORD_DETECTION=false` — jobs still produce stems and tempo.
Background: [../architecture/server.md](../architecture/server.md#the-madmom-problem).

### Locally: "madmom not found on the active Python's path"

`patch_madmom.sh` resolves site-packages from the *active* interpreter and refuses to guess.
Activate the venv first:

```bash
cd server && source .venv/bin/activate && bash scripts/patch_madmom.sh
```

## Requests

### `502 Bad Gateway` on `/api/...` right after starting

`depends_on` is start-order only, not readiness — there is no healthcheck, so nginx accepts
connections before uvicorn is listening. Wait a few seconds. If it persists:

```bash
docker compose logs server
```

A server that crashed at import time (a bad `DEVICE`, a broken madmom) produces a permanent 502.

### Uploads fail with 413

nginx's `client_max_body_size` defaults to **1 MB** and
[`nginx.conf`](../../web/nginx.conf) does not raise it, so any real audio file is rejected when
uploaded through the Docker deployment. Add to the `location /api/` block:

```nginx
client_max_body_size 100M;
```

Note there is no size limit on the server side either — `create_job` reads the whole upload into
memory with `await file.read()`. See [../features/ingest.md](../features/ingest.md#known-gaps).

### Upload rejected with "Only .mp3 and .flac uploads are supported"

Validation is `Path(filename).suffix.lower()` against `{".mp3", ".flac"}` — **extension only**,
no content sniffing. A valid MP3 named `.m4a` is refused; an arbitrary file named `.mp3` is
accepted and fails later as an opaque pipeline `error`.

### The progress bar arrives all at once, or the stream dies mid-job

Three nginx directives make SSE work, and all three are required:

```nginx
proxy_buffering off;              # otherwise events are buffered until the response ends
proxy_set_header Connection "";   # otherwise "close" is forwarded
proxy_read_timeout 1h;            # otherwise a long separation trips the 60s default
```

If you put another proxy (Traefik, Cloudflare, a load balancer) in front, it needs equivalent
settings. See [../api/jobs.md](../api/jobs.md#get-jobsjob_idevents).

### Progress freezes and never recovers

`useJobEvents`' `onerror` handler **closes the stream and does not reconnect**:

```ts
source.onerror = () => { source.close(); };
```

A transient network blip leaves the last-known state frozen on screen while the job continues
server-side. Reloading the page loses the job id entirely — it lives only in React state, so
there is no way back to a running job. Known gap:
[../architecture/web.md](../architecture/web.md#subscription-and-cleanup).

## Jobs

### The progress bar sits at 10% for minutes

Expected. `progress` is a hardcoded ladder (`0 → 0.05 → 0.10 → 0.50 → 0.60 → 1.0`) and
separation — the longest stage by far — spans 0.10 to 0.50 with no intermediate updates, because
Demucs' internal progress isn't surfaced through the API CHORD uses. On CPU this is several
minutes for a four-minute track.

### The first job is dramatically slower than the rest

The first separation downloads the `htdemucs_6s` weights (several hundred MB) into
`server/data/models_cache/`. It's cached after that, and survives container recreation because
that directory is inside the bind mount.

### Cancel appears to do nothing

Cancellation is **cooperative**. It writes `status=cancelled` and nothing else; no signal
reaches the worker, so a Demucs pass, a yt-dlp download or a madmom analysis in flight runs to
completion. The worker notices only at its next between-stage checkpoint. The UI reports
"Cancelled" immediately, which slightly overstates what happened. By design:
[../architecture/decisions.md](../architecture/decisions.md#cooperative-cancellation).

### Jobs stuck in `queued` or `separating` forever

The worker queue is in-memory. **A server restart orphans every queued and in-flight job** —
their rows stay non-terminal and nothing will ever advance them.

```bash
sqlite3 server/data/db.sqlite3 \
  "SELECT id, status, created_at FROM jobs
   WHERE status NOT IN ('done','error','cancelled') ORDER BY created_at;"
```

Cleanup: [../data/retention.md](../data/retention.md#stale-rows).

### Two uploads, and the second doesn't start

Correct behavior. One worker thread, one queue, strictly serial — Demucs wants the whole GPU.
See [../architecture/decisions.md](../architecture/decisions.md#a-single-serial-worker-thread-not-a-task-queue).

### A job cancels itself in local development

React `StrictMode` double-invokes effects in development, so `useJobEvents`' cleanup fires once
immediately — firing the discard beacon at a job that is typically still `queued`, which
cancels it. It does not happen in a production build. See
[../architecture/job-lifecycle.md](../architecture/job-lifecycle.md#discarding).

### My finished job disappeared

Leaving the mixer deletes it. `handleBack` clears `activeJobId`, the effect cleans up, a
`sendBeacon` hits `/discard`, and the server deletes the row **and** the stems directory for a
terminal job. There is no history, by design:
[../data/retention.md](../data/retention.md#discard).

### "Couldn't download audio from that link"

`SourceDownloadError` from [`source.py`](../../server/app/pipeline/source.py) — yt-dlp failed.
Usual causes: a private or region-locked video, an expired link, or a yt-dlp that has fallen
behind a site change. The last is common; rebuild to pick up a newer `yt-dlp`:

```bash
docker compose build --no-cache server
```

Other pipeline errors surface `str(exc)` verbatim, which may read as internal — only this path
has a message written for users.

## Audio and the mixer

### "Loading stems…" takes a long time

All six WAVs must be downloaded and decoded before playback can start — there is no streaming
path. That's ~250 MB for a four-minute song, fetched in parallel. Inherent to the Web Audio
approach: [../architecture/audio-playback.md](../architecture/audio-playback.md#why-not-audio-elements).

### Nothing plays, no error

Browsers start an `AudioContext` suspended until a user gesture. `play()` calls
`audioContext.resume()`, so clicking play is the gesture — but an autoplay attempt without one
silently does nothing. Check the console for an `AudioContext` warning.

### A stem is silent

Two different causes, worth distinguishing:

- **Mute/solo state.** Any soloed stem silences all non-soloed ones, and mute beats solo. See
  [../architecture/audio-playback.md](../architecture/audio-playback.md#mute-solo-and-volume).
- **The separation genuinely produced near-silence.** `htdemucs_6s`' `piano` and `guitar` stems
  are its weakest, and a track without those instruments yields a near-silent stem rather than
  no stem. Not a bug.

### The metronome button is missing

It renders only when the job has a `tempo_bpm` — `StemMixer` passes `onToggleMetronome` as
`undefined` otherwise and both views render `onToggleMetronome && (...)`.

### The metronome is at the right tempo but off the beat

Beat one is anchored to time zero of the track, not to a detected downbeat —
[`tempo.py`](../../server/app/pipeline/tempo.py) discards `beat_track`'s frame positions and
keeps only the scalar BPM. A song with an intro or a pickup bar will have a click offset from
the groove. Explained, with the fix, in
[../features/tempo-and-metronome.md](../features/tempo-and-metronome.md#phase-alignment).

### The chord timeline is missing entirely

`ChordTimeline` returns `null` when `segments.length === 0`. Either
`ENABLE_CHORD_DETECTION=false`, or `chords.json` wasn't produced. The client treats a 404 from
`/chords` as normal and leaves the timeline hidden.

### Chords don't match what I hear after transposing

Expected. Transpose rewrites **labels only** — there is no pitch shifting, and the
`PlaybackEngine` never sees the value. It's meant for a player with a capo. See
[../features/transpose.md](../features/transpose.md#what-it-does-not-do).

### The key is wrong

Two layers of imperfection: the CNN key model itself, and
[`_resolve_relative_ambiguity`](../features/chords-and-key.md#relative-key-disambiguation),
a duration-based heuristic that can be wrong on modal or chromatic material. The transpose
control is the intended remedy — the key tooltip says so.

Note keys always display in **sharps** (`A# minor`, never `Bb minor`); flats are normalized away
at the boundary.

### Lyrics say "No lyrics found" for a song that has them

Several possibilities, in order of likelihood:

1. **The title guess missed.** `guess_candidates` strips `.mp3`/`.flac` and bracketed YouTube
   noise, then tries `(title, author)` and — only if the title contains `" - "` — `(song, artist)`.
   A filename like `track01.mp3` gives lrclib nothing to match.
2. **The negative result is cached.** A miss is written to `analysis/lyrics.json` as literal
   `null`, and the handler turns that into a 404 forever. Delete the file to force a re-lookup:
   ```bash
   rm server/data/jobs/<job_id>/analysis/lyrics.json
   ```
3. **lrclib genuinely doesn't have it** — it's crowdsourced.
4. **The track is instrumental.** `detectHasVocals` suppresses the lyrics UI when the vocals
   stem is near-silent, so nothing displays at all.

See [../features/lyrics.md](../features/lyrics.md).

### Lyrics are synced but consistently early or late

The offset estimator only applies a correction when it beats "no shift" by 15%
(`_MIN_SCORE_IMPROVEMENT`), searches only −10 s…+30 s, and resolves to 0.25 s bins. Outside
those bounds it returns `0.0` and leaves the LRC timing alone. The constants are listed in
[configuration.md](configuration.md#hardcoded-values-worth-knowing).

### Everything is blue instead of matching the album art

No thumbnail was found, so `useDominantColors` got `null` and consumers fell back to
`DEFAULT_ACCENT_COLORS`. Either the upload had no embedded cover art, the source had no
artwork, or ffmpeg's extraction failed (every failure is logged as a warning and treated as
"no thumbnail"). Check:

```bash
ls -la server/data/jobs/<job_id>/thumbnail.jpg
docker compose logs server | grep -i thumbnail
```

### The Studio view looks wrong — plain fonts, broken geometry

The Studio look depends on Google Fonts (Oswald, Orbitron, Share Tech Mono, Rock Salt, Dancing
Script) loaded from a CDN in [`index.html`](../../web/index.html). Offline or behind a blocking
network, it falls back to system sans. Geometry is fixed-pixel and scaled by `ScaleToFit`; see
[../features/studio-view.md](../features/studio-view.md#fixed-geometry-and-scaletofit).

## Development

### `npm run dev` can't reach the API

The Vite proxy targets `http://localhost:8787`, while the server defaults to `8000`. This is a
live inconsistency in the repo — see
[local-development.md](local-development.md#the-vite-proxy-port-mismatch) for the three ways to
resolve it.

### The Docker build fails on a type error

`web/Dockerfile` runs `npm run build`, which is `tsc -b && vite build` — the type check is part
of the image build and cannot be skipped. Run `npm run build` locally first.

### Changing `DEMUCS_MODEL` produces 404s on every stem

`STEM_NAMES` is a hardcoded six-element list and `_row_to_response` reports it verbatim for any
`done` job, regardless of what was actually written. Point the setting at the four-source
`htdemucs` and the browser will request `guitar` and `piano`, which don't exist. See
[configuration.md](configuration.md#server-environment-variables).
