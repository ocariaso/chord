# Jobs API

Router: [`server/app/api/routes_jobs.py`](../../server/app/api/routes_jobs.py), prefix `/jobs`,
tag `jobs`.

## `JobResponse`

The shape returned by every endpoint on this page. Defined in
[`schemas.py`](../../server/app/models/schemas.py), mirrored as `Job` in
[`client.ts`](../../web/src/api/client.ts).

```jsonc
{
  "id": "3f2a…b91",                 // uuid4 hex
  "original_filename": "song.flac", // or the URL, until yt-dlp reports the real title
  "author": "Artist Name",          // null until known; ID3 artist or yt-dlp uploader
  "status": "separating",           // see the status table below
  "progress": 0.237,                // 0.0 … 1.0 — measured during separation, fixed steps elsewhere
  "stage_message": "Separating stems",
  "error_message": null,            // a sentence for the user when status is "error"
  "error_log": null,                // the technical detail behind it, if there is any
  "stems_model": null,              // ALWAYS null — see below
  "duration_seconds": 214.6,        // written when separation starts; null before
  "audio_format": "FLAC 24/48",     // written with duration_seconds; "MP3 44.1 kHz" for lossy sources
  "key_estimate": null,             // "<root> <mode>", sharps only, e.g. "A# minor" — set with "done"
  "key_confidence": null,           // set with "done"
  "tempo_bpm": null,                // one decimal place — set with "done"; null if no beat was found
  "created_at": "2026-09-12T14:03:11.482913+00:00",
  "updated_at": "2026-09-12T14:04:02.117845+00:00",
  "stem_names": [],                 // computed, not stored — see below
  "has_thumbnail": true             // computed, not stored — a filesystem check
}
```

Fields that behave unexpectedly:

- **`stems_model` is always `null`.** The column exists, the schema carries it, the client type
  declares it — but nothing ever writes it. The Demucs model name lives only in
  `settings.demucs_model`.
- **`stem_names` is not a directory listing.** `_row_to_response` returns the constant
  `STEM_NAMES` (all six) when `status == "done"`, and `[]` otherwise. A job that produced fewer
  stems would still advertise six. The zip endpoint, by contrast, globs the real directory.
- **`has_thumbnail` is a `stat` on every serialization**, including each 0.5 s SSE tick.
- **`progress` is only partly a measurement.** During separation it follows Demucs' own chunk
  progress across 0.10–0.50, written at most once per percentage point. Everywhere else it is a
  fixed step: `0 → 0.05` (download) `→ 0.10 … 0.50` (separation) `→ 0.50` (tempo) `→ 0.60`
  (chords and key) `→ 1.0`. An upload never shows 0.05.
