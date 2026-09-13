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

### Uploads over 512 MB fail

The landing page reports *"That file is larger than the server accepts."* nginx refuses any
request body over `client_max_body_size` — `512m` in the `location /api/` block of
[`nginx.conf`](../../web/nginx.conf) — with its own HTML 413 page before FastAPI sees it, and
`createJob` maps that status to the message. 512 MB is sized for a twelve-minute lossless file,
and a longer track would be refused by the duration limit anyway. To accept larger files, raise
the value and rebuild the web image:

```bash
docker compose up -d --build web
```

The server has no size limit of its own. Starlette spools the upload to a temporary file inside
the container before `create_job` copies it into the job directory, so an upload briefly needs
twice its size in free disk. See [../api/jobs.md](../api/jobs.md#post-jobs).

### An upload sits on "Submitting…"

There is no upload progress. `createJob` is a plain `fetch`, and the button reads *Submitting…* from
the first byte until the job exists — a wait that covers the upload itself, nginx buffering the
whole body before it forwards it, and the server copying the file into the job directory. A large
lossless file over a slow link can sit there a long time with nothing moving; the browser's network
panel shows whether the request is still sending.

### A file is rejected before it uploads

The landing page refuses a file whose name doesn't end in `.mp3` or `.flac` (*"… isn't
supported. CHORD reads MP3 and FLAC…"*) and an empty one (*"… is empty — there is no audio in it
to separate."*) without sending anything. The server repeats both checks for API callers —
*"Only .mp3 and .flac uploads are supported"*, *"Uploaded file is empty"*.

Both sides check the **extension only**, with no content sniffing. A valid MP3 named `.m4a` is
refused; an arbitrary file named `.mp3` is accepted and fails in the worker with *"CHORD couldn't
read the audio source."*, libsndfile's error in the log.

### The progress bar arrives all at once, or the stream dies mid-job

Three nginx directives make SSE work, and all three are required:

```nginx
proxy_buffering off;              # otherwise events are buffered until the response ends
proxy_set_header Connection "";   # otherwise "close" is forwarded
proxy_read_timeout 1h;            # otherwise a long separation trips the 60s default
```

If you put another proxy (Traefik, Cloudflare, a load balancer) in front, it needs equivalent
settings. See [../api/jobs.md](../api/jobs.md#get-jobsjob_idevents).

### "Connection lost"

The panel replaces the processing screen as soon as the progress stream drops. `useJobEvents`
closes the broken `EventSource` and reconnects on its own — `GET /jobs/{id}`, then a new stream —
waiting 1 s, 2 s, 4 s, 8 s, then 10 s between tries. The panel counts *"retry N of 10"*, and the
first event from the server brings the processing screen back. After ten failed tries it stops and
says so; *Reconnect now* starts over at once.

The job is unaffected while this happens: it keeps running server-side whether or not a tab is
watching. The panel's *"Separation is still running on our side"* is the template's copy, not a
status — the page can't reach the server to know. Leaving is not free, though — *New track*, like
reloading or closing the tab, sends the discard beacon, which cancels a running job if the server is
reachable. And the job id lives only in React state, so there is no way back to a job after a
reload.

Usual causes: the server restarting (`docker compose logs server`), or a proxy timing the stream
out (above). After a restart, reconnecting succeeds but the job never advances — see
[Jobs stuck in `queued` or `separating` forever](#jobs-stuck-in-queued-or-separating-forever).

### "Job not found"

A reconnect's `GET /jobs/{id}` answered 404, so the client stopped retrying. The row is gone —
discarded from another tab, deleted by hand, or the database was reset. There is nothing left to
reconnect to, so the panel's one action is *New track*.

## Jobs

### "This track is M:SS long. CHORD separates tracks up to N minutes."

The track is longer than `MAX_DURATION_SECONDS` (default `720`, twelve minutes). A URL job is
refused from yt-dlp's metadata before any audio downloads. An upload is accepted, waits its turn in
the queue, and fails when the worker reads its duration, before separation starts — as does a link
whose metadata carried no duration, once it has downloaded. Either way the panel is titled
*Separation failed*, like every job error, with this sentence as its body. The length is rounded up
to the second, so a track a moment over the limit never reads as exactly the limit. There is no log
block, because the message is the whole story; *Copy log* copies the message instead.

To allow longer tracks, set `MAX_DURATION_SECONDS` in the server's environment (`0` disables the
check), mindful of what it protects: six decoded stems of a twelve-minute track already take over
1.5 GB of browser memory. See
[configuration.md](configuration.md#server-environment-variables). The landing page keeps saying
*"up to 12 minutes"* regardless.

### "Separation failed" for a job that never reached separation

Every job error is titled *Separation failed* — the template's title for its `job-error` state —
whichever stage actually failed: the download, reading the audio, separation, tempo or chord
detection. The body, `error_message`, is what says which: *Couldn't download audio from that link…*
for a link yt-dlp can't fetch, *CHORD couldn't read the audio source.* for a file libsndfile can't
open, *This track is M:SS long…* for one over the limit. The log block, when there is one, holds
`error_log`. See [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md#failures).

### "Couldn't download audio from that link"

`SourceDownloadError` from [`source.py`](../../server/app/pipeline/source.py) — yt-dlp failed,
and its own error text is in the panel's log (*Copy log* copies it). Usual causes: a private or
region-locked video, an expired link, or a yt-dlp that has fallen behind a site change. The last
is common; rebuild to pick up a newer `yt-dlp`:

```bash
docker compose build --no-cache server
```

### A generic failure sentence with a log

For anything not raised as a `UserFacingError`, the panel body is a fixed sentence for the stage —
*"CHORD couldn't read the audio source."*, *"Stem separation stopped with an error."*, *"Tempo
detection stopped with an error."*, *"Chord and key detection stopped with an error."* — and the
log holds the exception as `Type: message`. The full traceback is in the server log:

```bash
docker compose logs server | grep -A 40 "Job <job_id> failed"
```

See [../conventions/python.md](../conventions/python.md#error-handling) for how the two are
split.

### The progress bar sits at 10%

Separation starts the bar at 10% and then follows Demucs, which reports progress as each chunk of
audio *starts* — so the bar holds at 10% until the second chunk begins, a noticeable while on CPU.
On a server's first job it holds a little longer, while the separator loads its weights onto the
device.

### The first job is slower than the rest

The first separation after a start constructs the Demucs separator, loading the weights onto the
device — a few seconds, once per process. Nothing downloads: the weights are in the image. A first
job that sits at 10% for much longer is downloading a model the image wasn't built with; see the
next entry.

### "You are sending unauthenticated requests to the HF Hub"

The server is contacting the Hugging Face Hub, which a current image never does. Either the image
predates the weights being baked in — rebuild it with `./scripts/start.sh` — or the server is running
outside Docker, where the first separation downloads the weights into `~/.cache/huggingface` and the
warning is harmless. A `DEMUCS_MODEL` set at runtime to a model the image doesn't carry never
reaches the Hub, since it is offline; demucs downloads it from its legacy repo into
`server/data/models_cache/` instead. See
[configuration.md](configuration.md#demucs-weights).

### Cancel doesn't stop the current stage

Cancellation is **cooperative**. `POST /cancel` writes `status=cancelled`, and the worker finds
out at its next check. During separation that check runs inside Demucs' progress callback, at most
every 2 s, and abandons the pass at the next chunk. A yt-dlp download, tempo detection or chord
analysis in flight runs to completion first; its results are thrown away. The *Cancelled* panel
appears straight away, so the worker may still be busy: a job queued behind it — or this job,
resumed — waits for that stage to end. By design:
[../architecture/decisions.md](../architecture/decisions.md#cooperative-cancellation).

### Resume repeats work

A resume reuses what the cancelled run left: the downloaded audio with the title and author it
brought, the cover art, and the stems — but only a complete set. An interrupted separation starts
again from the beginning, and tempo and chord detection always run again. See
[../api/jobs.md](../api/jobs.md#post-jobsjob_idresume).

### Jobs stuck in `queued` or `separating` forever

The worker queue is in-memory. **A server restart orphans every queued and in-flight job** —
their rows stay non-terminal and nothing will ever advance them.

```bash
sqlite3 server/data/db.sqlite3 \
  "SELECT id, status, created_at FROM jobs
   WHERE status NOT IN ('done','error','cancelled') ORDER BY created_at;"
```

Cancel and then resume one through the API to run it again, or clean up:
[../data/retention.md](../data/retention.md#stale-rows).

### Two uploads, and the second doesn't start

Correct behavior. One worker thread, one queue, strictly serial — Demucs wants the whole GPU. A
queued job's processing screen sits on *Queued* at 0%; nothing on it says the job is waiting for
another one. See
[../architecture/decisions.md](../architecture/decisions.md#a-single-serial-worker-thread-not-a-task-queue).

### My finished job disappeared

Leaving the results deletes it. *New track* goes through `handleBack`, which clears
`activeJobId`; the effect cleans up, a `sendBeacon` hits `/discard`, and the server deletes the
row **and** the stems directory for a terminal job. Reloading or closing the tab does the same
through `pagehide`. There is no history, by design:
[../data/retention.md](../data/retention.md#discard).

## Audio and the mixer

### "Loading stems…" takes a long time

After separation finishes, the browser downloads all six WAVs in parallel and decodes them before
the results appear — there is no streaming path. The processing screen holds at 100% on
*Loading stems…* for the whole wait, downloading included. There is no byte
count, so a slow download looks exactly like a slow decode; the browser's network panel tells them
apart. That's ~250 MB for a four-minute song at 44.1 kHz, and more at 48 kHz or for a longer track.
Inherent to the Web Audio approach:
[../architecture/decisions.md](../architecture/decisions.md#web-audio-instead-of-audio-elements).
Under `npm run dev` every stem downloads twice — see
[local-development.md](local-development.md#development-only-behavior).

### "Stems failed to load"

Separation succeeded, but at least one stem's download or decode failed in the browser. Each log
line is `GET <url> — <reason>`:

| Reason | Likely cause |
| --- | --- |
| `404 Stem not ready` | the file isn't there — typically a `DEMUCS_MODEL` producing fewer stems than `STEM_NAMES` ([below](#changing-demucs_model-makes-stems-fail-to-load)) |
| a network error (*Failed to fetch* in Chromium) | the connection dropped mid-download |
| a decoding error | the body arrived truncated or corrupt |

*Retry download* re-requests only the stems that failed. *Open anyway* opens the results with the
stems that did load — even when none did, which leaves a mixer with no stems and nothing to play;
*New track* from there discards the job.

### Nothing plays, no error

Browsers start an `AudioContext` suspended until a user gesture. `play()` calls
`audioContext.resume()`, so clicking play is the gesture — but an autoplay attempt without one
silently does nothing. Check the console for an `AudioContext` warning.

### The speed chip is greyed out

Its tooltip reads *"Speed control needs HTTPS or localhost"*. Pitch-preserving speed runs in an
AudioWorklet, and browsers expose AudioWorklet only to secure contexts — HTTPS, or `localhost`.
Open CHORD over plain HTTP by LAN address or hostname (`http://192.168.1.20:8080`) and
`PlaybackEngine.supportsTimeStretch` is false, so `ResultsScreen` withholds the speed handler and
the chip is disabled. Use `localhost` (an SSH tunnel counts), or put TLS in front of nginx. The chip
also disables itself if the worklet script fails to load, and playback falls back to 1×. See
[../features/speed-and-loop.md](../features/speed-and-loop.md).

Below 720px there is no speed chip to grey out: the phone transport has play, seek and *Click*
only.

### A stem is silent

Several different causes, worth distinguishing:

- **Mute/solo state.** Any soloed stem silences all non-soloed ones, and mute beats solo. A soloed
  stem that is also muted is silent even though its Console strip reads *Soloed* and stays lifted —
  check its MUTE button.
- **The fader is at the bottom.** Fader travel spans −36…0 dB and the very bottom is −∞
  (`FADER_RANGE_DB` in [`design/player.ts`](../../web/src/design/player.ts)). Focus the fader and
  press End to put it back at 0 dB.
- **It's an instrumental's vocals.** When the vocals stem is near-silent (`detectHasVocals`), it
  starts muted and its Console strip reads *Silent*, with a note under the Mixer's stems.
- **The separation genuinely produced near-silence.** `htdemucs_6s`' `piano` and `guitar` stems
  are its weakest, and a track without those instruments yields a near-silent stem rather than
  no stem. Not a bug.

See [../architecture/audio-playback.md](../architecture/audio-playback.md).

### The metronome chip is greyed out

The job has no tempo, so `ResultsScreen` passes `onToggleMetronome` as `undefined` and `Transport`
disables the chip (*"No tempo was detected for this track"*); the analysis bar's *Tempo* reads `—`.
librosa reports 0 BPM when it finds no beat at all — silence, or material without a pulse — and the
pipeline stores that as a null `tempo_bpm`. A tempo detection *failure* fails the job instead, so a
finished job without a tempo is beatless, or a row written some other way, such as one that
predates tempo detection.

### The metronome is at the right tempo but off the beat

Beat one is anchored to time zero of the track, not to a detected downbeat —
[`tempo.py`](../../server/app/pipeline/tempo.py) discards `beat_track`'s frame positions and
keeps only the scalar BPM. A song with an intro or a pickup bar will have a click offset from
the groove. Explained, with the fix, in
[../features/tempo-and-metronome.md](../features/tempo-and-metronome.md#phase-alignment).

### "No chord analysis for this track."

Shown in place of the chord strip when `GET /chords` failed for any reason. Usually
`ENABLE_CHORD_DETECTION=false`, or `chords.json` wasn't produced; a network error during that one
request reads the same, and there is no retry. While the request is pending the strip is empty.

### Chords don't match what I hear after transposing

Expected. Transpose rewrites **labels only** — there is no pitch shifting, and the
`PlaybackEngine` never sees the value. It's meant for a player with a capo. Speed changes leave
the pitch alone too, so the chords stay valid at any speed. See
[../features/transpose.md](../features/transpose.md#what-it-does-not-do).

### The key is wrong

Two layers of imperfection: the CNN key model itself, and
[`_resolve_relative_ambiguity`](../features/chords-and-key.md#relative-key-disambiguation),
a duration-based heuristic that can be wrong on modal or chromatic material. The transpose
control is the intended remedy.

Note keys always display in **sharps** (`A# minor`, never `Bb minor`); flats are normalized away
at the boundary.

### Lyrics say "None found for this track." for a song that has them

Several possibilities, in order of likelihood:

1. **The title guess missed.** `guess_candidates` strips `.mp3`/`.flac` and bracketed YouTube
   noise, then tries `(title, author)` and — only if the title contains `" - "` — `(song, artist)`.
   A filename like `track01.mp3` gives lrclib nothing to match.
2. **The negative result is cached.** A miss is written to `analysis/lyrics.json` as literal
   `null`, and the handler turns that into a 404 until something replaces it — *Add lyrics
   manually* does. To force a fresh lookup instead, delete the file:
   ```bash
   rm server/data/jobs/<job_id>/analysis/lyrics.json
   ```
3. **lrclib genuinely doesn't have it** — it's crowdsourced. *Add lyrics manually* takes plain
   text, or LRC lines to sync them.

The row shows for instrumentals as well, where *None found for this track.* is usually the right
answer. See [../features/lyrics.md](../features/lyrics.md).

### Lyrics are synced but consistently early or late

The offset estimator only applies a correction when it beats "no shift" by 15%
(`_MIN_SCORE_IMPROVEMENT`), searches only −10 s…+30 s, and resolves to 0.25 s bins. Outside
those bounds it returns `0.0` and leaves the LRC timing alone. The constants are listed in
[configuration.md](configuration.md#hardcoded-values-worth-knowing).

There is no way to correct it from the page. *Add lyrics manually* is offered only when no lyrics
were found, and the lyric sheet opens only for unsynced lyrics and has no edit action. A `PUT` to
`/jobs/{job_id}/lyrics` with corrected LRC rewrites the cache, and pasted timing is kept exactly as
given — but an open results screen fetches lyrics once and won't see it, and reloading the page
discards the job. See [../api/analysis.md](../api/analysis.md#put-jobsjob_idlyrics).

### The cover tile is a plain gradient

No thumbnail was found, so `has_thumbnail` is false and `CoverArt` draws only its accent gradient
— or the image failed to load and `CoverArt` hid it. Either the upload had no embedded cover art,
the source had no artwork, or ffmpeg's extraction failed (every failure is logged as a warning and
treated as "no thumbnail"). Check:

```bash
ls -la server/data/jobs/<job_id>/thumbnail.jpg
docker compose logs server | grep -i thumbnail
```

See [../features/theming.md](../features/theming.md).

### Text renders in a system font

CHORD's type is Inter, loaded from Google Fonts by [`index.html`](../../web/index.html). Offline,
or behind a network that blocks the font CDN, `--font-body` falls back to `system-ui`. Nothing
else changes.

### "Preparing zip…" takes a long time

`GET /download` builds the whole archive in server memory before sending a byte, and the browser
then buffers all of it before saving — so there's no progress in between, and a long track's zip
runs to hundreds of MB on both ends. Per-stem downloads in the same dialog skip the server-side
build. See [../api/artifacts.md](../api/artifacts.md#get-jobsjob_iddownload).

## Development

### `npm run dev` can't reach the API

The Vite proxy targets `http://localhost:8787`, while the server defaults to `8000`. This is a
live inconsistency in the repo — see
[local-development.md](local-development.md#the-vite-proxy-port-mismatch) for the three ways to
resolve it.

### The Docker build fails on a type error

`web/Dockerfile` runs `npm run build`, which is `tsc -b && vite build` — the type check is part
of the image build and cannot be skipped. Run `npm run build` locally first.

### `npm run lint` reports design rule violations

After oxlint, `npm run lint` runs [`scripts/check-design.mjs`](../../web/scripts/check-design.mjs),
which prints each violation as `path:line  message` and exits non-zero. It checks `src/` against the
design's mechanical [ground rules](../conventions/design.md#ground-rules) — values through the vendored stylesheets' tokens, no new colours or
fonts, only classes those stylesheets define, only `--v`, `--l`, `--p` and `--stem` set inline, no
class definitions in app CSS — so the fix is almost always a token or an existing class; the rules
are in [../conventions/design.md](../conventions/design.md). It reads string literals rather than
parsing the code, so a regex literal or a line of JSX text can occasionally trip it. The Docker
build runs `npm run build` only, so a violation never fails an image.

### A job is cancelled or deleted while you edit code

`useJobEvents` sends the discard beacon from an effect cleanup. React Fast Refresh re-runs a
component's effects when you save its module — or a non-component module it imports, such as
`useJobEvents.ts` — so saving `App.tsx` while watching a job runs that cleanup: a running job is
cancelled, a finished one deleted. It cannot happen in a production build. `StrictMode`'s
development double-invoke doesn't cause it: `App` mounts with no job, so the discard effect has
nothing to clean up on that pass. See
[local-development.md](local-development.md#development-only-behavior).

### Changing `DEMUCS_MODEL` makes stems fail to load

`STEM_NAMES` is a hardcoded six-element list and `_row_to_response` reports it verbatim for any
`done` job, regardless of what was actually written. Point the setting at the four-source
`htdemucs` and the browser will request `guitar` and `piano`, which don't exist, and open on
*Stems failed to load* with `404 Stem not ready` for each. A resumed job separates again every
time, because `_stems_complete` never sees the full set. A model with stems outside the template's
six fails differently: the web loads only `STEM_KEYS`, so those stems are skipped without a word.
See [configuration.md](configuration.md#server-environment-variables).
