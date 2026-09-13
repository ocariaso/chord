# Job lifecycle

Every job is one row in the `jobs` table plus one directory under `data/jobs/<job_id>/`. This
page tracks both through every transition, and names who performs each one.

## States

`JobStatus` is defined in [`schemas.py`](../../server/app/models/schemas.py) and mirrored as a
string union in [`client.ts`](../../web/src/api/client.ts).

| Status | Written by | Meaning |
| --- | --- | --- |
| `queued` | the create endpoints, at INSERT; the `resume` endpoint | row exists, worker hasn't started this attempt |
| `fetching` | `run_job` | yt-dlp is downloading (URL jobs only, and not on a resume that already has the audio) |
| `separating` | `run_job` | Demucs is running — **and tempo detection, later in the same state** |
| `analyzing` | `run_job` | madmom chord/key detection |
| `done` | `run_job` | terminal, success |
| `error` | `run_job` | terminal, failure; `error_message` is set, and usually `error_log` |
| `cancelled` | `cancel` / `discard` endpoints | terminal, user-initiated; the only status `resume` accepts |

`TERMINAL_STATUSES = {done, error, cancelled}` appears in two places that must agree:
[`routes_jobs.py`](../../server/app/api/routes_jobs.py) (to reject cancels, to choose between
cancelling and deleting on discard, to stop the SSE stream) and
[`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) (to close the EventSource and to stop
reconnecting).

Beside `status`, the row carries `attempt`: 0 at INSERT, incremented by every resume, and never
sent to the client. A run of the pipeline belongs to the attempt it read when it started, and
everything it writes is scoped to that attempt — see [Resuming](#resuming).

## Transitions

```text
                     POST /jobs                         POST /jobs/from-url
                          │                                      │
          copy the upload to original.<ext>             (nothing on disk yet)
          INSERT status=queued, attempt=0               INSERT status=queued, source_url=…
          enqueue(job_id)                               enqueue(job_id)
                          └──────────────┬───────────────────────┘
                                         │ 202 + JobResponse
                                         ▼
                                  worker picks up
                         row missing, or not queued? → return
                         attempt = row.attempt
                                         │
               source_url set? ─── yes ──┼─► original.mp3 already there (a resume)? → skip this
                                         │   fetching  progress 0.05  "Downloading audio"
                                         │   yt-dlp → original.mp3 (refused first if metadata says too long)
                                         │   UPDATE original_filename=title, author=uploader  (unscoped)
                                         │
                                    no ──┼─► ffprobe ID3 artist → UPDATE author (if found)
                                         │
                       [checkpoint: superseded? → return]
                                         │
                           thumbnail.jpg missing? → ffmpeg embedded cover art
                           soundfile → duration, format label
                           longer than max_duration_seconds? → TrackTooLongError
                                         │
                                         ├─► separating  progress 0.10  "Separating stems"
                                         │   same UPDATE: duration_seconds, audio_format
                                         │   stems/ complete? → skip separation
                                         │   else Demucs → stems.partial/ → renamed to stems/
                                         │     progress 0.10 → 0.50 as chunks start, ≤ 1 write per 1%
                                         │     at a chunk start, every ≥ 2 s: superseded? → abandon
                                         │
                       [checkpoint: superseded? → return]
                                         │
                                         ├─► (still separating)  progress 0.50  "Detecting tempo"
                                         │   librosa → tempo_bpm (held locally; 0 BPM is stored as null)
                                         │
                       [checkpoint: superseded? → return]
                                         │
                enable_chord_detection ──├─► analyzing  progress 0.60  "Detecting chords and key"
                                         │   madmom → chords.json + key.json
                                         │   key_estimate, key_confidence (held locally)
                                         │
                       [checkpoint: superseded? → return]
                                         │
                                         └─► done  progress 1.00  "Done"
                                             ONE UPDATE carrying tempo_bpm, key_estimate,
                                             key_confidence, status, progress, stage_message
```

Every `UPDATE` in the diagram but one is `_update_job(job_id, attempt, …)`, which appends
`WHERE id = ? AND attempt = ? AND status != 'cancelled'`. A write from a run that was cancelled,
deleted or resumed past matches no row and does nothing. The exception is the title and author a
download finds: `_record_track_identity` writes them by id alone, so they land even when the run
has been cancelled — see [Resuming](#resuming). A checkpoint is `_is_superseded(job_id, attempt)`:
true when the row is gone, is `cancelled`, or carries a different attempt. The first check, before
anything else, is stricter: `run_job` returns unless the row is `queued`.

### Failures

Any exception other than the internal `_Superseded` lands in the single `except Exception`
handler at the bottom of `run_job`. If the run is superseded it returns quietly — a cancelled job
that blew up mid-stage stays `cancelled`. Otherwise it logs with `logger.exception` and writes
`status=error` with two fields, chosen by `_describe_failure` from the exception and the stage the
run had reached (`downloading`, `reading`, `separating`, `tempo`, `analyzing`):

| Exception | `error_message` | `error_log` |
| --- | --- | --- |
| a `UserFacingError` — `SourceDownloadError`, `TrackTooLongError` | its own text, verbatim | the text of the exception it was raised `from`, or null |
| anything else | the stage's sentence, e.g. *"Stem separation stopped with an error."* | `"TypeName: message"` |

`progress` is left as it was, and so is `stage_message` — except after a failure while `reading`,
when the same write sets it to null. The failure panel titles itself from that leftover message
through `FAILURE_TITLES` in [`App.tsx`](../../web/src/App.tsx):

| `stage_message` on the failed row | Panel title |
| --- | --- |
| *Downloading audio* | *Download failed* |
| *Separating stems* | *Separation failed* |
| *Detecting tempo* | *Tempo detection failed* |
| *Detecting chords and key* | *Chord detection failed* |
| none | *Couldn't start separation* |
| anything else | *Separation failed* |

Reading the audio falls between the download and separation, so clearing the message there keeps a
downloaded file that can't be read, or turns out too long, from borrowing *Download failed*. The
*none* row covers every job that fails before a stage begins: an upload that is unreadable or too
long, a link whose metadata had no duration and whose download is then refused, and a resumed job —
whose message the resume cleared — failing while it reads. A link refused by yt-dlp's duration
filter fails while `downloading`, keeps *Downloading audio*, and is titled *Download failed*.
`_Superseded`, raised from the separation callback, is caught on its own and ends the run without
writing anything.

### Why the results are batched

`tempo_bpm`, `key_estimate` and `key_confidence` accumulate in a local `done_fields` dict and are
written in the *same* `UPDATE` that sets `status=done`. `duration_seconds` and `audio_format` go
out earlier, in the update that sets `status=separating`, so the processing screen can show them
while separation runs (`original_filename` and `author` are earlier still). Either way the
terminal status is a complete-data guarantee: a client that sees `done` has already received every
result field, in that payload or a previous one. It's what lets the SSE stream break immediately
on a terminal status without a final re-read, and what lets `App` switch to the results the
instant it sees `done`.

### Progress values

`progress` is a fixed ladder with one measured span: `0 → 0.05 → 0.10 … 0.50 → 0.60 → 1.0`.
Uploads skip 0.05, and so does a resumed URL job that already has its audio.

Separation — by far the longest stage — fills 0.10 to 0.50 from Demucs' own chunk progress.
`separation.separate()` installs a callback on the Demucs `Separator` for each job, and Demucs
calls it as each chunk starts, with the chunk's offset, the audio's length and the model's index
in its bag. [`separation.py`](../../server/app/pipeline/separation.py) turns that into a 0–1
fraction, `(model_idx_in_bag + segment_offset / audio_length) / models` — chunks run in order, so
the starting chunk's offset is the share already done — and `_separation_progress` in
[`pipeline.py`](../../server/app/pipeline/pipeline.py) maps it onto the span, writing the row only
when progress has moved at least 1%. The last chunk runs with the bar short of 0.50; the tempo
update sets it.

`stage_message` is the string the UI actually shows. `ProcessingScreen` maps `status` and
`stage_message` onto its fixed five-stage list with `processingStage()` in
[`design/stages.ts`](../../web/src/design/stages.ts) — `separating` with *Detecting tempo* is the
tempo stage — and estimates *"about N seconds left"* from how far progress has moved between the
first separating update it saw and the latest one, timed by their `updated_at`. It hardcodes the
end of the span as `SEPARATION_PROGRESS_END = 0.5`, a hand copy of `_SEPARATION_PROGRESS`.

## Observation: the SSE stream

`GET /jobs/{job_id}/events` is polling dressed as push:

```python
_get_job_row(job_id)   # before the stream opens: an unknown job is a plain 404

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

- Looks the job up once before the response starts, so an unknown id gets a real `404` rather
  than a `200` and a dropped connection.
- Re-reads the row every 0.5 s; emits only when the serialized JSON changed.
- Breaks on a terminal status, closing the response — which is what the browser sees as the
  stream ending normally.
- The `updated_at` column changes on every write, so any stage change — or a 1% step of
  separation progress — produces a distinct payload and cannot be deduplicated away.
- If the job is deleted while a stream is open, `_get_job_row` raises `HTTPException(404)` from
  inside an already-started response body. The client sees the connection drop.

On the browser side, [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) fetches
`GET /jobs/{id}` once immediately (so the first paint has data rather than waiting up to 500 ms),
then opens the `EventSource`. When the stream errors before a terminal status, the hook closes it
and starts over — `getJob`, then a new stream — after 1, 2, 4 and 8 seconds, then every 10
seconds, for up to 10 attempts, while `App` shows *Connection lost* with the retry count. Each
message resets the count. A 404 from `getJob` — including the one that follows a deleted job's
dropped stream — stops at once with *Job not found*. Because every attempt re-reads the row first,
nothing that happened while disconnected is missed. Reloading the page still loses the job id
entirely, since it lives only in React state. See
[web.md](web.md#subscription-and-cleanup).

## Cancelling

`POST /jobs/{job_id}/cancel` returns 409 if the job is already terminal; otherwise it sets
`status=cancelled, stage_message="Cancelled"` and returns the row.

Cancellation is **cooperative**. It writes a row and nothing else:

- No signal reaches the worker. It notices at the next `_is_superseded()` checkpoint, between
  stages.
- **Separation is the exception.** The progress callback Demucs invokes at each chunk start also
  re-reads the row, at most every 2 s (`_SUPERSEDED_POLL_SECONDS`), and raises `_Superseded`,
  which unwinds out of Demucs and ends the run. The pass stops at the first chunk start that comes
  at least 2 s after the previous check, rather than running to the end.
- A yt-dlp download, a librosa tempo pass or a madmom analysis in flight still runs to completion
  — potentially minutes of work after the user clicked Cancel.
- Writes the cancelled run still attempts are dropped by `_update_job`'s `status != 'cancelled'`
  guard, so the row stays `cancelled`. The one write that isn't guarded — the title and author a
  finished download found — changes only those two columns.
- Files already written stay on disk: the original, `thumbnail.jpg`, a finished `stems/`. An
  abandoned separation leaves only an empty `stems.partial/`, which the next separation clears.
  Cancel does not clean up; only `discard` does.

`_is_superseded` also returns `True` when the row is *missing*, so a deleted job stops the
pipeline too.

## Resuming

`POST /jobs/{job_id}/resume` returns 404 for an unknown job and 409 (*"Only a cancelled job can be
resumed"*) unless its status is `cancelled`. Otherwise it sets `status=queued, progress=0`, clears
`stage_message`, `error_message` and `error_log`, increments `attempt`, enqueues the job and
returns 202 with the row. The client passes that row to `reconnect()`, so the processing screen
shows *Queued* at once and its stage timings start over.

The new attempt reuses what the cancelled one finished:

| Artifact | Reused when | Otherwise |
| --- | --- | --- |
| `original.mp3` (URL jobs) | the file exists | downloaded again |
| `stems/` | all six `STEM_NAMES` WAVs are there | separated again — `stems/` is complete or absent, never partial |
| tempo, chords, key | never | detected again |

Incrementing `attempt` is what makes this safe. The cancelled run may still be inside a stage when
resume flips the row back to `queued`; a status check alone would read that as a live job and let
the old run carry on. With the counter, every write the old run makes matches no row and its next
checkpoint returns. The two runs can't overlap anyway — the worker is serial — so the resumed run
starts once the old one has returned.

Two more details keep a resume from losing or repeating work:

- **A URL job cancelled during its download keeps its title.** The resumed run finds
  `original.mp3` and skips the whole download block, so it can't learn the title and author again.
  `_record_track_identity` therefore writes them straight after the download without the attempt
  guard — they describe the job however the run ended — and the results header, the export
  filenames and the lyrics lookup get the real title, not the URL.
- **A job queued twice runs once.** Resume always enqueues, and nothing takes a job out of the
  in-memory queue, so a job that was cancelled while it waited behind another and then resumed has
  two entries. `run_job` starts only on a `queued` row: whichever entry reaches the worker first
  runs the new attempt, and the other finds the row `done` — or `error`, or `cancelled` again — and
  returns without writing anything.

## Discarding

`POST /jobs/{job_id}/discard` is the endpoint the browser fires on page leave, and it branches:

- **Job still running** (`queued`, `fetching`, `separating`, `analyzing`) → behaves exactly like
  cancel (sets `cancelled`, returns 204). Files are left in place, since the worker may still be
  writing into that directory.
- **Job already terminal** (`done`, `error`, `cancelled`) → `DELETE FROM jobs` and
  `shutil.rmtree(job_dir, ignore_errors=True)`. Row and directory both gone.

A `cancelled` job counts as terminal even while its run is still finishing a stage, so *Discard*
straight after *Cancel* deletes the directory under that run. Its remaining writes fail or match
no row, and it returns at the next checkpoint — but a stage that creates directories with
`parents=True` (`stems.partial/` at the start of separation, `analysis/` before chord detection)
can recreate part of the tree for a row that no longer exists.

The client side, in `useJobEvents`:

```ts
// Its own effect, keyed on the job alone, so reconnecting can never fire it.
useEffect(() => {
  if (!jobId) return;
  const currentJobId = jobId;
  function discardOnLeave() {
    if (statusRef.current) navigator.sendBeacon(discardJobUrl(currentJobId));
  }
  window.addEventListener("pagehide", discardOnLeave);
  return () => {
    window.removeEventListener("pagehide", discardOnLeave);
    discardOnLeave();   // also when the job id changes
  };
}, [jobId]);
```

`sendBeacon` rather than `fetch` because the browser guarantees a beacon survives page
teardown. The guard on `statusRef.current` skips the beacon if no status was ever observed.

Two consequences worth internalizing:

- **Leaving a job deletes it.** *New track*, *Try another source*, *Discard* and
  *Cancel* on the stem-loading screen all call `handleBack`, which clears `activeJobId`; the
  effect cleans up, the beacon fires, and the server removes the row and the stems — or cancels
  the job, if it is still running. There is no history and no going back — by design, since
  nothing identifies a user and disk would otherwise grow without bound. The *Cancelled* panel's
  promise that files are kept "while this page stays open" is the same rule.
- **In development, Fast Refresh can fire the beacon; `StrictMode` can't.** `StrictMode`'s extra
  setup-and-cleanup cycle runs only when a component mounts, and `App` mounts before there is any
  job. Saving an edit to `App.tsx` or `useJobEvents.ts` while a job is open is different: Fast
  Refresh re-runs the refreshed component's effects, the cleanup sends the beacon, and the job is
  cancelled — or deleted, if it had finished. Worth knowing when a job mysteriously cancels itself
  locally but not in a production build.

## What is never cleaned up

- A job whose browser tab crashed hard enough to skip `pagehide`, or whose beacon never reached
  the server — leaving from the *Connection lost* panel, for instance: row and files persist
  forever.
- Rows in `queued`/`fetching`/`separating`/`analyzing` after a server restart: the in-memory queue
  is gone, so nothing will ever advance them. A page that still has the job open can cancel and
  then resume it; otherwise the row is permanently stale.
- Parts of a job directory recreated by a run whose job was discarded mid-stage.
- An upload that failed partway through being copied to disk: the directory is removed only when
  the upload is empty, and no row was inserted to find it by.
- Anything in `data/jobs/` whose row was deleted by other means.

There is no reaper, no TTL and no admin sweep. Clearing `server/data/jobs/` by hand (with the
container stopped) is the current remedy.
