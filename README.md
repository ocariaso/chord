# CHORD

**CHORD** — Component Harmony & Orchestral Retrieval Decoder

<img width="3082" height="889" alt="image" src="https://github.com/user-attachments/assets/d4d81215-368f-4a09-9e7f-939f40aae066" />

## How to run

Requires [Docker](https://www.docker.com/).

```bash
./scripts/start.sh
```

```bash
./scripts/stop.sh
```

## Folder structure

```
chord/
  server/                   FastAPI service: separation (Demucs), chord/key detection (madmom), lyrics
    app/
      api/                  HTTP routes
      core/                 config
      db/                   SQLite access
      models/               pydantic schemas
      pipeline/              separation, chords, lyrics, the job worker
    scripts/                one-off setup scripts (e.g. patching madmom)
    data/                   gitignored, runtime-only: db.sqlite3, jobs/, models_cache/
    Dockerfile
  web/                      React + TypeScript + Vite SPA
    src/
      api/                  server client
      components/           Upload, Processing, and the Simple/Studio result views
      hooks/                 job status, lyrics, dominant color, etc.
      audio/                the Web Audio playback engine
    Dockerfile
    nginx.conf              serves the build and proxies /api to the server
  scripts/
    start.sh / stop.sh
  docker-compose.yml
  docker-compose.gpu.yml    override start.sh applies when an NVIDIA GPU is detected
```
