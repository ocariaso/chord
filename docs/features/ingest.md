# Ingest

Two ways in, converging on the same job row and the same worker queue.

## Upload a file

### In the browser

[`LandingScreen.tsx`](../../web/src/screens/landing/LandingScreen.tsx) offers a dropzone that takes
a drop or a click, backed by a hidden `<input type="file" accept=".mp3,.flac,audio/mpeg,audio/flac">`
whose value is reset after each pick, so the same file can be chosen twice. Only `files[0]` is used;
a multi-file drop takes the first. Nothing is accepted while an upload or link submission is in
flight. On desktop the dropzone also carries a *Choose file* button, which stops the click from
propagating so one press doesn't open the picker twice; below 720 px the whole dropzone is a
`role="button"` that opens the picker on Enter or Space.

`accept` only filters the picker — a drop ignores it — so `rejectionFor(file)` checks every file
before anything is sent:

| Check | Dropzone hint | Alert body |
| --- | --- | --- |
| name doesn't end in `.mp3` or `.flac` (any case) | *CHORD reads MP3 and FLAC only* | *`<name>` isn't supported. CHORD reads MP3 and FLAC; convert to FLAC to keep the full dynamic range.* |
| zero bytes | *The file is empty* | *`<name>` is empty — there is no audio in it to separate.* |

A rejected file turns the dropzone's border to the danger hue, retitles it *`<name>` was rejected*,
and shows a *Rejected file* alert. Checking in the browser matters for more than speed: the server
cannot reject a bad extension until it has received the entire request body (see below).

Otherwise `App` calls `createJob(file)` in [`client.ts`](../../web/src/api/client.ts), a plain
`fetch` of the file as `multipart/form-data`. There is no upload progress. While the request is
out, the template's *Submitting…* replaces the label of the button that sends — *Choose file* on
desktop; on a phone, whose dropzone has no button, *Fetch track* — and the URL field and the buttons
are disabled.

| Response | The landing screen shows, under *Upload failed* |
| --- | --- |
| 2xx | nothing — the app moves to the processing screen |
| 413 | *That file is larger than the server accepts.* (nginx answers this itself, in HTML, so there is no JSON `detail` to show) |
| network failure | *Upload failed — the server couldn't be reached.* |
| anything else | the server's `detail` string, or *Upload failed (status)* |

