# A job reaper

Delete job data that discard-on-leave misses, so CHORD doesn't slowly fill the user's disk.

## Today

The discard beacon is the only thing that deletes anything. These all leak forever
([../data/retention.md](../data/retention.md#what-leaks)):

- A tab that crashes, or a browser that's quit before `pagehide`, never discards its job.
- A job discarded while running is only marked `cancelled`, and its files are kept.
- A directory without a row can't be reached by any endpoint.
- `stems.partial/` from an interrupted separation stays behind.

At about 125 MB of stems per four-minute song, this adds up to gigabytes in `server/data/jobs/`
without the user knowing the directory exists.

## Change

- A sweep that runs on boot and then every hour, in the server process:
  - delete terminal rows, and their directories, older than `JOB_TTL_HOURS` (24 by default; `0`
    disables);
  - delete directories that have no row and are older than an hour, so a job being created isn't
    caught;
  - delete `stems.partial/` in any job that isn't currently separating.
- Never touch non-terminal rows; [restart-recovery.md](restart-recovery.md) handles those.
- Log what was deleted and how many bytes were freed.

## Done when

- A job left behind by a killed tab is gone within `JOB_TTL_HOURS` plus an hour, row and files.
- A job that is processing, or open on a results screen within the TTL, is never deleted.
- `JOB_TTL_HOURS=0` turns it off.

## Works with

Independent.

## Docs to update

[../data/retention.md](../data/retention.md) (*What leaks* and *Cleaning up*),
[../architecture/decisions.md](../architecture/decisions.md#discard-on-leave),
[../operations/configuration.md](../operations/configuration.md), and the map entries for any new
file.
