# Tests and CI

Add automated tests for both halves, and run them on every pull request.

## Today

- No tests in either half, and no CI
  ([../architecture/README.md](../architecture/README.md#where-things-are-not)).
- Verification is `cd web && npm run build` (which runs `tsc -b`), `npm run lint`, and running a real
  job by hand.

## Why

Once CHORD is open source, pull requests will come from people who don't know the codebase. Cancel,
resume and the attempt counter have subtle behavior
([../architecture/job-lifecycle.md](../architecture/job-lifecycle.md)) that a manual test run rarely
covers, and a maintainer can't run a real GPU job for every pull request.

## Change

- **Server, `pytest`:**
  - The job state machine in [`pipeline.py`](../../server/app/pipeline/pipeline.py), with Demucs,
    madmom, librosa and yt-dlp replaced by fast stubs: every status transition, a failure in each
    stage, cancel mid-download and mid-separation, resume with and without complete stems, and a
    superseded run failing to overwrite the row.
  - Every endpoint in [../api/](../api/) through FastAPI's `TestClient`, including
    `TERMINAL_STATUSES` handling on cancel, discard and the event stream.
  - Pure functions: chord label normalization and relative-key disambiguation in
    [`chords.py`](../../server/app/pipeline/chords.py), lyrics offset correction and LRC parsing, and
    the WAV header in `routes_stems.py`.
  - One slow smoke test that runs a few seconds of real audio through the real models, run on demand
    rather than on every pull request.
- **Web, Vitest:** transposition, the fader law, LRC parsing, stage-message matching in
  [`design/stages.ts`](../../web/src/design/stages.ts), and `useJobEvents` reconnect and terminal
  logic with a fake `EventSource`.
- **CI (GitHub Actions)** on every push and pull request: `npm ci && npm run build && npm run lint`,
  the server tests, and a CPU build of both Docker images. Required for merging.

## Done when

- `pytest` and `npm test` run locally with no GPU and no network, in a couple of minutes.
- CI runs on every pull request, including from forks, and is required for merging.
- Breaking the attempt-scoped `UPDATE`, or renaming a stage message on one side only, fails a test.

## Works with

Independent. [prebuilt-releases.md](prebuilt-releases.md) and
[generated-api-types.md](generated-api-types.md) both add jobs to the same CI.

## Docs to update

`CLAUDE.md` (*No tests and no CI*),
[../architecture/README.md](../architecture/README.md#where-things-are-not),
[../operations/local-development.md](../operations/local-development.md), the known-issues row in
[../map/tasks.md](../map/tasks.md#known-issues-worth-picking-up), and map entries for the new test
files and workflow.
