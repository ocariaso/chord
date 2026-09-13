# Job lifecycle

Every job is one row in the `jobs` table plus one directory under `data/jobs/<job_id>/`. This
page tracks both through every transition, and names who performs each one.

## States

`JobStatus` is defined in [`schemas.py`](../../server/app/models/schemas.py) and mirrored as a
string union in [`client.ts`](../../web/src/api/client.ts).

| Status | Written by | Meaning |
| --- | --- | --- |
| `queued` | the create endpoint, at INSERT | row exists, worker hasn't started it |
| `fetching` | `run_job` | yt-dlp is downloading (URL jobs only) |
| `separating` | `run_job` | Demucs is running — **and tempo detection, later in the same state** |
| `analyzing` | `run_job` | madmom chord/key detection |
| `done` | `run_job` | terminal, success |
| `error` | `run_job` | terminal, failure; `error_message` is set |
| `cancelled` | `cancel` / `discard` endpoints | terminal, user-initiated |

`TERMINAL_STATUSES = {done, error, cancelled}` appears in two places that must agree:
[`routes_jobs.py`](../../server/app/api/routes_jobs.py) (to reject cancels, to stop the SSE
stream) and [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) (to close the EventSource).

## Transitions

```
                     POST /jobs                      POST /jobs/from-url
                          │                                   │
             write original.<ext>                    (nothing on disk yet)
             INSERT status=queued                    INSERT status=queued, source_url=…
             enqueue(job_id)                         enqueue(job_id)
                          └─────────────┬────────────────────┘
                                        │ 202 + JobResponse
                                        ▼
                              ┌──── worker picks up ────┐
                              │                          │
                    [checkpoint: cancelled? → return]    │
                              │                          │
              source_url set? ├── yes ──► fetching  progress 0.05  "Downloading audio"
                              │           yt-dlp → original.mp3
                              │           UPDATE original_filename=title, author=uploader
                              │
                              └── no  ──► ffprobe ID3 artist → UPDATE author (if found)
                              │
                    [checkpoint: cancelled? → return]
                              │
                        thumbnail.jpg missing? → ffmpeg embedded cover art
                              │
                              ├──────────► separating  progress 0.10  "Separating stems"
                              │           soundfile: duration_seconds (held locally)
                              │           Demucs → stems/{six}.wav
                              │
                    [checkpoint: cancelled? → return]
                              │
                              ├──────────► (still separating)  progress 0.50  "Detecting tempo"
                              │           librosa → tempo_bpm (held locally)
                              │
                    [checkpoint: cancelled? → return]
                              │
        enable_chord_detection├──────────► analyzing  progress 0.60  "Detecting chords and key"
                              │           madmom → chords.json + key.json
                              │           key_estimate, key_confidence (held locally)
                              │
                    [checkpoint: cancelled? → return]
                              │
                              └──────────► done  progress 1.00  "Done"
                                          ONE UPDATE carrying duration_seconds, tempo_bpm,
                                          key_estimate, key_confidence, status, progress
```

Any exception along the way lands in the single handler at the bottom of `run_job`: if the job
was cancelled it stays cancelled, otherwise `status=error` with `error_message=str(exc)`.

### Why the results are batched

`duration_seconds`, `tempo_bpm`, `key_estimate` and `key_confidence` accumulate in a local
`done_fields` dict and are written in the *same* `UPDATE` that sets `status=done`. That makes
the terminal status a complete-data guarantee: a client that sees `done` has already received
every result field in the same payload. It's what lets the SSE stream break immediately on a
terminal status without a final re-read, and what lets `App` switch to the mixer the instant it
sees `done`.

### Progress values

`progress` is a hardcoded ladder, not a measurement: `0 → 0.05 → 0.10 → 0.50 → 0.60 → 1.0`.
Separation — by far the longest stage — spans 0.10 to 0.50 with no intermediate updates, so the
progress bar sits still for minutes there. Demucs' own progress isn't surfaced through the API
CHORD uses.

