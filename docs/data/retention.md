# Retention and cleanup

CHORD is designed to keep nothing. There is no library, no history and no TTL — a finished job
is deleted when the user navigates away from it. This page covers what that deletes, what it
misses, and how to clean up the remainder.

## Discard

`POST /jobs/{job_id}/discard` is the only thing that deletes data, and it branches on status:

| Job state | Row | Files |
| --- | --- | --- |
| non-terminal (`queued`/`fetching`/`separating`/`analyzing`) | set to `cancelled` | **kept** — the worker may still be writing |
| terminal (`done`/`error`/`cancelled`) | `DELETE FROM jobs` | `shutil.rmtree(job_dir, ignore_errors=True)` |

The browser calls it automatically from
[`useJobEvents`](../../web/src/hooks/useJobEvents.ts):

```ts
function discardOnLeave() {
  if (statusRef.current) navigator.sendBeacon(discardJobUrl(currentJobId));
}
window.addEventListener("pagehide", discardOnLeave);
return () => { /* … */ discardOnLeave(); };   // and on effect cleanup
```

`sendBeacon` rather than `fetch` because the browser guarantees a beacon survives page
teardown.

**So "Upload another song" destroys the job you were just looking at.** `handleBack` clears
`activeJobId`, the effect unmounts, the beacon fires, and the row and ~250 MB of stems are gone.
This is deliberate — nothing identifies a user, so disk would otherwise grow without bound. The
rationale is recorded in
[../architecture/decisions.md](../architecture/decisions.md#discard-on-leave).

Cancel, by contrast, deletes nothing — it only writes a status.

## What leaks

Four ways data outlives its usefulness. None of them are cleaned up by anything.

### Orphaned directories

A tab that crashes, loses power, or is killed hard enough to skip `pagehide` never fires the
beacon. The row and the full stems directory persist indefinitely.

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

Anything in that list older than the longest plausible separation is stale.

### Cancelled jobs' files

A cancel (or a discard of a *running* job) leaves `original.*` and any stems already written on
disk, with the row marked `cancelled`. Nothing revisits it. A later discard would clean it up,
since the row is now terminal — but the client only discards the job it is currently watching.

### Row/directory divergence

Because the row and the files are separate stores, they can disagree in both directions:

- **Row without a directory** — lists in `GET /jobs`, reports `has_thumbnail: false`, and 404s
  on every artifact.
- **Directory without a row** — invisible to the API entirely, and therefore unreachable by the
  discard endpoint. Only a filesystem sweep will find it.

## Cleaning up

There is no admin endpoint and no reaper. Stop the container first — the worker may hold files
open, and the server writes the database on every status change.

```bash
./scripts/stop.sh
```

**Everything.** The blunt reset, and the usual answer during development:

```bash
rm -rf server/data/jobs/* server/data/db.sqlite3
```

`init_db()` recreates the schema on the next boot, and `config.py` recreates the directories at
import time. Keep `models_cache/` — deleting it forces a multi-hundred-MB Demucs re-download.

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

## What to keep

`server/data/models_cache/` is a pure download cache but an expensive one. Leave it alone unless
you're reclaiming space deliberately, and exclude it from the reset commands above.

## If retention were wanted

The data model already supports a job library — `GET /jobs` lists everything, `created_at` is
recorded, and nothing about a job is session-scoped. Turning it on would mean:

1. Not firing the discard beacon on unmount (keep it on an explicit "delete" action).
2. Surfacing `GET /jobs` in the UI as a list.
3. Adding a real reaper — a TTL sweep over both the rows and the directories, since the two
   stores diverge — because ~250 MB per song fills a disk quickly.

Step 3 is the actual work, and its absence is why the current design deletes eagerly instead.
