# Artifacts API

Serving the files a job produced. Router:
[`server/app/api/routes_stems.py`](../../server/app/api/routes_stems.py), prefix `/jobs`, tag
`stems`.

All four routes read straight from `data/jobs/<job_id>/` and touch no database.

## `GET /jobs/{job_id}/thumbnail.jpg`

**Response** — `200`, `image/jpeg` (`FileResponse`). `404` *"No thumbnail available"*.

Serves `data/jobs/<job_id>/thumbnail.jpg`, produced by
[`thumbnail.py`](../../server/app/pipeline/thumbnail.py) either from the upload's embedded cover
art or from yt-dlp's downloaded artwork.

Check `has_thumbnail` on the job before requesting — the client does.
[`CoverArt`](../../web/src/components/CoverArt.tsx) always draws an accent-gradient tile and adds
the image only when the job has one, blended through Nocturne's `.lighten`. If the request fails
anyway, `onError` hides the image and the tile remains:

```tsx
{hasThumbnail && !failed && (
  <img
    src={thumbnailUrl(jobId)}
    alt=""
    className="lighten size-full object-cover"
    onError={() => setFailed(true)}
  />
)}
```

The image is only displayed. Nothing samples colors from it; the palette is fixed — see
[../features/theming.md](../features/theming.md).

The literal `.jpg` in the path is cosmetic (it makes the URL look like a file); the route is a
normal path operation, not static file serving.

## `GET /jobs/{job_id}/stems/{stem_name}.flac`

The stem as stored, for playback.

**Response** — `200`, `audio/flac` (`FileResponse`).

| Code | When |
| --- | --- |
| 404 | `stem_name` not in `STEM_NAMES` — *"Unknown stem"* |
| 404 | the file doesn't exist — *"Stem not ready"* |

Valid `stem_name` values: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`. Both stem routes
check them the same way, in `_stem_path`.

Separation writes into `stems.partial/` and renames it to `stems/` only once every stem exists,
so *"Stem not ready"* holds for all six until separation has finished. A stem still missing after
that is one the model never produced — see [contract-sync.md](contract-sync.md).

The browser fetches each stem URL (`stemUrl`) **once** per load. `PlaybackEngine.load()` reads the
body whole and decodes it into an `AudioBuffer` — `decodeAudioData` reads FLAC natively; the
waveform is traced from that decoded buffer, so nothing requests the file a second time.

`FileResponse` implements HTTP range requests, but no client consumer needs them now.

Files are 16-bit FLAC at the source's sample rate when that is 44.1 or 48 kHz, and at the model's
44.1 kHz otherwise — about half the ~10 MB per stem-minute the same audio takes as WAV. See
[../data/job-directory.md](../data/job-directory.md#stems).

## `GET /jobs/{job_id}/stems/{stem_name}.wav`

The stem as uncompressed WAV, for export (`stemDownloadUrl`).

**Response** — `200`, `audio/wav` (`StreamingResponse`), with `Content-Length`. The same 404s as
the `.flac` route.

`download_stem_wav` converts the stored FLAC as it streams: `_wav_stream` sends a 44-byte PCM
header, whose sizes come from the FLAC's own header, then decodes the FLAC 65 536 frames at a time
with `soundfile` and sends each block as 16-bit little-endian PCM. The FLAC is lossless at 16 bits,
so the samples are exactly the separated ones. Nothing is written or held in memory; each request
costs a decode. It is a plain `def`, so the decode runs in FastAPI's threadpool. No range requests.

## `GET /jobs/{job_id}/download`

All stems in one zip, as WAV.

**Response** — `200`, `application/zip` (`StreamingResponse`, no `Content-Length`), with
`Content-Disposition: attachment; filename="<job_id>_stems.zip"`. `404` *"Stems not ready"* when
the stems directory is missing or holds no `.flac`.

Behavior worth knowing:

- The file list is `sorted(stems_dir.glob("*.flac"))` — **the real directory contents**, unlike
  `JobResponse.stem_names`, which reports the constant `STEM_NAMES`. This endpoint is the honest
  one. It never looks in `stems.partial/`.
- The archive is flat and holds WAVs: each FLAC is converted as it is written, by the same
  `_wav_stream` as the `.wav` route, into an entry named `<stem>.wav` — `vocals.wav`, not
  `stems/vocals.flac`.
- **Streamed as it's built.** `_zip_stream` writes into `_ChunkSink`, a write-only stream with no
  `tell()` or `seek()`, so `zipfile` puts each entry's sizes in a data descriptor after its data, and
  the generator yields whatever has been written after every block. The first bytes leave at once
  and the archive is never held in memory — which is also why there is no `Content-Length`.
- **Deflated at level 1** (`ZIP_DEFLATED`, `compresslevel=1`). Separated stems are long stretches
  of near-silence, so even the fastest level takes a 60 s excerpt's six WAVs from 63.5 MB to 36.2 MB
  in 0.9 s, where the default level 6 reaches 34.9 MB in 2.1 s.
- Declared `def`, not `async def`, so FastAPI iterates the blocking decode and compression in a
  threadpool instead of stalling the event loop. Preserve that.
- The client's `downloadFile` still buffers the whole response as a `Blob` before saving it — the
  Export dialog reads *Preparing zip…* throughout, with no progress.
- The suggested filename is the raw uuid. The Export dialog saves it as `"<title>_stems.zip"`
  instead, with a trailing `.mp3` or `.flac` stripped from the title — see
  [../features/downloads.md](../features/downloads.md).

```bash
curl -OJ http://localhost:8080/api/jobs/<job_id>/download
```

## Not served

- The original upload (`original.mp3` / `original.flac`) has no endpoint.
- `analysis/key.json` is written by the pipeline but **never served** — the key reaches clients
  as the flattened `key_estimate` string on the job row. See
  [../features/chords-and-key.md](../features/chords-and-key.md#outputs-and-where-each-one-goes).
- No format choice: stems come as the stored 16-bit FLAC or as WAV converted from it, nothing else.
