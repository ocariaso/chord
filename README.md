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

On Windows, from cmd or PowerShell:

```powershell
scripts\start.cmd
scripts\stop.cmd
```

## Folder structure

```
chord/
  server/                   FastAPI service: separation (Demucs), tempo (librosa), chord/key detection (madmom), lyrics
    app/
      api/                  HTTP routes
      core/                 config
      db/                   SQLite access
      models/               pydantic schemas
      pipeline/             separation, tempo, chords, lyrics, user-facing errors, the job worker
    scripts/                one-off setup scripts (e.g. patching madmom)
    data/                   gitignored, runtime-only: db.sqlite3, jobs/, models_cache/
    Dockerfile
  web/                      React + TypeScript + Vite SPA
    scripts/                check-design.mjs, the design-rule check npm run lint runs
    src/
      api/                  server client
      audio/                the Web Audio engine, meter math, the time-stretch worklet
      components/           shared pieces: screen card, dialog, cover art, footer, icons
        controls/           faders, knobs, MUTE/SOLO toggles, stem waveforms
      design/               the design's vocabulary: copy, player state, stems, stages, breakpoint
      hooks/                job events, lyrics, slider and seek input, animation frames, etc.
      screens/              landing, processing, failure; results with its Mixer, Console and Analog views
      styles/               vendored Nocturne tokens and the ch- component layer
      utils/                dB and pan/tone conversions, waveform peaks, transpose, time, etc.
    Dockerfile
    nginx.conf              serves the build and proxies /api to the server
  scripts/
    start.sh / stop.sh
    start.cmd / stop.cmd    the same, for Windows
  docs/                     full documentation — see docs/README.md
  docker-compose.yml
  docker-compose.gpu.yml    override start.sh applies when an NVIDIA GPU is detected
```

## Documentation

[`docs/`](docs/) covers the system in depth, one folder per category:

| | |
| --- | --- |
| [docs/map/](docs/map/) | file-by-file index — [tasks.md](docs/map/tasks.md) routes "change X" to the files involved |
| [docs/architecture/](docs/architecture/) | how it fits together, and [why](docs/architecture/decisions.md) |
| [docs/features/](docs/features/) | each capability end to end |
| [docs/api/](docs/api/) | HTTP reference |
| [docs/data/](docs/data/) | schema, on-disk layout, retention |
| [docs/operations/](docs/operations/) | Docker, configuration, local dev, troubleshooting |
| [docs/conventions/](docs/conventions/) | the code style used here |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a
change, the checks to run before opening a pull request, and the contribution terms.

## License

CHORD is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may
use, copy, modify and share it for any noncommercial purpose: personal use, hobby projects,
research, education, charities and government use. Commercial use of any kind is not permitted,
whether you run it on its own, bundle it into a product, or offer it as a hosted or networked
service. It comes as is, without any warranty.

Third-party components keep their own licenses. In particular, the pretrained models used by
[madmom](https://github.com/CPJKU/madmom) for chord and key detection are licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), which likewise forbids
commercial use.
