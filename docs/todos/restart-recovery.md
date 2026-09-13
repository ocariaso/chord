# Recover jobs after a restart

Resume jobs that were queued or running when the server stopped, instead of leaving them stuck.

## Today

- The queue is a `queue.Queue` in the server process, consumed by one thread
  ([`worker.py`](../../server/app/pipeline/worker.py)).
- `./scripts/stop.sh`, a Docker Desktop restart, a reboot or a crash drops every queued and running
  job. Their rows stay `queued`, `fetching`, `separating` or `analyzing`, and nothing will ever
  advance them ([../data/retention.md](../data/retention.md#stale-rows)).
- The only way to revive one is to cancel and then resume it by hand with `curl`.

## Why

Stopping CHORD in the middle of a long separation is normal for a tool that runs on your own
machine. Coming back to a job stuck at *Separating stems* forever, with no explanation, looks like a
bug.

## Change

- In `lifespan` in [`main.py`](../../server/app/main.py), before `start_worker()`, select
  non-terminal rows in `created_at` order.
- For each one, do what resume does: set `status` back to `queued`, bump `attempt`, clear
  `stage_message`, `error_message` and `error_log`, and enqueue it. Resume already reuses a
  downloaded original and a complete set of stems, so little work is repeated.
- Log how many jobs were recovered.
- Keep the `queued`-status check at the start of `run_job` and the attempt-scoped writes; they make a
  recovered job safe to run.
- Optionally, skip jobs older than a limit and mark them `error` with a message saying they were
  interrupted, so a job from last week doesn't start on boot.

## Done when

- Stopping the containers mid-separation and starting them again: the job continues and reaches
  `done` without any manual step, and a processing screen that reconnects shows it progressing.
- A job interrupted after its stems were written doesn't separate again.
- Starting with no interrupted jobs changes nothing.

## Works with

Independent. The [reaper](../data/retention.md#the-reaper) already leaves non-terminal rows alone,
so a recovered job is never deleted before it runs. An interrupted job marked `error` instead
starts its `JOB_TTL_HOURS` from that write.

## Docs to update

[../data/retention.md](../data/retention.md#stale-rows),
[../architecture/job-lifecycle.md](../architecture/job-lifecycle.md),
[../architecture/decisions.md](../architecture/decisions.md#a-single-serial-worker-thread-not-a-task-queue),
the known-issues row in [../map/tasks.md](../map/tasks.md#known-issues-worth-picking-up),
`CLAUDE.md` (*A restart orphans in-flight jobs*), and the map entry for `main.py`.
