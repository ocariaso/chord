# Downloads

Stems leave CHORD through one place, the export dialog: a single stem as a WAV, or all six as a zip
of WAVs. Stems are stored as 16-bit FLAC, so every export is converted on the server as it streams
([why](../architecture/decisions.md#stems-are-stored-as-flac-and-exported-as-wav)).

## Endpoints

**`GET /jobs/{job_id}/stems/{stem_name}.wav`** — `download_stem_wav` in
[`routes_stems.py`](../../server/app/api/routes_stems.py), what a stem's *Download* fetches.
`_stem_path` validates `stem_name` against `STEM_NAMES` (404 "Unknown stem" otherwise), then 404s
"Stem not ready" if the stored FLAC is absent. The response streams the stem as 16-bit PCM WAV:

```python
def _wav_stream(stem_path):
    info = sf.info(str(stem_path))
    yield struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", …, b"data", data_bytes)   # the 44-byte header
    for block in sf.blocks(str(stem_path), blocksize=_WAV_BLOCK_FRAMES, dtype="int16", always_2d=True):
        yield block.astype("<i2", copy=False).tobytes()
```

- **Exactly the separated samples.** The FLAC is lossless at 16 bits, so decoding it back gives the
  WAV separation would have written.
- **Streamed, with a size.** Every size is known from the FLAC's header, so the header goes first and
  `Content-Length` is sent (`_wav_size`); the body is decoded 65 536 frames at a time
  (`_WAV_BLOCK_FRAMES`). Nothing is written to disk or held in memory.
- **A decode per request.** Every export costs server CPU, and there are no range requests.
- Declared `def`, not `async def`, so FastAPI iterates the blocking decode in its threadpool.

Playback doesn't use this URL. It fetches `GET /jobs/{job_id}/stems/{stem_name}.flac` — the stored
file as it is, a `FileResponse` (`audio/flac`) at about half the bytes — through `stemUrl`; see
[the playback engine's load](stem-separation.md#client-side) and
[../api/artifacts.md](../api/artifacts.md).

**`GET /jobs/{job_id}/download`** — every stem as WAV in one zip, built as it streams:

```python
def _zip_stream(stem_paths):
    sink = _ChunkSink()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for stem_path in stem_paths:
            with archive.open(f"{stem_path.stem}.wav", "w") as archived:
                for chunk in _wav_stream(stem_path):
                    archived.write(chunk)
                    yield from sink.drain()
            yield from sink.drain()
    yield from sink.drain()
```

Notable properties:

- The file list comes from `sorted(stems_dir.glob("*.flac"))` — **the actual directory**, unlike
  the `stem_names` field in `JobResponse` which reports the constant `STEM_NAMES`. So this
  endpoint is honest about what exists. 404 "Stems not ready" if the glob is empty.
- The archive is flat, and its entries are the converted WAVs: `vocals.wav`, not `stems/vocals.flac`.
- **Streamed, never held in memory.** `_ChunkSink` is a write-only stream with no `tell()` or
  `seek()`, so `zipfile` writes each entry's sizes in a data descriptor after its data instead of
  seeking back, and the generator hands on whatever has been written after every WAV block. The
  download starts at once, but with no `Content-Length`, so nothing can show a percentage.
- **Deflated at level 1.** Separated stems are long stretches of near-silence, so deflate still
  shrinks WAV by nearly half. On a 60 s excerpt the six WAVs came to 63.5 MB; level 1 made 36.2 MB in
  0.9 s, the default level 6 34.9 MB in 2.1 s. The endpoint this replaced built that level-6 archive
  in server memory before sending a byte.
- Declared `def`, not `async def`, so FastAPI runs the blocking decode and compression in a
  threadpool rather than on the event loop. This is deliberate and worth preserving.
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
| a stem's *Download* | `stemDownloadUrl(jobId, name)` | `` `${base} - ${name}.wav` `` — `Creep - vocals.wav` |
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
for a zip at the duration limit, several hundred MB — and there is no percentage, only the in-flight
label, even for a single stem, whose `Content-Length` the server does send. `revokeObjectURL` is called immediately after `click()`, which works because the browser has
already taken its reference by then.

## What isn't offered

- No MP3 or FLAC export in the dialog — only 16-bit WAV at 44.1 or 48 kHz, converted from the
  stored FLACs (see [sample rate](stem-separation.md#sample-rate)). The FLACs themselves are
  reachable only through the playback URL.
- No rendered mix. Level, mute, solo, pan, tone and master are not applied; nothing exports what
  you hear.
- No download of the original upload.
- No download of `chords.json` or the lyrics, though both are plain GETs anyone can hit
  directly.
- No resumable or chunked transfer; a dropped connection means starting over.
