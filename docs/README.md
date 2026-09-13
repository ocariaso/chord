# CHORD documentation

**CHORD** — Component Harmony & Orchestral Retrieval Decoder. Upload or link a song; get
isolated stems, a chord timeline, detected key and tempo, and synced lyrics, in a browser mixer.

Every category below is a folder. This page is the only file at the top level.

## Where to look

| I want to… | Go to |
| --- | --- |
| Find the file that owns a behavior | [map/](map/) — start at [map/tasks.md](map/tasks.md) |
| Understand how the system fits together | [architecture/](architecture/) |
| Understand one user-facing capability end to end | [features/](features/) |
| Call or change an HTTP endpoint | [api/](api/) |
| Know what's stored, where, and in what shape | [data/](data/) |
| Run, build, deploy, or debug an environment | [operations/](operations/) |
| Match the existing code style | [conventions/](conventions/) |
| Change what a screen looks like or says | [conventions/design.md](conventions/design.md) — the design standard |
| Know *why* something is built this way | [architecture/decisions.md](architecture/decisions.md) |
| See planned improvements not yet built | [todos/](todos/) |

## The two halves

A monorepo of two deployables plus a thin script layer:

- **[`server/`](../server/)** — a Python FastAPI service. Owns ingest, the processing pipeline
  (Demucs separation, madmom chord/key, librosa tempo, lrclib lyrics), the SQLite job store, and
  the job files on disk.
- **[`web/`](../web/)** — a React + TypeScript + Vite single-page app served by nginx, which also
  reverse-proxies `/api` to the server. Owns the landing screen, the live processing screen, the
  failure panels, and the results: one mixer state shown as three views (Mixer, Console,
  Analog), played through a Web Audio engine with metering and pitch-preserving speed. Its design,
  copy and UX follow [conventions/design.md](conventions/design.md), the design standard.

They share no code and no generated types — the TypeScript interfaces in
[`web/src/api/client.ts`](../web/src/api/client.ts) are hand-mirrored from the Pydantic models in
[`server/app/models/schemas.py`](../server/app/models/schemas.py). Changing one means changing
the other; see [api/contract-sync.md](api/contract-sync.md).

## Full contents

```
docs/
├── README.md                      this file
│
├── map/                           mechanical, file-by-file index — kept exactly in sync
│   ├── README.md                  how to read an entry, reading order for a newcomer
│   ├── tasks.md                   "I want to change X" → the files involved
│   ├── root.md                    repository-root files
│   ├── server.md                  every file under server/
│   └── web.md                     every file under web/
│
├── architecture/
│   ├── README.md                  system overview, the processing lifecycle, layering
│   ├── server.md                  FastAPI layering, the worker thread, the madmom problem
│   ├── web.md                     screen flow, state ownership, the render clock
│   ├── audio-playback.md          the Web Audio engine, waveforms, silence detection
│   ├── job-lifecycle.md           every status transition, cancellation, resume, discard
│   └── decisions.md               design decisions and their costs
│
├── features/
│   ├── README.md                  feature index with entry points
│   ├── ingest.md                  file upload and URL fetch
│   ├── stem-separation.md         Demucs, devices, the 6-stem model
│   ├── chords-and-key.md          madmom detection, label normalization, key disambiguation
│   ├── tempo-and-metronome.md     librosa BPM and the scheduled click track
│   ├── lyrics.md                  lrclib lookup, vocal-energy offset correction, pasted lyrics
│   ├── theming.md                 the fixed palette, stem hues, cover art
│   ├── results-views.md           the Mixer, Console and Analog views over one mixer state
│   ├── metering.md                post-fader meters, true peak, loudness, correlation
│   ├── speed-and-loop.md          pitch-preserving speed and A–B loops
│   ├── transpose.md               client-side chord/key transposition
│   └── downloads.md               the export dialog: per-stem WAVs and the zip, converted from FLAC
│
├── api/
│   ├── README.md                  conventions, base paths, endpoint summary
│   ├── jobs.md                    create, list, read, cancel, resume, discard, SSE
│   ├── artifacts.md               thumbnail, stems, the zip
│   ├── analysis.md                chords, lyrics lookup, pasted lyrics
│   └── contract-sync.md           keeping Pydantic and TypeScript in agreement
│
├── data/
│   ├── README.md                  the whole picture, two sources of truth, sizing
│   ├── schema.md                  the jobs table and how migrations work
│   ├── job-directory.md           on-disk layout of data/jobs/<job_id>/
│   └── retention.md               what's deleted, what leaks, how to clean up
│
├── operations/
│   ├── README.md                  the short version, requirements, first run
│   ├── docker.md                  Compose, images, the GPU overlay, nginx
│   ├── configuration.md           every environment variable and build argument
│   ├── local-development.md       running without Docker
│   └── troubleshooting.md         known failure modes and their causes
│
├── conventions/
│   ├── README.md                  patterns shared across both halves
│   ├── design.md                  the design standard, and the design check
│   ├── python.md                  server-side style, layering, error handling
│   └── typescript.md              web-side style, React patterns, ch- styling
│
└── todos/                         planned improvements, one page each, not yet in the code
    ├── README.md                  the index, grouped by area
    ├── local-network-exposure.md  localhost-only by default, cross-site and internal-URL checks
    ├── restart-recovery.md        interrupted jobs continue on the next start
    ├── device-visibility.md       reporting a fallback to CPU
    ├── apple-silicon.md           separation on the Apple GPU (mps)
    ├── prebuilt-releases.md       published images, versions, contributor files
    ├── tests-and-ci.md            tests for both halves and CI
    └── generated-api-types.md     TypeScript types from the OpenAPI schema
```

## Keeping these docs true

Two different standards apply:

- **[map/](map/) is an index and must match the code exactly.** A stale entry actively misleads.
  The [`docs-map` skill](../.claude/skills/docs-map/SKILL.md) makes this a standing rule: any
  change that adds, deletes, moves or renames a source file — or changes its exports, purpose or
  in-repo dependencies — updates the map entry in the same change.
- **The prose pages describe behavior and intent.** They need updating when *behavior* changes,
  not when a file moves.

[CLAUDE.md](../CLAUDE.md) loads the rule into every session.
