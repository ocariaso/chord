# Retention and cleanup

CHORD is designed to keep nothing. There is no library and no history. A finished job is deleted
when the user navigates away from it, and the reaper deletes whatever that misses, a day later by
default. This page covers what each of them deletes, what is left, and how to clean up by hand.

## Discard

`POST /jobs/{job_id}/discard` is the only thing that deletes data, and it branches on status:

| Job state | Row | Files |
| --- | --- | --- |
| non-terminal (`queued`/`fetching`/`separating`/`analyzing`) | set to `cancelled` | **kept** — the worker may still be writing |
| terminal (`done`/`error`/`cancelled`) | `DELETE FROM jobs` | `shutil.rmtree(job_dir, ignore_errors=True)` |

The browser calls it automatically from
[`useJobEvents`](../../web/src/hooks/useJobEvents.ts), in an effect of its own keyed on the job
id alone, so reconnecting the event stream never fires it:

```ts
useEffect(() => {
  if (!jobId) return;
  const currentJobId = jobId;

  // Cleans this job up on the server when the page is left, instead of leaving it orphaned.
  function discardOnLeave() {
    if (statusRef.current) {
      navigator.sendBeacon(discardJobUrl(currentJobId));
    }
  }

  window.addEventListener("pagehide", discardOnLeave);
  return () => {
    window.removeEventListener("pagehide", discardOnLeave);
    discardOnLeave();
  };
}, [jobId]);
```

`sendBeacon` rather than `fetch` because the browser guarantees a beacon survives page
teardown.

