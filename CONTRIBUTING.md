# Contributing to CHORD

Thanks for helping out. Bug reports, fixes, features and documentation are all welcome.

CHORD is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE), not open
source: it is free for any noncommercial use, and commercial use is not permitted. Please read the
[contribution terms](#contribution-terms) before opening a pull request. Opening one means you
agree to them.

## Proposing a change

1. **Open an issue first** for anything bigger than a small fix: a new feature, a behavior change,
   a new dependency or a redesign. Agreeing on the approach up front saves you from writing a PR
   that can't be merged.
2. **Fork the repo and branch from `development`.** Pull requests go to `development`, not `master`.
3. **Keep each PR to one change.** Unrelated fixes belong in separate PRs.
4. **Describe what changed and why**, and how you checked it (see below). For UI changes, include
   a screenshot.

Bug reports should include the song source (upload or link), what you expected, what happened, and
the output of `docker compose logs server` around the failure.

## Before you open a pull request

The repo has no tests and no CI, so these checks are done by hand:

- **Web builds and lints cleanly:** `cd web && npm run build && npm run lint`. The build runs the
  type check, and lint includes the design-rule check.
- **A real job runs end to end.** Start the app with `./scripts/start.sh` (or `scripts\start.cmd`
  on Windows), process a song, and check that stems, chords, key, tempo and lyrics all appear.
- **The code map is up to date.** If you add, delete, move or rename a source file, or change a
  file's exports, purpose or in-repo dependencies, update the matching entry in
  [`docs/map/`](docs/map/) in the same PR.
- **API changes are made on both sides.** The contract is duplicated by hand in
  `server/app/models/schemas.py` and `web/src/api/client.ts`; see
  [`docs/api/contract-sync.md`](docs/api/contract-sync.md).
- **Behavior changes update the prose docs** in `docs/architecture/`, `docs/features/`,
  `docs/api/`, `docs/data/` or `docs/operations/`, whichever apply.

## Where to start

- [`docs/map/tasks.md`](docs/map/tasks.md) routes "I want to change X" to the files involved, with
  checklists for the changes that are easy to get wrong.
- [`docs/operations/local-development.md`](docs/operations/local-development.md) covers running the
  server and web app outside Docker.
- [`docs/conventions/`](docs/conventions/) describes the Python, TypeScript and design style used
  here. In short: comments explain *why*, not *what*; styling uses the existing `ch-` classes and
  tokens, with no new colors; and every string the screens show lives in `web/src/design/copy.ts`.
- [`docs/todos/`](docs/todos/) lists planned improvements, one page each, if you're looking for
  something to pick up.

## Contribution terms

By submitting a contribution (code, documentation or any other material) to this project, you
agree to the following:

1. **You have the right to submit it.** The contribution is your own original work, or you have
   the right to submit it under these terms. If your employer has rights to what you create, you
   have their permission to contribute it. You will say so in the pull request if any part of it
   comes from someone else, along with its source and license.
2. **You grant a broad license to the project owners.** You grant Ormin Cariaso and Alexander Paul
   Quinit (the "project owners") a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   license to use, copy, modify, distribute, sublicense and relicense your contribution, under the
   PolyForm Noncommercial License 1.0.0 or under any other terms, including commercial licenses.
3. **You grant a patent license.** To the extent your contribution is covered by patents you can
   license, you grant the project owners and everyone who receives the software a perpetual,
   worldwide, royalty-free, irrevocable patent license to make, use, sell and otherwise transfer
   the contribution as part of the software.
4. **You keep your copyright.** These terms are a license, not an assignment. You remain free to
   use your own contribution however you like.
5. **No warranty.** You provide your contribution as is, without warranty of any kind, and you are
   not expected to provide support for it.

Please add a `Signed-off-by: Your Name <you@example.com>` line to your commits (`git commit -s`
does this) to record that you agree.
