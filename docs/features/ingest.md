# Ingest

Two ways in, converging on the same job row and the same worker queue.

## Upload a file

`POST /jobs`, `multipart/form-data`, field name `file`.

[`create_job`](../../server/app/api/routes_jobs.py) in order:

1. Takes `Path(file.filename).suffix.lower()` and rejects anything outside
   `ALLOWED_UPLOAD_EXTENSIONS = {".mp3", ".flac"}` with a 400.
2. Mints `uuid4().hex` as the job id and creates `data/jobs/<job_id>/`.
3. `contents = await file.read()` — **the entire file into memory**, then rejects empty
   uploads with a 400.
4. Writes it to `original<extension>`, preserving the extension so the pipeline can find it
   later with `glob("original.*")`.
5. Inserts the row (`status=queued`, `progress=0`, `original_filename=file.filename`).
6. `enqueue(job_id)` and returns 202 with the full `JobResponse`.

Validation is by **extension only** — no magic-byte sniffing, no size limit, no MIME check.
A misnamed file fails later, inside the pipeline, as a generic `error` status.

The browser side ([`UploadPanel.tsx`](../../web/src/components/UploadPanel.tsx)) offers a
drag-and-drop zone and a hidden `<input type="file" accept=".mp3,.flac,audio/mpeg,audio/flac">`
clicked through the zone. Only `files[0]` is used; a multi-file drop silently takes the first.

## Paste a link

`POST /jobs/from-url`, JSON body `{"url": "..."}`.

[`create_job_from_url`](../../server/app/api/routes_jobs.py) rejects a blank/whitespace URL with
a 400, then inserts a row with **both** `original_filename` and `source_url` set to the URL —
so the processing screen has something to display before the real title is known — and enqueues.
No network call happens in the request; the fetch is the worker's job.

### The download

[`source.py`](../../server/app/pipeline/source.py) wraps yt-dlp:

```python
ydl_opts = {
    "format": "bestaudio/best",
    "outtmpl": str(output_dir / "original.%(ext)s"),
    "postprocessors": [{"key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3", "preferredquality": "192"}],
    "writethumbnail": True,
    "quiet": True, "no_warnings": True, "noplaylist": True,
}
```

- `bestaudio/best` plus the `FFmpegExtractAudio` postprocessor means **whatever the source is,
  the pipeline always gets a 192 kbps MP3** at `original.mp3`. This is why `run_job` can
  hardcode `original.mp3` for URL jobs while upload jobs glob for the extension.
- `noplaylist` — a link into a playlist fetches just that one track.
- `writethumbnail` saves the cover image next to the audio; see below.
- Returns `(path, title, author)` where `author` is `info["uploader"]` or `info["channel"]`.
  `run_job` then `UPDATE`s `original_filename=title, author=author`, so the UI's title switches
  from the raw URL to the real track title mid-job.

Any `yt_dlp.utils.DownloadError` is caught and re-raised as `SourceDownloadError`, whose message
is written for a human: *"Couldn't download audio from that link. Check that the URL is correct
and publicly accessible."* Because `run_job` writes `str(exc)` into `error_message` and the UI
renders it verbatim, this is the one failure path with a genuinely user-facing message.

Anything yt-dlp supports works — YouTube, SoundCloud, Bandcamp, a direct file URL. There is no
allowlist, no size cap and no duration cap, and the server will follow any URL it is given
(a deliberate capability here, but a server-side request forgery surface if this were ever
exposed beyond a trusted network).

### Thumbnail normalization

yt-dlp writes its thumbnail as `original.<ext>` — the same stem as the audio, with whatever
extension the source used (`.webp`, `.jpg`, `.png`). `_normalize_downloaded_thumbnail` walks
`output_dir.glob("original.*")`, skips `.mp3`, converts whatever it finds to
`thumbnail.jpg` through ffmpeg, and unlinks the original. That collision of names is exactly why
the function exists, and why it must run before anything else globs the directory.

## Where the two paths converge

```
upload:   original.mp3 / original.flac on disk, filename = user's filename
url:      nothing on disk yet,                  filename = the URL
                        │
                        └──► queued ──► worker ──► run_job
                                                     │
                          source_url set? ──yes──► fetching: yt-dlp → original.mp3
                                          │                  title/author overwrite the row
                                          └──no───► ffprobe ID3 artist → author
                                                     │
                                                   (identical from here on)
```

Artist for uploads comes from [`metadata.py`](../../server/app/pipeline/metadata.py), which
shells out to `ffprobe -print_format json -show_format` and takes the first present tag among
`artist`, `ARTIST`, `Artist`, `album_artist`, `ALBUM_ARTIST`. Every failure mode — ffprobe
missing, a 15 s timeout, a non-zero exit, unparseable JSON, no tag — returns `None`, and the job
proceeds without an author. `author` feeds the mixer's subtitle line and the lyrics lookup.

## Known gaps

- **Both create endpoints read the whole upload into RAM** (`await file.read()`) before writing
  it. A large FLAC is held entirely in memory.
- No upload size limit anywhere in the stack — not in FastAPI, not in nginx
  (`client_max_body_size` is unset, so nginx's 1 MB default applies to the proxied POST in the
  Docker deployment and will reject larger uploads with a 413).
- Extension-only validation; a `.mp3` that isn't audio produces an opaque pipeline error.
- No duplicate detection: the same song uploaded twice is two full jobs.
