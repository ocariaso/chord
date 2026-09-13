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
  "original_filename": "song.mp3",  // or the URL, until yt-dlp reports the real title
  "author": "Artist Name",          // null until known; ID3 artist or yt-dlp uploader
  "status": "separating",           // see the status table below
  "progress": 0.1,                  // 0.0 … 1.0, a fixed ladder — not a measurement
  "stage_message": "Separating stems",
  "error_message": null,            // str(exc) when status is "error"
  "stems_model": null,              // ALWAYS null — see below
  "duration_seconds": null,         // written only in the final "done" update
  "key_estimate": "A# minor",       // "<root> <mode>", sharps only
  "key_confidence": 0.87,
  "tempo_bpm": 123.0,               // one decimal place
  "created_at": "2026-09-12T14:03:11.482913+00:00",
  "updated_at": "2026-09-12T14:04:02.117845+00:00",
  "stem_names": [],                 // computed, not stored — see below
  "has_thumbnail": true             // computed, not stored — a filesystem check
}
```

Three fields behave unexpectedly:

- **`stems_model` is always `null`.** The column exists, the schema carries it, the client type
  declares it — but nothing ever writes it. The Demucs model name lives only in
  `settings.demucs_model`.
- **`stem_names` is not a directory listing.** `_row_to_response` returns the constant
  `STEM_NAMES` (all six) when `status == "done"`, and `[]` otherwise. A job that produced fewer
  stems would still advertise six. The zip endpoint, by contrast, globs the real directory.
- **`has_thumbnail` is a `stat` on every serialization**, including each 0.5 s SSE tick.

### Status values

| `status` | Terminal | Meaning |
| --- | --- | --- |
| `queued` | | row inserted, worker hasn't started |
| `fetching` | | yt-dlp downloading (URL jobs only) |
| `separating` | | Demucs running — and tempo detection, later in the same status |
| `analyzing` | | madmom chord/key detection |
| `done` | ✓ | success; all result fields populated |
| `error` | ✓ | `error_message` is set |
| `cancelled` | ✓ | user-initiated |

Full transition detail: [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md).

---

## `POST /jobs`

Create a job from an uploaded file.

**Request** — `multipart/form-data`, field name `file`.

**Response** — `202 Accepted`, `JobResponse` with `status: "queued"`.

| Code | When |
| --- | --- |
| 400 | extension not in `{.mp3, .flac}` — *"Only .mp3 and .flac uploads are supported"* |
| 400 | the uploaded body is empty — *"Uploaded file is empty"* |

```bash
curl -X POST http://localhost:8080/api/jobs -F "file=@song.mp3"
```

Validation is **by file extension only** — no magic bytes, no MIME check, no size limit. The
handler reads the entire upload into memory (`await file.read()`) before writing it to
`data/jobs/<id>/original<ext>`. Note that nginx's default `client_max_body_size` of 1 MB applies
to this route in the Docker deployment; see
[../operations/troubleshooting.md](../operations/troubleshooting.md).

## `POST /jobs/from-url`

Create a job from any URL yt-dlp can handle — YouTube, SoundCloud, Bandcamp, a direct file.

**Request** — `application/json`:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

**Response** — `202 Accepted`, `JobResponse`. Both `original_filename` and `source_url` are
initially the URL; `original_filename` and `author` are overwritten with the real title and
uploader once the worker's `fetching` stage completes.

| Code | When |
| --- | --- |
| 400 | blank or whitespace-only URL — *"A URL is required"* |

```bash
curl -X POST http://localhost:8080/api/jobs/from-url \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

No network call happens during the request — the download is the worker's first stage, and a
failure there surfaces as `status: "error"` with a user-readable `error_message`. There is no
URL allowlist, size cap or duration cap.

## `GET /jobs`

Every job on the instance, `ORDER BY created_at DESC`.

**Response** — `200`, `JobResponse[]`.

No pagination, no filtering, no auth. The web client never calls this — it exists, and would be
the foundation of a job library if [discard-on-leave](../architecture/decisions.md#discard-on-leave)
were relaxed.

## `GET /jobs/{job_id}`

**Response** — `200`, `JobResponse`. `404` *"Job not found"*.

Called once by `useJobEvents` before opening the SSE stream, so the first paint has data rather
than waiting up to 500 ms for the first tick.

## `GET /jobs/{job_id}/events`

Server-Sent Events stream of the job's state.

**Response** — `200`, `text/event-stream`. Each event is a full `JobResponse`:

```
data: {"id":"3f2a…","status":"separating","progress":0.1,…}

data: {"id":"3f2a…","status":"analyzing","progress":0.6,…}

data: {"id":"3f2a…","status":"done","progress":1.0,…}
```

Semantics:

- The row is re-read every **0.5 s**; an event is emitted only when the serialized JSON
  **changed**. Since `updated_at` moves on every write, no stage change is deduplicated away.
- The stream **closes** once the status is terminal. Clients should not expect a sentinel event.
- No named event types, no `id:` field, no retry hint — so the browser's automatic EventSource
  reconnect has nothing to resume from. The client closes on error and
  **does not reconnect**; see [../architecture/web.md](../architecture/web.md#subscription-and-cleanup).
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
| 404 | no such job |
| 409 | already `done`, `error` or `cancelled` — *"Job has already finished"* |

Writes `status=cancelled, stage_message="Cancelled"` and nothing else. **No work is
interrupted** — the worker notices at its next checkpoint, so a Demucs pass in flight runs to
completion. Files already written stay on disk.

## `POST /jobs/{job_id}/discard`

Fire-and-forget cleanup, called by the browser on page leave.

**Response** — `204 No Content`. `404` if no such job.

Branches on status:

| Job state | Effect |
| --- | --- |
| non-terminal | identical to cancel — sets `cancelled`, **leaves files** (the worker may still be writing) |
| terminal | `DELETE FROM jobs` **and** `shutil.rmtree(job_dir, ignore_errors=True)` |

The client calls it with `navigator.sendBeacon` from a `pagehide` listener and from the
`useJobEvents` effect cleanup, because a beacon is guaranteed to survive page teardown where a
`fetch` would be cancelled.

**This is why there is no history.** Clicking "Upload another song" clears `activeJobId`, the
effect cleans up, the beacon fires, and the finished job's row and stems are deleted.
