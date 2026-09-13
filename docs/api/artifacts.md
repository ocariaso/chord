# Artifacts API

Serving the files a job produced. Router:
[`server/app/api/routes_stems.py`](../../server/app/api/routes_stems.py), prefix `/jobs`, tag
`stems`.

All three routes read straight from `data/jobs/<job_id>/` and touch no database.

## `GET /jobs/{job_id}/thumbnail.jpg`

**Response** — `200`, `image/jpeg` (`FileResponse`). `404` *"No thumbnail available"*.

Serves `data/jobs/<job_id>/thumbnail.jpg`, produced either from the upload's embedded ID3 cover
art or from yt-dlp's downloaded artwork. See [../features/theming.md](../features/theming.md).

Check `has_thumbnail` on the job before requesting — the client does, and passes `null` to
`useDominantColors` otherwise:

```tsx
useDominantColors(job.has_thumbnail ? thumbnailUrl(job.id) : null)
```

The literal `.jpg` in the path is cosmetic (it makes the URL look like a file to browsers and
canvas loaders); the route is a normal path operation, not static file serving.

## `GET /jobs/{job_id}/stems/{stem_name}.wav`

**Response** — `200`, `audio/wav` (`FileResponse`).

| Code | When |
| --- | --- |
| 404 | `stem_name` not in `STEM_NAMES` — *"Unknown stem"* |
| 404 | the file doesn't exist yet — *"Stem not ready"* |

Valid `stem_name` values: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`.

`FileResponse` is chosen deliberately because it implements **HTTP range requests**. The same
URL is consumed twice by the browser and the second consumer requires ranges:

1. `PlaybackEngine.load()` fetches it as an `ArrayBuffer` and decodes it into an `AudioBuffer`.
2. WaveSurfer loads a media element from it, purely so it has a genuine duration for cursor
   math — a media element cannot seek without range support.

Both hits go to the same URL, so the second is normally a cache hit. See
[../architecture/audio-playback.md](../architecture/audio-playback.md#the-split-with-wavesurfer).

Files are uncompressed WAV at the model's native sample rate — roughly 10 MB per stem-minute.

## `GET /jobs/{job_id}/download`

All stems in one zip.

**Response** — `200`, `application/zip`, with
`Content-Disposition: attachment; filename="<job_id>_stems.zip"`. `404` *"Stems not ready"* when
the stems directory is missing or holds no `.wav`.

Behavior worth knowing:

- The file list is `sorted(stems_dir.glob("*.wav"))` — **the real directory contents**, unlike
  `JobResponse.stem_names`, which reports the constant `STEM_NAMES`. This endpoint is the honest
  one.
- Entries are flattened with `arcname=stem_path.name`, so the archive contains `vocals.wav`, not
  `stems/vocals.wav`.
- Declared `def`, not `async def`, so FastAPI runs it in a threadpool and the blocking
  compression doesn't stall the event loop. Preserve that.
- **The entire archive is built in a `BytesIO` and then copied by `getvalue()`.** For a
  four-minute song that's ~250 MB of audio resident twice, and `ZIP_DEFLATED` barely compresses
  WAV. Two concurrent requests are noticeable.
- The suggested filename is the raw uuid. The web client overrides it with the track title —
  see [../features/downloads.md](../features/downloads.md).

```bash
curl -OJ http://localhost:8080/api/jobs/<job_id>/download
```

## Not served

- The original upload (`original.mp3` / `original.flac`) has no endpoint.
- `analysis/key.json` is written by the pipeline but **never served** — the key reaches clients
  as the flattened `key_estimate` string on the job row. See
  [../features/chords-and-key.md](../features/chords-and-key.md#outputs-and-where-each-one-goes).
- No stem format conversion; only the WAVs Demucs wrote.
