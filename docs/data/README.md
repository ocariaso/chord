# Data

Everything CHORD persists, and nothing more. There is no external database, cache, object store
or message broker.

| Page | Covers |
| --- | --- |
| [schema.md](schema.md) | the `jobs` SQLite table, and how migrations work |
| [job-directory.md](job-directory.md) | the on-disk layout of `data/jobs/<job_id>/` |
| [retention.md](retention.md) | what gets deleted, what leaks, and how to clean up |

## The whole picture

```
server/data/                     ← gitignored; bind-mounted into the container at /app/data
├── db.sqlite3                   job metadata, one row per job
├── models_cache/                Demucs pretrained weights (TORCH_HOME)
└── jobs/
    └── <job_id>/                one directory per job, uuid4 hex
        ├── original.mp3         the source audio (or original.flac for a FLAC upload)
        ├── thumbnail.jpg        cover art, if any was found
        ├── stems/
        │   ├── vocals.wav
        │   ├── drums.wav
        │   ├── bass.wav
        │   ├── guitar.wav
        │   ├── piano.wav
        │   └── other.wav
        └── analysis/
            ├── chords.json      served by GET /jobs/{id}/chords
            ├── key.json         written, never served
            └── lyrics.json      the lyrics cache — may contain literal `null`
```

Paths come from [`config.py`](../../server/app/core/config.py), which also `mkdir`s `jobs_dir`
and `models_cache_dir` at import time. Note the four path settings are independent defaults, not
layered — overriding `DATA_DIR` alone moves nothing.

## Two sources of truth

State is split between the database and the filesystem, and a few fields are derived from disk
on every read rather than stored:

| Fact | Lives in |
| --- | --- |
| status, progress, key, tempo, timestamps | the `jobs` row |
| `has_thumbnail` | a `Path.exists()` check per serialization |
| `stem_names` | **neither** — the constant `STEM_NAMES`, gated on `status == "done"` |
| chord segments | `analysis/chords.json` only |
| lyrics | `analysis/lyrics.json` only |
| audio | `original.*` and `stems/*.wav` |

They can disagree. A row whose directory was deleted still lists in `GET /jobs`; a directory
whose row was deleted is invisible to the API and will never be cleaned up. See
[retention.md](retention.md).

## Sizing

Uncompressed WAV dominates everything else:

| Item | Rough size |
| --- | --- |
| one stem, per minute of audio | ~10 MB |
| six stems, four-minute song | ~250 MB |
| `original.mp3` (192 kbps) | ~6 MB |
| `thumbnail.jpg` | tens of KB |
| `analysis/*.json` | single-digit KB |
| `models_cache/` (htdemucs_6s) | several hundred MB, once |
| the `jobs` row | a few hundred bytes |

That ~250 MB per song is the constraint behind three separate design choices: the in-memory zip
endpoint, the browser needing all six stems before playback, and
[discard-on-leave](../architecture/decisions.md#discard-on-leave) deleting finished jobs.

## Backup and portability

The entire application state is `server/data/`. Stop the container and copy the directory and
you have everything; there is nothing in the image or in a volume you'd miss.

`models_cache/` is regenerable — it is just a download cache — so it can be excluded from a
backup at the cost of re-downloading the weights on the next first job.
