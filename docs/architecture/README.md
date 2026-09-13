# Architecture overview

## Shape of the system

Two containers, one network hop, no external state store beyond a SQLite file and a
directory of job artifacts.

```text
                        browser
                           │
                  http://localhost:8080
                           │
                    ┌──────▼───────┐
                    │  chord-web   │   nginx:1.27-alpine
                    │              │   • serves the built SPA from /usr/share/nginx/html
                    │   nginx      │   • location /api/  ->  http://server:8000/
                    └──────┬───────┘     (request bodies up to 512 MB)
                           │  (compose network, service DNS name "server")
                    ┌──────▼───────┐
                    │ chord-server │   python:3.10-slim + uvicorn
                    │              │
                    │  FastAPI     │  request threads
                    │     │        │
                    │     ├─ SQLite (data/db.sqlite3)
                    │     └─ httpx ──────────► lrclib.net (lyrics, on first request)
                    │              │
                    │  queue.Queue │
                    │     │        │
                    │  worker      │  one daemon thread, strictly serial
                    │  thread      │
                    │     ├─ yt-dlp ─────────► the internet
                    │     ├─ soundfile         duration, format label
                    │     ├─ Demucs (torch)    CPU or CUDA
                    │     ├─ librosa           tempo
                    │     ├─ madmom            chords + key
                    │     └─ ffmpeg/ffprobe    cover art, artist tag
                    │              │
                    │  data/jobs/<job_id>/     original, stems, analysis, thumbnail
                    └──────────────┘
```

Only nginx is published to the host. The server declares `expose: "8000"`, not `ports`, so it
is reachable from the web container but not from outside Docker.

The origin matters to the browser half. `localhost` counts as a secure context, so at
`http://localhost:8080` the page gets `AudioWorklet` — which pitch-preserving speed needs — and
the async Clipboard API. Opened from another machine over plain HTTP, the same deployment plays
at 1× only (the speed chip is disabled) and copies logs through a hidden-textarea fallback.

## The processing lifecycle

A job moves through one path, driven entirely server-side. The browser only watches.

```text
POST /jobs            (multipart file)          POST /jobs/from-url   ({"url": ...})
      │                                                │
      │  copy original.<ext> to disk (threadpool)      │  (no file yet)
      │  INSERT jobs row, status=queued, attempt=0     │  INSERT jobs row + source_url
      │  enqueue(job_id)                               │  enqueue(job_id)
      └────────────────────┬───────────────────────────┘
                           │   202 Accepted + JobResponse
                           ▼
              worker thread picks it up (serially)
                           │
        ┌──────────────────┴───────────────────────┐
        │  status=fetching   (URL jobs only)       │  yt-dlp -> original.mp3, title, uploader
        │  (status unchanged)                      │  duration + format; too long -> error
        │  status=separating  progress 0.1 -> 0.5  │  Demucs -> stems/*.wav, progress measured
        │    progress 0.5, "Detecting tempo"       │  librosa -> tempo_bpm
        │  status=analyzing   progress 0.6         │  madmom -> chords.json, key.json
        │  status=done        progress 1.0         │  one final UPDATE: status, tempo, key
        └──────────────────────────────────────────┘
                           │
        browser is subscribed to GET /jobs/{id}/events (SSE, 0.5s poll of the row),
        and reconnects with backoff if the stream drops
                           │
        status becomes terminal -> stream ends
          done      -> the results screen
          error     -> failure panel with a message and a log
          cancelled -> failure panel; POST /jobs/{id}/resume re-queues the job
                           │
        results fetch stems (WAV), chords.json, and lyrics on demand
```

Every write the worker makes is scoped to the job's `attempt`. Between stages it re-reads the
row and returns if the job was cancelled, deleted, or resumed under a new attempt; separation
checks too, from Demucs' chunk callback, at most every two seconds. A resumed job reuses the
download and the stems its cancelled attempt finished. See [job-lifecycle.md](job-lifecycle.md)
for each transition in detail.

## Layering

### Server

```text
app/main.py           app assembly, CORS, lifespan (init_db + start_worker)
   │
app/api/*.py          HTTP only: validate, read/write the row, serve files. No analysis.
   │
app/pipeline/*.py     all the real work. pipeline.py orchestrates; the rest are leaf modules.
   │
app/db/database.py    connection factory, schema, additive migrations, db_cursor()
app/core/config.py    pydantic-settings Settings, path constants
app/models/schemas.py Pydantic request/response models + JobStatus + STEM_NAMES
```