- **`error_message` and `error_log` split one failure by audience.** `error_message` is always
  written for the person using CHORD: the text of a `UserFacingError` — a failed download, a
  track over the duration limit — or else a fixed sentence for the stage that failed, such as
  *"Stem separation stopped with an error."* The exception goes to `error_log`: as
  `"<ExceptionType>: <message>"`, or, for a `UserFacingError`, the text of the exception it was
  chained from, and `null` when there was none. The web client shows the first as the failure
  panel's body and the second in a copyable log. See
  [../conventions/python.md](../conventions/python.md#error-handling).
- **`stage_message` usually survives a failure.** The `error` write leaves it alone, so a failed
  job still carries the last stage message written. The exception is a failure while the worker
  reads the audio — after a link's download, before separation — which sets it to `null`, so an
  unreadable or over-long download doesn't keep *Downloading audio*. The web client doesn't read it
  on a failed job: every failure panel is titled *Separation failed*, and `error_message` says what
  happened.

The row also has an `attempt` column that `JobResponse` deliberately leaves out; see
[resume](#post-jobsjob_idresume).

### Status values

| `status` | Terminal | Meaning |
| --- | --- | --- |
| `queued` | | row inserted or resumed; the worker hasn't picked it up |
| `fetching` | | yt-dlp downloading (URL jobs only; skipped when a resumed job already has the audio) |
| `separating` | | Demucs running — and tempo detection, later in the same status |
| `analyzing` | | madmom chord/key detection |
| `done` | ✓ | success; all result fields populated |
| `error` | ✓ | `error_message` is set, and usually `error_log` |
| `cancelled` | ✓ | user-initiated, or a discard of a running job — the one terminal status a request can reverse |

Full transition detail: [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md).

---

## `POST /jobs`

Create a job from an uploaded file.

**Request** — `multipart/form-data`, field name `file`.

**Response** — `202 Accepted`, `JobResponse` with `status: "queued"`.

| Code | When |
| --- | --- |
| 400 | extension not in `{.mp3, .flac}` — *"Only .mp3 and .flac uploads are supported"* |
| 400 | the uploaded body is empty — *"Uploaded file is empty"*; the job directory is removed again |
| 413 | the body is over 512 MB — answered by nginx in the Docker deployment, never by FastAPI |
| 422 | no `file` field — FastAPI's validation error |

```bash
curl -X POST http://localhost:8080/api/jobs -F "file=@song.flac"
```

Validation is **by file extension only** — no magic bytes, no MIME check. A file that isn't
audio is accepted here and fails in the worker with *"CHORD couldn't read the audio source."* The
web client refuses other extensions and empty files before sending anything, with its own copy.

**Size.** The server sets no limit. By the time the handler runs, Starlette's multipart parser
has already spooled the body to a temporary file; `_save_upload` then copies it to
`data/jobs/<id>/original<ext>` in 1 MB chunks (`shutil.copyfileobj`) on a threadpool thread
(`run_in_threadpool`). A large upload never sits in memory and never blocks the event loop, at
the cost of existing twice on disk until the request completes. The effective limit is nginx's
`client_max_body_size 512m` in [`nginx.conf`](../../web/nginx.conf), sized for a twelve-minute
lossless file; local development through the Vite proxy has none. The client uploads with a
plain `fetch`, so there is no upload progress, and turns
nginx's HTML 413 page into *"That file is larger than the server accepts."*

**Duration.** Not checked here. The worker reads the duration before separation and fails the
job with *"This track is 13:02 long. CHORD separates tracks up to 12 minutes."* when it exceeds
[`MAX_DURATION_SECONDS`](../operations/configuration.md#server-environment-variables). So an
over-long upload is accepted with a 202, waits its turn in the queue, and only then fails — no
separation time is spent on it, but the upload and the wait are.

## `POST /jobs/from-url`

Create a job from any URL yt-dlp can handle — YouTube, SoundCloud, Bandcamp, a direct file.

**Request** — `application/json`:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

**Response** — `202 Accepted`, `JobResponse`. Both `original_filename` and `source_url` are
initially the URL; `original_filename` and `author` are overwritten with the real title and
uploader once the worker's download completes — even if the job was cancelled during it, since that
write isn't scoped to the run.

| Code | When |
| --- | --- |
| 400 | blank or whitespace-only URL — *"A URL is required"* |

```bash
curl -X POST http://localhost:8080/api/jobs/from-url \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

No network call happens during the request — the download is the worker's first stage. A
failure there surfaces as `status: "error"` with `error_message` *"Couldn't download audio from
that link. Check that the URL is correct and publicly accessible."* and yt-dlp's own error text
in `error_log`.

The duration limit applies before any audio is fetched: a yt-dlp `match_filter` reads the
source's metadata and skips the download when its `duration` is over `MAX_DURATION_SECONDS`, and
the job fails with the same *"This track is M:SS long…"* message. A source whose metadata carries
no duration is downloaded anyway and caught by the worker's own check afterwards. There is no URL
allowlist and no size cap.

## `GET /jobs`

Every job on the instance, `ORDER BY created_at DESC`.

**Response** — `200`, `JobResponse[]`.

No pagination, no filtering, no auth. The web client never calls this — it exists, and would be
the foundation of a job library if [discard-on-leave](../architecture/decisions.md#discard-on-leave)
were relaxed.

## `GET /jobs/{job_id}`

**Response** — `200`, `JobResponse`. `404` *"Job not found"*.

`useJobEvents` calls it on every connection attempt, before opening the SSE stream, so the screen
has data without waiting up to 500 ms for the first tick. A 404 here is what ends reconnection:
the client shows *Job not found* instead of retrying.

## `GET /jobs/{job_id}/events`

Server-Sent Events stream of the job's state.

**Response** — `200`, `text/event-stream`. `404` *"Job not found"* for an unknown job. Each event is
a full `JobResponse`:

```text
data: {"id":"3f2a…","status":"separating","progress":0.1,…}

data: {"id":"3f2a…","status":"separating","progress":0.113,…}

data: {"id":"3f2a…","status":"analyzing","progress":0.6,…}

data: {"id":"3f2a…","status":"done","progress":1.0,…}
```

Semantics:

- The row is re-read every **0.5 s**; an event is emitted only when the serialized JSON
  **changed**. Since `updated_at` moves on every write, no write is deduplicated away — but
  several writes inside one 0.5 s window arrive as a single event showing the last of them.
- The first event goes out on the first read, so a client that reconnects always receives the
  current state.
- The stream **closes** once the status is terminal. Clients should not expect a sentinel event.
- No named event types, no `id:` field, no retry hint — so the browser's automatic EventSource
  reconnect has nothing to resume from. The client closes the stream on error and reconnects on
  its own terms: `GET /jobs/{job_id}`, then a new `EventSource`, waiting 1 s, doubling to a 10 s
  cap, for up to `MAX_RECONNECT_ATTEMPTS = 10` tries (about 75 s of waiting). Any event resets
  the count. See [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts).
- **An unknown job gets a real 404; a deleted one ends the stream.** The handler looks the job up
  before the response starts, so an id that doesn't exist is refused with a status. A job deleted
  once the stream is open — discarded from another tab, say — can't be: the `200` has already gone
  out, so `_get_job_row`'s exception drops the connection instead, with a traceback in the server
  log, and the client's next reconnect gets the 404 from `GET /jobs/{job_id}`.
- Polling, not push: the worker never notifies this endpoint.

```bash
curl -N http://localhost:8080/api/jobs/<job_id>/events
```

Requires `proxy_buffering off` through any reverse proxy or the events arrive in one lump —
[`nginx.conf`](../../web/nginx.conf) sets that plus `proxy_read_timeout 1h` for long
separations.

## `POST /jobs/{job_id}/cancel`

**Response** — `200`, the updated `JobResponse` with `status: "cancelled"`.

| Code | When |
| --- | --- |
| 404 | no such job — *"Job not found"* |
| 409 | already `done`, `error` or `cancelled` — *"Job has already finished"* |

Writes `status=cancelled, stage_message="Cancelled"` and nothing else — no signal reaches the
worker, which finds out at its next check:

| Where the worker is | What happens |
| --- | --- |
| hasn't reached the job | skips it |
| downloading, detecting tempo, detecting chords and key | the stage runs to completion; its writes are dropped — except a download's title and author, which are kept — and the run stops at the next checkpoint |
| separating | interrupted — the Demucs progress callback checks at most every 2 s and abandons the pass at the next chunk |

Files already written stay on disk, which is what [resume](#post-jobsjob_idresume) builds on. An
interrupted separation also leaves an empty `stems.partial/` behind. Cancellation is cooperative
by design: [../architecture/decisions.md](../architecture/decisions.md#cooperative-cancellation).

## `POST /jobs/{job_id}/resume`

Re-queue a cancelled job.

**Response** — `202 Accepted`, the updated `JobResponse` with `status: "queued"` and
`progress: 0`.

| Code | When |
| --- | --- |
| 404 | no such job — *"Job not found"* |
| 409 | status isn't `cancelled` — *"Only a cancelled job can be resumed"* |

```bash
curl -X POST http://localhost:8080/api/jobs/<job_id>/resume
```

Writes `status=queued, progress=0`, clears `stage_message`, `error_message` and `error_log`,
increments `attempt`, and enqueues the job again.

**`attempt` is what makes this safe.** The cancelled run may still be inside a stage it can't
interrupt. Every write the pipeline makes is `UPDATE … WHERE id = ? AND attempt = ? AND
status != 'cancelled'`, and every checkpoint compares the row's `attempt` with the one the run
started with — so the old run can't overwrite the new one, and stops at its next checkpoint.
`attempt` is an internal column: it isn't part of `JobResponse`.

**The new run reuses what is on disk:**

| Artifact | On resume |
| --- | --- |
| `original.mp3` of a URL job | kept — the download is skipped when the file exists, and the title and author it found are already on the row |
| `thumbnail.jpg` | kept — extraction only runs when it's missing |
| `stems/` | kept when every `STEM_NAMES` WAV is there, and separation is skipped; otherwise separation runs again from the start |
| tempo, chords, key | always recomputed |

Only `cancelled` qualifies. A job in `error` can't be retried this way, and the web client offers
*Try another source* instead. A job orphaned in a non-terminal status by a restart can't be
resumed directly either, but cancelling it first makes it resumable — the recovery path for
[stale rows](../data/retention.md#stale-rows).

Two details keep a resume from losing or repeating work:

- **A URL job cancelled while `fetching` keeps its real title.** The download finishes
  regardless, and the write that sets `original_filename` and `author` from yt-dlp's metadata is
  the one pipeline write not scoped to the attempt, so it lands on the cancelled row. The resumed
  run skips the download but already has them — for the results header, the export filenames and
  the lyrics lookup.
- **A job resumed while its first queue entry still waits runs once.** Resuming a job that was
  cancelled while still `queued` adds a second entry behind the original, and nothing removes
  either. `run_job` starts only on a `queued` row: the first entry to reach the worker runs the job,
  and the second finds it finished and returns without writing.

## `POST /jobs/{job_id}/discard`

Fire-and-forget cleanup, called by the browser when it stops watching a job.

**Response** — `204 No Content`. `404` if no such job.

Branches on status:

| Job state | Effect |
| --- | --- |
| non-terminal | identical to cancel — sets `cancelled`, **leaves files** (the worker may still be writing) |
| terminal | `DELETE FROM jobs` **and** `shutil.rmtree(job_dir, ignore_errors=True)` |

The client calls it with `navigator.sendBeacon`, from a `pagehide` listener and from the cleanup
of an effect in `useJobEvents` keyed on the job id alone. A beacon is guaranteed to survive page
teardown where a `fetch` would be cancelled, and keeping it out of the subscription effect means
reconnecting the stream never fires it.

**This is why there is no history.** *New track* on the results screen — like *Try another
source*, *Discard* and *New track* on the failure panels — clears `activeJobId`, the effect
cleans up, the beacon fires, and a finished job's row and stems are deleted. See
[../data/retention.md](../data/retention.md#discard).
