# Architecture overview

## Shape of the system

Two containers, one network hop, no external state store beyond a SQLite file and a
directory of job artifacts.

```
                        browser
                           │
                  http://localhost:8080
                           │
                    ┌──────▼───────┐
                    │  chord-web   │   nginx:1.27-alpine
                    │              │   • serves the built SPA from /usr/share/nginx/html
                    │   nginx      │   • location /api/  ->  http://server:8000/
                    └──────┬───────┘
                           │  (compose network, service DNS name "server")
                    ┌──────▼───────┐
                    │ chord-server │   python:3.10-slim + uvicorn
                    │              │
                    │  FastAPI     │  request threads
                    │     │        │
                    │     ├─ SQLite (data/db.sqlite3)
                    │     │
                    │  queue.Queue │
                    │     │        │
                    │  worker      │  one daemon thread, strictly serial
                    │  thread      │
                    │     ├─ yt-dlp ─────────► the internet
                    │     ├─ Demucs (torch)    CPU or CUDA
                    │     ├─ madmom            chords + key
                    │     ├─ librosa           tempo
                    │     ├─ ffmpeg/ffprobe    cover art, artist tag
                    │     └─ httpx ──────────► lrclib.net (lyrics, on demand)
                    │              │
                    │  data/jobs/<job_id>/     stems, analysis, thumbnail
                    └──────────────┘
```

Only nginx is published to the host. The server declares `expose: "8000"`, not `ports`, so it
is reachable from the web container but not from outside Docker.

## The processing lifecycle

A job moves through one path, driven entirely server-side. The browser only watches.

```
POST /jobs            (multipart file)          POST /jobs/from-url   ({"url": ...})
      │                                                │
      │  write original.<ext> to disk                  │  (no file yet)
      │  INSERT jobs row, status=queued                │  INSERT jobs row + source_url
      │  enqueue(job_id)                               │  enqueue(job_id)
      └────────────────────┬───────────────────────────┘
                           │   202 Accepted + JobResponse
                           ▼
              worker thread picks it up (serially)
                           │
        ┌──────────────────┴──────────────────┐
        │  status=fetching (URL jobs only)    │  yt-dlp -> original.mp3, title, uploader
        │  status=separating                  │  read duration; Demucs -> stems/*.wav
        │    (progress 0.5, "Detecting tempo")│  librosa -> tempo_bpm
        │  status=analyzing                   │  madmom -> chords.json, key.json
        │  status=done                        │  one final UPDATE with all result fields
        └─────────────────────────────────────┘
                           │
        browser is subscribed to GET /jobs/{id}/events (SSE, 0.5s poll of the row)
                           │
                 status becomes terminal -> stream ends, UI switches to the mixer
                           │
        mixer fetches stems (WAV), chords.json, and lyrics on demand
```

Between every stage the worker re-reads the row and aborts if the status became `cancelled`.
See [job-lifecycle.md](job-lifecycle.md) for each transition in detail.

## Layering

### Server

```
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
network-bound, and shouldn't be able to fail or slow a job. See [../features/lyrics.md](../features/lyrics.md).

### Web

```
main.tsx              mounts <App/> in StrictMode
   │
App.tsx               the only screen router: "upload" | "processing" | "results"
   │                  owns activeJobId; everything else flows from useJobEvents(activeJobId)
   ├─ UploadPanel         file drop + URL form
   ├─ ProcessingScreen    progress, stage label, cancel
   └─ StemMixer           the state hub for both mixer views
         ├─ simple view:  ChordTimeline, TransportBar, StemChannel[]
         └─ studio view:  StudioCabinet > StudioMixer > MasterUnit + amps/*
```

There is no router library, no global store, and no data-fetching library. `StemMixer` holds
every piece of playback state and threads it down as props; both views render the same state
through different chrome. See [web.md](web.md).

## Key invariants

- **One job at a time.** The worker is a single thread consuming a single in-process queue.
  Two uploads means the second waits. This is intentional — Demucs wants the whole GPU.
- **The database row is the only progress channel.** Stages write to the row; the SSE
  endpoint polls the row. The worker and the HTTP layer never talk directly.
- **Cancellation is cooperative.** Setting `status=cancelled` doesn't interrupt anything; the
  worker notices at the next checkpoint. A Demucs pass in flight runs to completion.
- **Audio truth lives in `PlaybackEngine`.** WaveSurfer instances are drawing surfaces only.
  See [audio-playback.md](audio-playback.md).
- **The API contract is duplicated by hand** in `web/src/api/client.ts`. Nothing enforces it.

## Where things are not

Worth knowing up front, so you don't go looking:

- No tests, in either half.
- No authentication, authorization, rate limiting, or per-user scoping. Every job is visible
  to anyone who can reach the server; `GET /jobs` lists all of them.
- No CI configuration.
- No migration framework — [`database.py`](../../server/app/db/database.py) adds missing
  columns on boot from a hardcoded list.
- No structured logging or metrics; `logging.exception` to stderr is the whole story.