The dependency direction is strictly downward. `api` imports from `pipeline`, `db`, `models`;
`pipeline` imports from `db`, `models`, `core`; nothing imports back up into `api`.

One deliberate exception to "api does no work": `GET /jobs/{id}/lyrics` performs the lyrics
lookup inline on first request rather than in the pipeline, because lyrics are optional,
network-bound, and shouldn't be able to fail or slow a job. `PUT` on the same path replaces that
cached result with lyrics the user pasted. See [../features/lyrics.md](../features/lyrics.md).

### Web

```text
main.tsx              loads nocturne.css, chord-theme.css, index.css; mounts <App/> in StrictMode
   │
App.tsx               no screen state: activeJobId, then the job's status, decide what renders
   │                  everything about the job flows from useJobEvents(activeJobId)
   ├─ LandingScreen       file drop, URL form, "Submitting…" while the POST is out
   ├─ ProcessingScreen    five-stage list, progress, time estimate, cancel
   ├─ FailurePanel        job error, cancelled (resume), connection lost, job not found
   └─ ResultsScreen       loads the stems; the engine and the design's PlayerState for all three views
         ├─ ResultsTopbar, AnalysisBar, ChordBar    always mounted; no view tabs below 720px
         ├─ MixerView | ConsoleView | AnalogView    one at a time; Mixer only below 720px
         ├─ Transport                               play, seek, speed, loop, metronome; play, seek, Click below 720px
         └─ ExportDialog, LyricsDialog              on demand

design/               the design's vocabulary, without React: copy, the state model,
                      the six stems, the stage list, the breakpoint
```

There is no router library, no global store, and no data-fetching library. `ResultsScreen` holds
every piece of playback state — the design's `PlayerState` in a reducer, the rest beside it — and
threads it down as props; the three views render the same state through different layouts. The
screens' layout and copy follow the design standard in
[../conventions/design.md](../conventions/design.md), and the screens are its reference
implementation. See
[web.md](web.md), [../features/results-views.md](../features/results-views.md) and
[../conventions/design.md](../conventions/design.md).

## Key invariants

- **One job at a time.** The worker is a single thread consuming a single in-process queue.
  Two uploads means the second waits. This is intentional — Demucs wants the whole GPU.
- **The database row is the only progress channel.** Stages write to the row; the SSE
  endpoint polls the row; cancel and resume are row writes the worker discovers by re-reading
  it. The worker and the HTTP layer never talk directly.
- **Pipeline writes are scoped to their attempt.** `_update_job` matches the job id, the
  `attempt` the run started with, and `status != 'cancelled'`, so a cancelled run — or one a
  resume replaced — can never overwrite the row's status, progress or results. The one unscoped
  write is the title and author a download finds, which a resume that skips the download still
  needs. A run starts at all only on a `queued` row, so a job queued twice runs once.
- **Cancellation is cooperative.** Setting `status=cancelled` interrupts nothing directly; the
  worker notices at the next checkpoint, and during separation at the next Demucs chunk. A
  download, tempo pass or chord pass in flight runs to completion.
- **Audio truth lives in `PlaybackEngine`.** Waveforms are CSS envelopes computed once from the
  decoded buffers, and meters read the engine's analysers; neither plays anything. See
  [audio-playback.md](audio-playback.md).
- **The API contract is duplicated by hand** in `web/src/api/client.ts`. Nothing enforces it.

## Where things are not

Worth knowing up front, so you don't go looking:

- No tests, in either half.
- No authentication, authorization, rate limiting, or per-user scoping. Every job is visible
  to anyone who can reach the server; `GET /jobs` lists all of them.
- No CI configuration.
- No migration framework — [`database.py`](../../server/app/db/database.py) adds missing
  columns on boot from a hardcoded list.
- No structured logging or metrics; `logging.exception` to stderr is the whole story. The log a
  failed job shows in the browser is the exception's text, not a traceback.
- No client-side persistence. Nothing is written to `localStorage`; the view, mix, loop, speed
  and transpose start over every time the results open.
