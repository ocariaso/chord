# Downloads

Two paths: one stem, or all six as a zip.

## Endpoints

**`GET /jobs/{job_id}/stems/{stem_name}.wav`** —
[`routes_stems.py`](../../server/app/api/routes_stems.py). Validates `stem_name` against
`STEM_NAMES` (404 "Unknown stem" otherwise), then 404s "Stem not ready" if the file is absent.
Returns a `FileResponse` with `media_type="audio/wav"`.

`FileResponse` is chosen specifically because it implements **HTTP range requests**, which the
same URL needs for a second purpose — WaveSurfer loads a media element from it and cannot seek
without ranges. The route's own comment says so.

**`GET /jobs/{job_id}/download`** — builds the archive in memory:

```python
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
    for stem_path in stem_paths:
        zip_file.write(stem_path, arcname=stem_path.name)
return Response(buffer.getvalue(), media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{job_id}_stems.zip"'})
```

Notable properties:

- The file list comes from `sorted(stems_dir.glob("*.wav"))` — **the actual directory**, unlike
  the `stem_names` field in `JobResponse` which reports the constant `STEM_NAMES`. So this
  endpoint is honest about what exists. 404 "Stems not ready" if the glob is empty.
- `arcname=stem_path.name` flattens the archive: `vocals.wav`, not `stems/vocals.wav`.
- Declared `def`, not `async def`, so FastAPI runs it in a threadpool — the blocking zip
  compression doesn't stall the event loop. This is deliberate and worth preserving.
- **The whole archive is held in RAM.** Six uncompressed WAVs of a four-minute song is ~250 MB,
  and `ZIP_DEFLATED` barely compresses audio. `buffer.getvalue()` then copies it again. Two
  concurrent requests will be felt.
- The filename uses the raw `job_id` (a uuid4 hex), so the user gets
  `3f2a…b91_stems.zip` unless the client renames it — which it does; see below.

## Client side

[`utils/download.ts`](../../web/src/utils/download.ts) is the shared mechanism:

```ts
export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(objectUrl);
}
```

Fetch-to-blob rather than a plain `<a href download>` for three reasons:

1. **It can name the file.** The server's `Content-Disposition` uses the job id; this overrides
   it with something meaningful — `vocals.wav`, or `<title>_stems.zip`.
2. **It can report failure.** A bare link that 404s navigates or silently does nothing; here a
   non-ok response throws and the caller can react.
3. **It gives a spinner.** The `await` spans the transfer, so the UI can show progress.

The cost is that the entire file is buffered in browser memory before the save dialog appears,
and `revokeObjectURL` is called immediately after `click()` — which works because the browser
has already taken its reference by then.

### Call sites

| Where | Filename |
| --- | --- |
| `StemChannel` (Simple) | `` `${name}.wav` `` |
| Studio amps, via [`useDownload`](../../web/src/components/studio/useDownload.ts) | `` `${name}.wav` `` |
| `StemMixer.handleDownloadAll` | `` `${baseName}_stems.zip` `` |

`handleDownloadAll` derives the base name with
`job.original_filename.replace(/\.mp3$/i, "")` — which **misses `.flac`**, despite FLAC being an
accepted upload format. A FLAC upload downloads as `song.flac_stems.zip`. A small, real bug; the
regex needs `/\.(mp3|flac)$/i`.

Every call site follows the same pattern — a local `isDownloading` boolean, a `try/finally`, and
an empty `catch` with a comment:

```ts
} catch {
  // The download simply won't start; nothing else to recover here.
}
```

Swallowing is intentional: there is no meaningful recovery, and a modal for a failed download
would be worse than nothing. `useDownload` packages exactly this for the Studio amps, returning
`{isDownloading, download}`; `StemChannel` and `StemMixer` hand-roll the same shape.

## UI affordances

- **Simple view** — a download icon per `StemChannel` row, and a tray icon in the header for all
  stems. Both swap to a spinning border-circle while in flight.
- **Studio view** — each amp has its own download button plus a
  [`DownloadLed`](../../web/src/components/studio/DownloadLed.tsx): an indicator lamp lit in the
  amp's own idle color that switches to a shared amber (`#f97316`) while downloading. The tray
  icon for download-all sits in `MasterUnit`.

`isDownloadingAll` lives in `StemMixer` and is passed to both views, so the zip's progress is
reflected wherever the user triggered it.

## What isn't offered

- No MP3/FLAC export of stems — only the raw WAVs Demucs wrote.
- No download of the original upload.
- No download of `chords.json` or the lyrics, though both are plain GETs anyone can hit
  directly.
- No resumable or chunked transfer; a dropped connection means starting over.
