# Artifacts API

Serving the files a job produced. Router:
[`server/app/api/routes_stems.py`](../../server/app/api/routes_stems.py), prefix `/jobs`, tag
`stems`.

All three routes read straight from `data/jobs/<job_id>/` and touch no database.

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

## `GET /jobs/{job_id}/stems/{stem_name}.wav`

**Response** — `200`, `audio/wav` (`FileResponse`).

| Code | When |
| --- | --- |
| 404 | `stem_name` not in `STEM_NAMES` — *"Unknown stem"* |
| 404 | the file doesn't exist — *"Stem not ready"* |

Valid `stem_name` values: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`.

Separation writes into `stems.partial/` and renames it to `stems/` only once every stem exists,
so *"Stem not ready"* holds for all six until separation has finished. A stem still missing after
that is one the model never produced — see [contract-sync.md](contract-sync.md).

The browser fetches each stem URL **once** per load. `PlaybackEngine.load()` streams the body,
reading `Content-Length` to report download progress, and decodes it into an `AudioBuffer`; the
waveform is traced from that decoded buffer, so nothing requests the file a second time. The
Export dialog fetches it again, as a blob, only when the stem is saved.

`FileResponse` implements HTTP range requests, but no client consumer needs them now.

Files are WAV at the source's sample rate when that is 44.1 or 48 kHz, and at the model's
44.1 kHz otherwise — roughly 10 MB per stem-minute at 44.1 kHz. See
[../data/job-directory.md](../data/job-directory.md#stems).

## `GET /jobs/{job_id}/download`

All stems in one zip.

**Response** — `200`, `application/zip`, with
`Content-Disposition: attachment; filename="<job_id>_stems.zip"`. `404` *"Stems not ready"* when
the stems directory is missing or holds no `.wav`.

Behavior worth knowing:

- The file list is `sorted(stems_dir.glob("*.wav"))` — **the real directory contents**, unlike
  `JobResponse.stem_names`, which reports the constant `STEM_NAMES`. This endpoint is the honest
  one. It never looks in `stems.partial/`.
- Entries are flattened with `arcname=stem_path.name`, so the archive contains `vocals.wav`, not
  `stems/vocals.wav`.
- Declared `def`, not `async def`, so FastAPI runs it in a threadpool and the blocking
  compression doesn't stall the event loop. Preserve that.
- **The entire archive is built in a `BytesIO` and then copied by `getvalue()`.** For a
  four-minute song that's ~250 MB of audio resident twice; for a twelve-minute track with 48 kHz
  stems, ~830 MB twice. `ZIP_DEFLATED` barely compresses WAV. Nothing reaches the client until the
  archive is complete, and the client's `downloadFile` then buffers the whole response as a `Blob`
  before saving it — the Export dialog reads *Preparing zip…* throughout, with no progress.
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
- No stem format conversion; only the WAVs separation wrote.