The default copy, from `landingCopy` in [`design/copy.ts`](../../web/src/design/copy.ts) — *Drop an
audio file, or choose one* over *MP3 or FLAC · up to 12 minutes · 44.1 / 48 kHz preserved through
separation*, plus *Six stems: vocals · drums · bass · guitar · piano · other* — makes three promises
the server keeps: the formats, the [duration limit](#the-duration-limit), and
[sample-rate preservation](stem-separation.md#sample-rate). A phone reads *Choose an audio file*
over *MP3 or FLAC · up to 12 minutes*.

### On the server

`POST /jobs`, `multipart/form-data`, field name `file`. FastAPI parses the whole multipart body
before [`create_job`](../../server/app/api/routes_jobs.py) runs, then the handler:

1. Takes `Path(file.filename).suffix.lower()` and rejects anything outside
   `ALLOWED_UPLOAD_EXTENSIONS = {".mp3", ".flac"}` with a 400, *"Only .mp3 and .flac uploads are
   supported"*.
2. Mints `uuid4().hex` as the job id and creates `data/jobs/<job_id>/`.
3. Streams the upload to `original<extension>` with `_save_upload` — `shutil.copyfileobj` in 1 MB
   chunks — through `run_in_threadpool`, so the copy never blocks the event loop. An empty result
   removes the directory again and returns a 400, *"Uploaded file is empty"*.
4. Inserts the row (`status=queued`, `progress=0`, `original_filename=file.filename`).
5. `enqueue(job_id)` and returns 202 with the full `JobResponse`.

The extension is kept so the pipeline can find the file later with `glob("original.*")`.

The file is never held in memory, but it is on disk twice for a moment: Starlette spools the
multipart part to a temporary file while parsing, and `_save_upload` copies that spool into the job
directory. Validation on the server is still by **extension only**; whether the file is really audio
is discovered when the worker [reads it](#reading-the-audio).

### Size limits

| Layer | Limit |
| --- | --- |
| nginx, in the Docker deployment | `client_max_body_size 512m` on `/api/` — a larger body gets a 413 |
| FastAPI, the Vite dev proxy, a bare server | none |
| duration | 12 minutes by default, checked after the upload — see [the duration limit](#the-duration-limit) |

The explicit nginx limit exists because its default is 1 MB. 512 MB is well above a twelve-minute
lossless file at ordinary rates — 24-bit/48 kHz stereo is about 207 MB for twelve minutes before
FLAC compresses it — and only very high sample rates come near it.

nginx buffers the request body before passing it on (the config turns off only *response*
buffering), so the browser has finished sending well before the server has the file. *Submitting…*
covers all of it — the upload, nginx forwarding the body, the server's copy — with nothing to show
which part is slow.

## Paste a link

`POST /jobs/from-url`, JSON body `{"url": "..."}`.

The form uses `type="url"` with `required`, so the browser validates the address before submitting;
the value is trimmed, and the button reads *Submitting…* while the POST is in flight. A rejected POST
shows under *Couldn't fetch that link*: the server's `detail`, *Failed to start download (status)*
when there is none, or *Couldn't start the download — the server couldn't be reached.* when no
response arrived.

[`create_job_from_url`](../../server/app/api/routes_jobs.py) rejects a blank URL with a 400, then
inserts a row with **both** `original_filename` and `source_url` set to the URL — so the processing
screen has something to display before the real title is known — and enqueues. No network call
happens in the request; the fetch is the worker's job, and a bad link surfaces later as a job
failure rather than on the landing screen.

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
    "match_filter": skip_if_too_long,
}
```

- `bestaudio/best` plus the `FFmpegExtractAudio` postprocessor means **whatever the source is,
  the pipeline always gets a 192 kbps MP3** at `original.mp3`. This is why `run_job` can
  hardcode `original.mp3` for URL jobs while upload jobs glob for the extension.
- `noplaylist` — a link into a playlist fetches only that one track.
- `writethumbnail` saves the cover image next to the audio; see below.
- `match_filter` refuses a source that is too long **from its metadata, before downloading
  anything**. `skip_if_too_long` records the duration and returns a string, which is how yt-dlp is
  told to skip; once `extract_info` returns, `download_audio` raises `TrackTooLongError`. A source
  whose metadata has no duration — some direct file links, for instance — is downloaded in full and
  caught by the check after [reading the audio](#reading-the-audio).
- Returns `(path, title, author)` where `author` is `info["uploader"]` or `info["channel"]`.
  `run_job` then writes `original_filename=title, author=author` with `_record_track_identity`, so
  the UI's title switches from the raw URL to the real track title mid-job. That one write isn't
  scoped to the run's attempt: a job cancelled during its download still keeps the title and
  author, which matters because a resume skips the download that found them.

`run_job` sets `status=fetching`, `progress=0.05` and *Downloading audio* before the download — but
only when `original.mp3` doesn't exist yet. A [resumed](stem-separation.md#resume) link job keeps the
audio its cancelled attempt already fetched. Until the file is in place the run's failure stage is
`downloading`, so an unexpected error there reads *"The audio download stopped with an error."*

Any `yt_dlp.utils.DownloadError` is re-raised as `SourceDownloadError`, a `UserFacingError` whose
message is written for a human: *"Couldn't download audio from that link. Check that the URL is
correct and publicly accessible."* It is raised `from` the original error, so yt-dlp's own text
becomes the job's `error_log`, which the failure panel shows as a log.

Anything yt-dlp supports works — YouTube, SoundCloud, Bandcamp, a direct file URL. There is no
allowlist and no size cap, and the server will follow any URL it is given (a deliberate capability
here, but a server-side request forgery surface if this were ever exposed beyond a trusted network).

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
                source_url set? ──yes──► original.mp3 exists? ──no──► fetching: yt-dlp → original.mp3
                              │                         │              title/author overwrite the row
                              │                         yes (resumed) ─┐
                              └──no───► ffprobe artist tag → author    │
                                                     │ ◄───────────────┘
                                          embedded cover → thumbnail.jpg, if there is none yet
                                                     │
                                          read_audio_info → duration, audio_format
                                          longer than MAX_DURATION_SECONDS? → error
                                                     │
                                          status=separating, with duration_seconds and audio_format
                                                     │
                                                   (identical from here on)
```

Artist for uploads comes from [`metadata.py`](../../server/app/pipeline/metadata.py)'s
`extract_author`, which shells out to `ffprobe -print_format json -show_format` and takes the first
present tag among `artist`, `ARTIST`, `Artist`, `album_artist`, `ALBUM_ARTIST`. Every failure mode —
ffprobe missing, a 15 s timeout, a non-zero exit, unparseable JSON, no tag — returns `None`, and the
job proceeds without an author. `author` feeds the results topbar, the processing screen's subtitle
and the lyrics lookup.

## Reading the audio

`metadata.read_audio_info(path)` opens the file with `soundfile.info` and returns the duration
(`frames / samplerate`) and a short format label:

| Source | Label |
| --- | --- |
| a PCM subtype with a fixed bit depth, e.g. FLAC | `"<format> <bits>/<kHz>"` — `FLAC 24/48`, `FLAC 16/44.1` |
| lossy, e.g. MP3 | `"<format> <kHz> kHz"` — `MP3 44.1 kHz` |

Unlike `extract_author`, this **raises** when libsndfile can't open the file, because nothing after
it can run without a duration. A misnamed or corrupt upload therefore fails here, before separation,
with *"CHORD couldn't read the audio source."* and libsndfile's error as the log.

`duration_seconds` and `audio_format` are written in the same update that sets `status=separating`,
not with the final results, so the processing screen can show `author · 3:51 · FLAC 24/48` while
separation runs — `author · 3:51` on a phone, whose layout leaves the format out. `duration_seconds`
also drives the lyrics lookup.

### The duration limit

`MAX_DURATION_SECONDS` ([`config.py`](../../server/app/core/config.py), default `720`, `0` disables)
caps what the server will separate. The reason is in the browser: each stem is decoded into 32-bit
float samples at the audio context's rate, so twelve minutes of stereo at 48 kHz is about 276 MB per
stem and 1.7 GB for all six in one tab.

| Source | Checked |
| --- | --- |
| upload | after the whole file has been uploaded, read and had its cover extracted; before separation |
| link | from yt-dlp's metadata before downloading; again after download when the metadata had no duration |

Either way the job fails with `TrackTooLongError`'s message, *"This track is 13:05 long. CHORD
separates tracks up to 12 minutes."*, and no log. The length is rounded up to the second, so a track
a fraction of a second over a twelve-minute limit reads `12:01`, never `12:00`. The limit is not in
any API response, so the browser can't check it before uploading, and the landing page's *up to 12
minutes* is hardcoded in `landingCopy` in `design/copy.ts` — changing the setting leaves that copy
wrong.

## Failures after the job starts

Anything that fails once the 202 has been returned lands on the job row, and `App` shows the
template's *Separation failed* panel — the same title whichever stage failed — with the row's
`error_message` as its body, `error_log` in a log block when there is one, *Try another source*, and
*Copy log*, which copies the log or, without one, the message (see
[job lifecycle](../architecture/job-lifecycle.md#failures)). `run_job`'s `_describe_failure` decides
what reaches the row: a `UserFacingError` is shown verbatim, with its chained cause as the log; any
other exception becomes a sentence about the stage, with `"<ExceptionType>: <message>"` as the log.

| Failure | Body | Log |
| --- | --- | --- |
| link unreachable or not audio | the `SourceDownloadError` sentence | yt-dlp's error |
| link too long, from metadata | *This track is M:SS long…* | — |
| link too long, found only after download (its metadata had no duration) | *This track is M:SS long…* | — |
| upload unreadable | *CHORD couldn't read the audio source.* | libsndfile's error |
| upload too long | *This track is M:SS long…* | — |
| a resumed job that fails while reading | as above | as above |

Since the title never names the stage, a link that couldn't download and an upload that couldn't be
read differ on the panel only in their body and log.

## Known gaps

- The server rejects a bad extension only after receiving the entire body; the browser's check is
  what spares a user that wait, and API clients get no such check.
- No upload progress: a large file reads *Submitting…* from the first byte until the job exists.
- An upload is briefly on disk twice (Starlette's spool and the job copy).
- An upload in flight can't be cancelled, and a dropped connection starts it over.
- No size limit outside nginx — the Vite dev server and a bare server accept any body.
- Extension-only validation on the server; content is checked only when the worker reads it.
- The *up to 12 minutes* copy doesn't follow `MAX_DURATION_SECONDS`.
- No duplicate detection: the same song uploaded twice is two full jobs.
