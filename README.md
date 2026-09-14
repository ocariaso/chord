# CHORD

> Component Harmony & Orchestral Retrieval Decoder

CHORD returns six isolated stems, a chord chart aligned to the beat, detected key and tempo, and synced lyrics.

<img width="4456" height="888" alt="image" src="https://github.com/user-attachments/assets/475c8a8a-fc8a-493b-912b-2df4e72bdc5b" />

## How to run

> **Requires** [Docker](https://www.docker.com/).

### Linux / macOS

```bash
# Start
./scripts/start.sh

# Stop
./scripts/stop.sh
```

### Windows

From cmd or PowerShell:

```powershell
# Start
scripts\start.cmd

# Stop
scripts\stop.cmd
```

## Folder structure

```text
chord/
├── server/                    FastAPI service: separation (Demucs), tempo (librosa),
│   │                          chord/key detection (madmom), lyrics
│   ├── app/
│   │   ├── api/               HTTP routes
│   │   ├── core/              config
│   │   ├── db/                SQLite access
│   │   ├── models/            pydantic schemas
│   │   └── pipeline/          separation, tempo, chords, lyrics, user-facing errors, the job worker
│   ├── scripts/               one-off setup scripts (e.g. patching madmom)
│   ├── data/                  gitignored, runtime-only: db.sqlite3, jobs/, models_cache/
│   └── Dockerfile
│
├── web/                       React + TypeScript + Vite SPA
│   ├── scripts/               check-design.mjs, the design-rule check npm run lint runs
│   ├── src/
│   │   ├── api/               server client
│   │   ├── audio/             the Web Audio engine, meter math, the time-stretch worklet
│   │   ├── components/        shared pieces: screen card, dialog, cover art, footer, icons
│   │   │   └── controls/      faders, knobs, MUTE/SOLO toggles, stem waveforms
│   │   ├── design/            the design's vocabulary: copy, player state, stems, stages, breakpoint
│   │   ├── hooks/             job events, lyrics, slider and seek input, animation frames, etc.
│   │   ├── screens/           landing, processing, failure; results with its Mixer, Console and Analog views
│   │   ├── styles/            vendored Nocturne tokens and the ch- component layer
│   │   └── utils/             dB and pan/tone conversions, waveform peaks, transpose, time, etc.
│   ├── Dockerfile
│   └── nginx.conf             serves the build and proxies /api to the server
│
├── scripts/
│   ├── start.sh / stop.sh
│   └── start.cmd / stop.cmd   the same, for Windows
│
├── docs/                      full documentation — see docs/README.md
├── docker-compose.yml
└── docker-compose.gpu.yml     override start.sh applies when an NVIDIA GPU is detected
```

## Documentation

[`docs/`](docs/) covers the system in depth, one folder per category:

| Folder | What's inside |
| --- | --- |
| [`docs/map/`](docs/map/) | File-by-file index — [`tasks.md`](docs/map/tasks.md) routes "change X" to the files involved |
| [`docs/architecture/`](docs/architecture/) | How it fits together, and [why](docs/architecture/decisions.md) |
| [`docs/features/`](docs/features/) | Each capability end to end |
| [`docs/api/`](docs/api/) | HTTP reference |
| [`docs/data/`](docs/data/) | Schema, on-disk layout, retention |
| [`docs/operations/`](docs/operations/) | Docker, configuration, local dev, troubleshooting |
| [`docs/conventions/`](docs/conventions/) | The code style used here |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- how to propose a change
- the checks to run before opening a pull request
- the contribution terms

## License

CHORD is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE).

- ✅ **Allowed:** use, copy, modify and share it for any noncommercial purpose — personal use,
  hobby projects, research, education, charities and government use.
- ❌ **Not permitted:** commercial use of any kind, whether you run it on its own, bundle it into a
  product, or offer it as a hosted or networked service.
- It comes as is, without any warranty.

**Third-party components keep their own licenses.** In particular, the pretrained models used by
[madmom](https://github.com/CPJKU/madmom) for chord and key detection are licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), which likewise forbids
commercial use.
