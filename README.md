# CHORD

**CHORD** — *Component Harmony & Orchestral Retrieval Decoder* — is a tool for deconstructing a song. Upload an MP3 or paste a URL, and it separates the track into instrument and vocal stems, and detects its chord progression, key, and lyrics. 

## How to run

Requires [Docker](https://www.docker.com/).

```bash
./scripts/start.sh
```

Then open **http://localhost:8080**. `start.sh` builds and starts both services, and uses your NVIDIA GPU automatically if you have one (falls back to CPU otherwise).

```bash
./scripts/stop.sh
```

Stops everything. Your job history and cached models are kept in `backend/data/` and survive a stop/start.

Prefer to run without Docker? See `backend/README.md` and `frontend/README.md` for manual setup.

## Folder structure

```
chord/
  backend/                  FastAPI service: separation (Demucs), chord/key detection (madmom), lyrics
    app/
      api/                  HTTP routes
      core/                 config
      db/                   SQLite access
      models/               pydantic schemas
      pipeline/              separation, chords, lyrics, the job worker
    scripts/                one-off setup scripts (e.g. patching madmom)
    data/                   gitignored, runtime-only: db.sqlite3, jobs/, models_cache/
    Dockerfile
  frontend/                 React + TypeScript + Vite SPA
    src/
      api/                  backend client
      components/           Upload, Processing, and the Simple/Studio result views
      hooks/                 job status, lyrics, dominant color, etc.
      audio/                the Web Audio playback engine
    Dockerfile
    nginx.conf              serves the build and proxies /api to the backend
  scripts/
    start.sh / stop.sh
  docker-compose.yml
  docker-compose.gpu.yml    override start.sh applies when an NVIDIA GPU is detected
```