`stage_message` is the string the UI actually shows; `ProcessingScreen`'s `STAGE_LABELS` map is
only a fallback for when `stage_message` is null.

## Observation: the SSE stream

`GET /jobs/{job_id}/events` is polling dressed as push:

```python
async def event_stream():
    last_payload = None
    while True:
        response = _row_to_response(_get_job_row(job_id))
        payload = response.model_dump_json()
        if payload != last_payload:
            yield f"data: {payload}\n\n"
            last_payload = payload
        if response.status in TERMINAL_STATUSES:
            break
        await asyncio.sleep(0.5)
```

- Re-reads the row every 0.5 s; emits only when the serialized JSON changed.
- Breaks on a terminal status, closing the response — which is what the browser sees as the
  stream ending normally.
- The `updated_at` column changes on every write, so any stage change produces a distinct
  payload and cannot be deduplicated away.
- If the job is deleted while a stream is open, `_get_job_row` raises `HTTPException(404)` from
  inside an already-started response body. The client just sees the connection drop.

On the browser side, [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) fetches
`GET /jobs/{id}` once immediately (so the first paint has data rather than waiting up to 500 ms),
then opens the `EventSource`. `onerror` closes the stream and **does not reconnect** — a
transient network blip freezes the progress UI at its last known state, with the job still
running server-side. Reloading the page loses the job id entirely, since it lives only in React
state.

## Cancelling

`POST /jobs/{job_id}/cancel` returns 409 if the job is already terminal; otherwise it sets
`status=cancelled, stage_message="Cancelled"` and returns the row.

Cancellation is **cooperative and coarse**. It writes a row and nothing else:

- No signal reaches the worker. A Demucs pass, a yt-dlp download or a madmom analysis in flight
  runs to completion — potentially minutes of work after the user clicked Cancel.
- The worker notices only at the next `_is_cancelled()` checkpoint, between stages.
- Files already written (the original, any stems) stay on disk. Cancel does not clean up;
  only `discard` does.

`_is_cancelled` also returns `True` when the row is *missing*, so a deleted job stops the
pipeline too.

## Discarding

`POST /jobs/{job_id}/discard` is the endpoint the browser fires on page leave, and it branches:

- **Job still running** → behaves exactly like cancel (sets `cancelled`, returns 204). Files
  are left in place, since the worker may still be writing into that directory.
- **Job already terminal** → `DELETE FROM jobs` and `shutil.rmtree(job_dir, ignore_errors=True)`.
  Row and directory both gone.

The client side, in `useJobEvents`:

```ts
function discardOnLeave() {
  if (statusRef.current) navigator.sendBeacon(discardJobUrl(currentJobId));
}
window.addEventListener("pagehide", discardOnLeave);
return () => { /* … */ discardOnLeave(); };   // also on effect cleanup
```

`sendBeacon` rather than `fetch` because the browser guarantees a beacon survives page
teardown. The guard on `statusRef.current` skips the beacon if no status was ever observed.

Two consequences worth internalizing:

- **Clicking "Upload another song" deletes the finished job.** `handleBack` clears
  `activeJobId`, the effect cleans up, the beacon fires, the server removes the row and the
  stems. There is no history and no going back — by design, since nothing identifies a user and
  disk would otherwise grow without bound.
- **In React `StrictMode` the mount effect runs twice in development**, so the cleanup fires
  once immediately. Because the beacon is guarded on an observed status, and the job is
  typically still `queued`, the practical effect in dev is a spurious cancel. Worth knowing when
  a job mysteriously cancels itself locally but not in a production build.

## What is never cleaned up

- A job whose browser tab crashed hard enough to skip `pagehide`: row and files persist forever.
- Rows in `queued`/`separating`/`analyzing` after a server restart: the in-memory queue is gone,
  so nothing will ever advance them. They are permanently stale, and the UI would show a frozen
  progress bar if reattached.
- Anything in `data/jobs/` whose row was deleted by other means.

There is no reaper, no TTL and no admin sweep. Clearing `server/data/jobs/` by hand (with the
container stopped) is the current remedy.
