# Job directory layout

One directory per job at `server/data/jobs/<job_id>/`, where `<job_id>` is the row's
`uuid4().hex`. Created by the job-creation endpoint, populated by the worker, deleted by
[discard](retention.md#discard).

```text
server/data/jobs/<job_id>/
├── original.mp3            or original.flac — the source audio
├── thumbnail.jpg           cover art, if any was found
├── stems.partial/          scratch: exists while a separation pass runs, or after one was interrupted
├── stems/                  complete or absent
│   ├── vocals.flac
│   ├── drums.flac
│   ├── bass.flac
│   ├── guitar.flac
│   ├── piano.flac
│   └── other.flac
└── analysis/
    ├── chords.json
    ├── key.json
    └── lyrics.json
```

`job_dir(job_id)` in [`pipeline.py`](../../server/app/pipeline/pipeline.py) is the single
function that builds this path; every API route imports it from there rather than composing the
path itself.

## `original.*`

The source audio, named by *stem* rather than fully, which is load-bearing in two directions:

- **Uploads** keep their extension — `original.mp3` or `original.flac` — so the pipeline finds
  the file with `next(directory.glob("original.*"))`.
- **URL jobs** always end up as `original.mp3`, because yt-dlp's `FFmpegExtractAudio`
  postprocessor is pinned to `preferredcodec: "mp3"` at 192 kbps. That is why `run_job` can
  hardcode the name for the URL path — and why the file's existence is the test a resumed URL job
  uses to skip the download.

This naming has one hazard: yt-dlp's `writethumbnail` also writes `original.<ext>` for the
artwork (`.webp`, `.png`, `.jpg`). `_normalize_downloaded_thumbnail` in
[`source.py`](../../server/app/pipeline/source.py) exists solely to resolve that collision —
it globs `original.*`, skips `.mp3`, converts whatever's left to `thumbnail.jpg`, and unlinks
it. Anything that globs this directory must run *after* that normalization.

Before separation, `metadata.read_audio_info` opens this file with libsndfile for its duration
and format label. A file libsndfile can't read fails the job there.

Never served by any endpoint.

## `thumbnail.jpg`

Filename is the constant `THUMBNAIL_FILENAME` in
[`thumbnail.py`](../../server/app/pipeline/thumbnail.py), imported by the routes that need it
rather than re-typed.

Written by one of two paths — ffmpeg extracting an embedded cover, or ffmpeg converting yt-dlp's
downloaded artwork. `run_job` only attempts the embedded-cover extraction **if the file doesn't
already exist**, so for URL jobs the source's artwork wins, and a resumed job keeps what it has.

Its existence is the entire implementation of `has_thumbnail`: `_row_to_response` does a
`Path.exists()` check on every serialization rather than storing a flag. Served by
`GET /jobs/{id}/thumbnail.jpg`, and only ever displayed — the web client's `CoverArt` blends it
over an accent gradient and samples nothing from it.

## `stems/`

One 16-bit FLAC per `STEM_NAMES` entry (`<name>.flac`, `STEM_SUFFIX`), written by `separate()` in
[`separation.py`](../../server/app/pipeline/separation.py). Names come from the model's own output
keys and match `STEM_NAMES`. A job directory written before stems were FLAC holds `<name>.wav`
instead, which nothing on the current server reads.

**Sample rate.** Demucs always separates at the model's own rate, 44.1 kHz for `htdemucs_6s`.
The stems are written at the *source's* rate when that is 44.1 or 48 kHz
(`_PRESERVED_SAMPLE_RATES`): 48 kHz stems are resampled back from the model's output with
`julius.resample_frac`, so they line up sample-for-sample with the original in a DAW. Any other
source rate — 96 kHz, 32 kHz — gets the model's 44.1 kHz. Only the rate is carried over: stems are
written with `subtype="PCM_16"`, so the source's bit depth is not.

**Complete or absent.** `separate()` deletes and recreates `stems.partial/`, saves every stem into
it, and only then renames it to `stems/`, replacing any `stems/` already there. Consequences:

- `GET /jobs/{id}/stems/{name}.flac` and `.wav` answer *"Stem not ready"* for every stem until the
  rename.
- A resumed job checks `_stems_complete` — every `STEM_NAMES` FLAC present — and skips separation
  when it holds.
- A pass abandoned by a cancel, or cut off by a restart, leaves `stems.partial/` behind — empty
  if the pass was interrupted before its save loop. The job's next separation deletes it; a
  discard removes it with the rest of the directory; and the reaper removes it from a `done`,
  `error` or `cancelled` job an hour after the job last changed.

About half of WAV's ~10 MB per stem-minute at 44.1 kHz (~11 MB at 48 kHz), so roughly 125 MB for a
four-minute song. This is the dominant disk cost and the reason for several other design choices —
see [README.md](README.md#sizing).

Three endpoints read this directory, and they disagree on purpose:

- `GET /jobs/{id}/stems/{name}.flac` (the file as stored) and `.wav` (converted from it as it
  streams) validate `name` against the constant `STEM_NAMES`.
- `GET /jobs/{id}/download` globs the directory for `*.flac`, so the zip reflects what actually
  exists.

## `analysis/`

Created lazily — only if `ENABLE_CHORD_DETECTION` is on, or when a lyrics lookup or a lyrics save
arrives (`lyrics_path.parent.mkdir(parents=True, exist_ok=True)`).

### `chords.json`

Written by `run_job` as a JSON array of `ChordSegment` dumps, `indent=2`, and rewritten by every
run, a resumed one included:

```json
[
  { "start": 0.0, "end": 2.34, "chord": "N", "confidence": 1.0 },
  { "start": 2.34, "end": 4.68, "chord": "C", "confidence": 1.0 }
]
```

Served verbatim by `GET /jobs/{id}/chords` — the handler reads the file and returns the parsed
JSON without consulting the database. `confidence` is always `1.0`; see
[../api/analysis.md](../api/analysis.md#get-jobsjob_idchords).

### `key.json`

```json
{ "key": "A#", "mode": "minor", "confidence": 0.87 }
```

**Written but never served.** The key reaches clients through the job row's flattened
`key_estimate` string (`"A# minor"`) and `key_confidence`. This file is the only place the
structured form survives, which makes it useful for debugging a suspect key detection and
nothing else.

### `lyrics.json`

Written by the API rather than the pipeline, in two ways: `GET /jobs/{id}/lyrics` caches its
lookup's result here, and `PUT /jobs/{id}/lyrics` stores pasted lyrics. Holds either a
`LyricsResponse` object **or the literal `null`**:

```json
null
```

Caching the negative result is the point — it's what stops a song with no lyrics from
re-querying lrclib on every mount. The handler translates a cached `null` into a 404.

Nothing invalidates it except a `PUT`, which overwrites whatever is there, a cached `null`
included. Delete the file to force a fresh lookup.

## Permissions

The container runs as the non-root `chord` user (uid/gid 1000), created in the
[Dockerfile](../../server/Dockerfile) after dependency installation. The bind-mounted
`./server/data` must therefore be writable by uid 1000 on the host — the usual cause of a
permission error on a first run. See
[../operations/troubleshooting.md](../operations/troubleshooting.md).

## Inspecting a job

```bash
JOB=3f2a...b91
ls -laR server/data/jobs/$JOB
du -sh  server/data/jobs/$JOB
soxi    server/data/jobs/$JOB/stems/vocals.flac     # rate and bit depth, if sox is installed
jq '.[0:5]' server/data/jobs/$JOB/analysis/chords.json
jq .       server/data/jobs/$JOB/analysis/key.json
```
