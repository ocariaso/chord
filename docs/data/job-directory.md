# Job directory layout

One directory per job at `server/data/jobs/<job_id>/`, where `<job_id>` is the row's
`uuid4().hex`. Created by the job-creation endpoint, populated by the worker, deleted by
[discard](retention.md#discard).

```
server/data/jobs/<job_id>/
├── original.mp3            or original.flac — the source audio
├── thumbnail.jpg           cover art, if any was found
├── stems/
│   ├── vocals.wav
│   ├── drums.wav
│   ├── bass.wav
│   ├── guitar.wav
│   ├── piano.wav
│   └── other.wav
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
  hardcode the name for the URL path.

This naming has one hazard: yt-dlp's `writethumbnail` also writes `original.<ext>` for the
artwork (`.webp`, `.png`, `.jpg`). `_normalize_downloaded_thumbnail` in
[`source.py`](../../server/app/pipeline/source.py) exists solely to resolve that collision —
it globs `original.*`, skips `.mp3`, converts whatever's left to `thumbnail.jpg`, and unlinks
it. Anything that globs this directory must run *after* that normalization.

Never served by any endpoint.

## `thumbnail.jpg`

Filename is the constant `THUMBNAIL_FILENAME` in
[`thumbnail.py`](../../server/app/pipeline/thumbnail.py), imported by the routes that need it
rather than re-typed.

Written by one of two paths — ffmpeg extracting an embedded ID3 cover, or ffmpeg converting
yt-dlp's downloaded artwork. `run_job` only attempts the embedded-cover extraction **if the file
doesn't already exist**, so for URL jobs the source's artwork wins.

Its existence is the entire implementation of `has_thumbnail`: `_row_to_response` does a
`Path.exists()` check on every serialization rather than storing a flag. Served by
`GET /jobs/{id}/thumbnail.jpg`.

## `stems/`

Six uncompressed WAVs at the Demucs model's native sample rate (44.1 kHz), written by
`save_audio` in [`separation.py`](../../server/app/pipeline/separation.py). Names come from the
model's own output keys and match `STEM_NAMES`.

~10 MB per stem-minute, so ~250 MB for a four-minute song. This is the dominant disk cost and
the reason for several other design choices — see [README.md](README.md#sizing).

Two endpoints read this directory, and they disagree on purpose:

- `GET /jobs/{id}/stems/{name}.wav` validates `name` against the constant `STEM_NAMES`.
- `GET /jobs/{id}/download` globs the directory, so the zip reflects what actually exists.

## `analysis/`

Created lazily — only if `ENABLE_CHORD_DETECTION` is on, or when a lyrics request arrives
(`lyrics_path.parent.mkdir(parents=True, exist_ok=True)`).

### `chords.json`

Written by `run_job` as a JSON array of `ChordSegment` dumps, `indent=2`:

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

The lyrics cache, written by the API handler rather than the pipeline. Holds either a
`LyricsResponse` object **or the literal `null`**:

```json
null
```

Caching the negative result is the point — it's what stops a song with no lyrics from
re-querying lrclib on every mount. The handler translates a cached `null` into a 404.

There is no invalidation: once written, that file is the answer for the life of the job. Delete
it to force a fresh lookup.

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
jq '.[0:5]' server/data/jobs/$JOB/analysis/chords.json
jq .       server/data/jobs/$JOB/analysis/key.json
```
