# Data

Everything CHORD persists, and nothing more. There is no external database, cache, object store
or message broker.

| Page | Covers |
| --- | --- |
| [schema.md](schema.md) | the `jobs` SQLite table, and how migrations work |
| [job-directory.md](job-directory.md) | the on-disk layout of `data/jobs/<job_id>/` |
| [retention.md](retention.md) | what gets deleted, what leaks, and how to clean up |

## The whole picture

```text
server/data/                     ← gitignored; bind-mounted into the container at /app/data
├── db.sqlite3                   job metadata, one row per job
├── models_cache/                Demucs pretrained weights (TORCH_HOME)
└── jobs/
    └── <job_id>/                one directory per job, uuid4 hex
        ├── original.mp3         the source audio (or original.flac for a FLAC upload)
        ├── thumbnail.jpg        cover art, if any was found
        ├── stems.partial/       scratch while separation runs; left behind if it's interrupted
        ├── stems/               appears only once every stem is written
        │   ├── vocals.wav
        │   ├── drums.wav
        │   ├── bass.wav
        │   ├── guitar.wav
        │   ├── piano.wav
        │   └── other.wav
        └── analysis/
            ├── chords.json      served by GET /jobs/{id}/chords
            ├── key.json         written, never served
            └── lyrics.json      the lookup's cache, or pasted lyrics — may contain literal `null`
```

Paths come from [`config.py`](../../server/app/core/config.py), which also `mkdir`s `jobs_dir`
and `models_cache_dir` at import time. Note the four path settings are independent defaults, not
layered — overriding `DATA_DIR` alone moves nothing.

## Two sources of truth

State is split between the database and the filesystem, and a few fields are derived from disk
on every read rather than stored:

| Fact | Lives in |
| --- | --- |
| status, progress, duration and format, key, tempo, timestamps, `attempt` | the `jobs` row |
| `has_thumbnail` | a `Path.exists()` check per serialization |
| `stem_names` | **neither** — the constant `STEM_NAMES`, gated on `status == "done"` |
| whether a resume skips separation | a check that every `STEM_NAMES` WAV is in `stems/` |
| whether a resumed URL job downloads again | a check for `original.mp3` |
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
| one stem, per minute of audio | ~10 MB at 44.1 kHz, ~11 MB at 48 kHz |
| six stems, four-minute song at 44.1 kHz | ~250 MB |
| six stems, twelve minutes at 48 kHz — the most the default duration limit allows | ~830 MB |
| `original.mp3` from a URL (192 kbps), four minutes | ~6 MB |
| `original.flac` upload | up to the 512 MB nginx accepts |
| `thumbnail.jpg` | tens of KB |
| `analysis/*.json` | single-digit KB |
| `models_cache/` (htdemucs_6s) | several hundred MB, once |
| the `jobs` row | a few hundred bytes |

The same stems cost more again in the browser, which decodes all six into 32-bit float
`AudioBuffer`s at the `AudioContext`'s sample rate: ~21 MB per stem-minute at 44.1 kHz, ~23 MB at
48 kHz. That is about 0.5 GB of tab memory for a four-minute song, and 1.5–1.7 GB at twelve
minutes.

Stem size is what four other things are sized against: the in-memory zip endpoint's memory use,
the browser needing all six stems before playback,
[discard-on-leave](../architecture/decisions.md#discard-on-leave) deleting finished jobs, and
`MAX_DURATION_SECONDS` refusing long tracks before separation — six decoded stems of a long mix
outgrow what a browser tab can hold.

## Backup and portability

The entire application state is `server/data/`. Stop the container and copy the directory and
you have everything; there is nothing in the image or in a volume you'd miss.

`models_cache/` is regenerable — it is only a download cache — so it can be excluded from a
backup at the cost of re-downloading the weights on the next first job.