**So "New track" destroys the job you were looking at.** Every way back to the landing
screen — *New track* on the results or a lost connection, *Try another source* after an error,
*Discard* on a cancelled job, *Cancel* while stems load — goes through `handleBack` in
[`App.tsx`](../../web/src/App.tsx), which clears `activeJobId`. The effect cleans up, the beacon
fires, and a finished job's row and ~250 MB of stems are gone. This is deliberate — nothing
identifies a user, so disk would otherwise grow without bound. The rationale is recorded in
[../architecture/decisions.md](../architecture/decisions.md#discard-on-leave).

Cancel, by contrast, deletes nothing — it only writes a status, and the files it leaves are what
[resume](../api/jobs.md#post-jobsjob_idresume) builds on. The *Cancelled* panel keeps them only as
long as the page stays on that job; leaving it discards the job like any other terminal one.

## The reaper

[`reaper.py`](../../server/app/pipeline/reaper.py) runs on its own thread, `chord-job-reaper`, which
the server starts: one sweep at startup, then one every hour. Each sweep deletes:

| What | When |
| --- | --- |
| a `done`, `error` or `cancelled` job: first the row, then the directory | it hasn't changed, and no open page has sent a heartbeat, for `JOB_TTL_HOURS` (24 by default) |
| a directory under `data/jobs/` with no row | neither it nor anything directly inside it has changed for an hour |
| `stems.partial/` in a `done`, `error` or `cancelled` job | the job hasn't changed for an hour |

It never touches a `queued`, `fetching`, `separating` or `analyzing` row, or that job's files. A
sweep that deleted anything logs one line:

```text
Job reaper: deleted 3 expired jobs, 1 orphaned directories and 0 partial separations, freeing 412.3 MB
```

`JOB_TTL_HOURS=0` turns the reaper off entirely, and the server logs that at startup. See
[../operations/configuration.md](../operations/configuration.md).

Details that decide what survives:

- **An open page keeps its job.** Once the stems have loaded, playback never calls the server, so
  `useJobEvents` sends
  [`POST /jobs/{id}/heartbeat`](../api/jobs.md#post-jobsjob_idheartbeat) when a job opens and every
  5 minutes after that. Each heartbeat writes `last_seen_at`. A job's age counts from whichever is
  later: `last_seen_at`, or `updated_at` (for a terminal job, the time it finished, failed or was
  cancelled). The heartbeats stop when the browser freezes or discards the tab, or when the page
  can't reach the server. After `JOB_TTL_HOURS` without one, the job is deleted: the page still
  plays from its decoded stems, but exports get 404s and a reload shows *Job not found*.
- **A resume or a heartbeat beats the reaper.** The `DELETE` repeats the status and age conditions,
  so a job resumed or seen after the sweep selected it no longer matches when the `DELETE` runs, and
  survives.
  The directory is removed only after the row, so a resume that arrives later gets a 404, never a
  job without its audio.
- **An hour's grace for directories.** `POST /jobs` creates the directory and copies the upload in
  before it inserts the row, so a directory with no row is left alone while it or its files have
  changed within the hour. A terminal job's `stems.partial/` waits the same hour, since a cancelled
  run can still be finishing its stage. The grace is fixed; it doesn't follow `JOB_TTL_HOURS`.

## What leaks

Four ways data outlives the discard. The reaper cleans up three of them. It leaves stale rows alone.

### Orphaned directories

A tab that crashes, loses power, or is killed hard enough to skip `pagehide` never fires the
beacon. The row and the full stems directory persist until the reaper deletes the job,
`JOB_TTL_HOURS` after it last changed.

### Stale rows

The worker queue is in-memory. A server restart drops every queued and in-flight job, leaving
rows in `queued`, `separating` or `analyzing` that **nothing will ever advance**. They are
permanently stale — `GET /jobs` still lists them, and a client that reattached would watch a
progress bar that never moves.

```bash
sqlite3 server/data/db.sqlite3 \
  "SELECT id, status, stage_message, created_at FROM jobs
   WHERE status NOT IN ('done','error','cancelled') ORDER BY created_at;"
```

Anything in that list older than the longest plausible separation is stale. The reaper doesn't
delete these rows or their files: from the row alone, it can't tell a stale job from one that is
running.

A stale row can be revived instead of deleted. Cancel it, then resume it, and the running
server's worker picks it up — reusing the audio, and the stems if separation had finished:

```bash
curl -X POST http://localhost:8080/api/jobs/<job_id>/cancel
curl -X POST http://localhost:8080/api/jobs/<job_id>/resume
```

No tab is watching it any more, so nothing discards it when it finishes.

### Cancelled jobs' files

A discard of a *running* job — the tab left mid-processing — marks it `cancelled` and keeps
`original.*`, the thumbnail, a completed `stems/` if there is one, and any `stems.partial/` an
interrupted separation left. The tab that could have resumed or discarded it is gone, so nothing
revisits it. A second discard would clean it up, since the row is now terminal — but no client
will send one. The reaper deletes it `JOB_TTL_HOURS` after the cancel.

### Row/directory divergence

Because the row and the files are separate stores, they can disagree in both directions:

- **Row without a directory** — lists in `GET /jobs`, reports `has_thumbnail: false`, and 404s
  on every artifact. If the row is terminal, the reaper deletes it after the TTL.
- **Directory without a row** — invisible to the API entirely, and therefore unreachable by the
  discard endpoint. The reaper's directory pass deletes it once it has been unchanged for an hour.

## Cleaning up

There is no admin endpoint. The reaper handles most of this on its own schedule. Clean up by hand
to reclaim space now, to clear stale rows, or when `JOB_TTL_HOURS=0`. Stop the container first — the
worker may hold files open, and the server writes the database on every status change.

```bash
./scripts/stop.sh
```

**Everything.** The blunt reset, and the usual answer during development:

```bash
rm -rf server/data/jobs/* server/data/db.sqlite3
```

`init_db()` recreates the schema on the next boot, and `config.py` recreates the directories at
import time. The Demucs weights are in the image, so this forces no download.

**Stale rows only**, keeping finished jobs:

```bash
sqlite3 server/data/db.sqlite3 \
  "DELETE FROM jobs WHERE status NOT IN ('done','error','cancelled');"
```

That leaves their directories behind; pair it with the orphan sweep below.

**Orphaned directories** — job folders with no matching row:

```bash
cd server/data
sqlite3 db.sqlite3 "SELECT id FROM jobs;" | sort > /tmp/rows.txt
ls jobs | sort > /tmp/dirs.txt
comm -13 /tmp/rows.txt /tmp/dirs.txt          # in dirs, not in rows — review before deleting
comm -13 /tmp/rows.txt /tmp/dirs.txt | xargs -I{} rm -rf "jobs/{}"
```

**By age** — anything untouched for a week:

```bash
find server/data/jobs -maxdepth 1 -mindepth 1 -type d -mtime +7 -exec rm -rf {} +
```

Rows for those directories survive; run the stale-row delete or accept the divergence.

**Scratch from interrupted separations**, if you're keeping the jobs themselves:

```bash
find server/data/jobs -mindepth 2 -maxdepth 2 -type d -name stems.partial -exec rm -rf {} +
```

## What to keep

`server/data/models_cache/` is normally empty: the Demucs weights are baked into the server image.
It fills only when `DEMUCS_MODEL` names a model the image wasn't built with, and deleting it then
makes the next job download that model again — see
[../operations/configuration.md](../operations/configuration.md#demucs-weights).

## If retention were wanted

The data model already supports a job library — `GET /jobs` lists everything, `created_at` is
recorded, and nothing about a job is session-scoped. Turning it on would mean:

1. Not firing the discard beacon on unmount (keep it on an explicit "delete" action).
2. Surfacing `GET /jobs` in the UI as a list.
3. Stopping the reaper from deleting the library a day after each job. It deletes by age alone.
   Setting `JOB_TTL_HOURS=0` keeps everything, and ~125 MB per song fills a disk quickly. A real
   library would need the reaper to know which jobs the user wants kept.

Step 3 is the actual work, and its absence is why the current design deletes eagerly instead.
