# Downloads

Stems leave CHORD through one place, the export dialog: a single stem as a WAV, or all six as a zip.

## Endpoints

**`GET /jobs/{job_id}/stems/{stem_name}.wav`** —
[`routes_stems.py`](../../server/app/api/routes_stems.py). Validates `stem_name` against
`STEM_NAMES` (404 "Unknown stem" otherwise), then 404s "Stem not ready" if the file is absent.
Returns a `FileResponse` with `media_type="audio/wav"`.

The same URL serves two consumers: the [playback engine's load](stem-separation.md#client-side),
which reads it whole with `arrayBuffer()`, and the per-stem export below. Both fetch the **whole file**. `FileResponse` still implements HTTP range requests, but no
`<audio>` element or WaveSurfer instance is left in the client to seek with them, and nothing else
makes one, so the support is unused and harmless.

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
- **The whole archive is held in RAM.** At the twelve-minute limit, six 48 kHz stems are about
  830 MB, `ZIP_DEFLATED` barely compresses audio, and `buffer.getvalue()` copies the result again —
  well over a gigabyte of server memory for one request. Two concurrent requests will be felt.
- The filename uses the raw `job_id` (a uuid4 hex), so the user gets
  `3f2a…b91_stems.zip` unless the client renames it — which it does; see below.

## The export dialog

[`ExportDialog.tsx`](../../web/src/screens/results/ExportDialog.tsx) opens from *Export stems* in
the results topbar, at every width, or on the Console master strip, on the shared
[dialog](results-views.md#dialogs):

- the hint *Uncompressed WAV, exactly as separated.*;
- one row per stem, in the template's stem order: its hue dot, label, `WAV`, and a *Download*
  button that reads *Saving…* while it runs;
- *Close*, and *Download all (.zip)*, which reads *Preparing zip…* while it runs.

Downloads run independently: an `inFlight` set keyed by stem name (or `zip`) disables only the
button whose download is running, so several can be in flight at once. Closing the dialog cancels
nothing — each fetch carries on, and its file is still saved when it completes.

The rows come from the stems that loaded in the browser. After *Open anyway* on the
[*Stems failed to load*](stem-separation.md#stems-failed-to-load) panel, a stem that failed has no
row — though the zip, which reads the server's directory, still includes it if the file is there.

If a download fails, the dialog shows *That download didn't start — the server may be unreachable.*
under the rows. The message clears when any download starts, and doesn't say which one failed.

### Call sites

| Button | Fetches | Saved as |
| --- | --- | --- |
| a stem's *Download* | `stemUrl(jobId, name)` | `` `${base} - ${name}.wav` `` — `Creep - vocals.wav` |
| *Download all (.zip)* | `downloadAllUrl(jobId)` | `` `${base}_stems.zip` `` — `Creep_stems.zip`, containing `vocals.wav` … `other.wav` |

`base` is `baseName(job.original_filename)`, which strips `/\.(mp3|flac)$/i` — an upload's filename
without its audio extension, or a link job's title. That regex **fixes the FLAC zip-name bug**: the
old download-all stripped only `.mp3`, so a FLAC upload saved as `song.flac_stems.zip`. The stem part
of a filename is the API name (`vocals`), not the display label (`Vocals`). Characters a file system
won't accept, which link titles often contain, are left to the browser's own filename sanitizing.

## Fetching to a blob

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
   it with the names above.
2. **It can report failure.** A bare link that 404s navigates or silently does nothing; here a
   non-ok response throws, and the dialog shows its message.
3. **It knows when the transfer ends.** The `await` spans the whole download, which is what lets a
   button read *Saving…* or *Preparing zip…* until it is done.

The cost is that the entire file is buffered in browser memory before the save dialog appears —
for a zip at the duration limit, most of a gigabyte — and there is no percentage, only the in-flight
label. `revokeObjectURL` is called immediately after `click()`, which works because the browser has
already taken its reference by then.

## What isn't offered

- No MP3/FLAC export of stems — only the WAVs Demucs wrote (16-bit, at 44.1 or 48 kHz; see
  [sample rate](stem-separation.md#sample-rate)).
- No rendered mix. Level, mute, solo, pan, tone and master are not applied; nothing exports what
  you hear.
- No download of the original upload.
- No download of `chords.json` or the lyrics, though both are plain GETs anyone can hit
  directly.
- No resumable or chunked transfer; a dropped connection means starting over.
