# CHORD

Upload or link a song; get isolated stems, a chord timeline, key, tempo, and synced lyrics in a
browser mixer. Two deployables: **`server/`** (FastAPI, Python 3.10) and **`web/`** (React +
TypeScript + Vite, served by nginx).

## Start here

[`docs/map/tasks.md`](docs/map/tasks.md) routes "I want to change X" to the files involved.
Read it before starting a change — it's faster than grepping, and it carries checklists for the
three changes that are easy to get wrong (adding a job field, adding a status, changing the
Demucs model).

| Need | Read |
| --- | --- |
| Which file owns a behavior | [`docs/map/`](docs/map/) — file-by-file index |
| How the system fits together | [`docs/architecture/`](docs/architecture/) |
| One capability end to end | [`docs/features/`](docs/features/) |
| An endpoint's contract | [`docs/api/`](docs/api/) |
| Schema and on-disk layout | [`docs/data/`](docs/data/) |
| Running, building, debugging | [`docs/operations/`](docs/operations/) |
| Code style actually used here | [`docs/conventions/`](docs/conventions/) |
| Why something is the way it is | [`docs/architecture/decisions.md`](docs/architecture/decisions.md) |

## Standing rule: keep the map current

`docs/map/` is a mechanical index and is expected to match the code **exactly** — a stale entry
actively misleads.

**Any change that adds, deletes, moves or renames a source file, or that changes a file's
exports, purpose or in-repo dependencies, updates the corresponding map entry in the same
change.** The `docs-map` skill
([`.claude/skills/docs-map/SKILL.md`](.claude/skills/docs-map/SKILL.md)) carries the entry
template, the reverse-edge step people usually miss, and the audit commands. Invoke it with
`/docs-map` to check or audit the map.

Prose pages (`architecture/`, `features/`, `api/`, `data/`, `operations/`) describe behavior and
intent — update them when *behavior* changes, not when a file moves.

## Facts that change how you work here

- **No tests and no CI**, in either half. Verification is `cd web && npm run build`
  (`tsc -b` is part of it, so type errors fail) plus running a real job end to end.
- **One serial worker thread**, in-process, in-memory queue. A restart orphans in-flight jobs.
- **The job row is the only progress channel** — stages `UPDATE` it, the SSE endpoint polls it.
  `sqlite3 server/data/db.sqlite3 "SELECT status, stage_message FROM jobs ORDER BY created_at DESC LIMIT 5;"`
  shows exactly what the UI would display.
- **The API contract is duplicated by hand** between `server/app/models/schemas.py` and
  `web/src/api/client.ts`. Nothing enforces agreement; a rename on one side silently breaks the
  other. See [`docs/api/contract-sync.md`](docs/api/contract-sync.md).
- **`PlaybackEngine` is the only audio truth.** Meters and dial needles bypass React —
  `useAnimationFrame` writes them to the DOM every frame — and pitch-preserving speed runs in the
  `chord-stretch` AudioWorklet (`web/src/audio/stretchProcessor.js`, plain JS), which the engine
  drives only by `postMessage`.
- **Styling is the vendored `ch-`/Nocturne classes in `web/src/styles/`.** Runtime values reach
  them as CSS custom properties (`--v`, `--l`, `--p`, `--stem`), never as inline geometry. Inline
  styles either repeat the harness's own declarations, with tokens for any value a token carries,
  or do layout; Tailwind is layout only. No new colors. `npm run lint` checks the mechanical part
  (`web/scripts/check-design.mjs`).
- **Comments explain *why*, never *what*.** Empty `catch` blocks are always annotated with the
  reason nothing is done. Match that.
- **`web/template/` is the source of truth for design and UX.** When its parts disagree, the
  written rules (`web/template/template/INSTRUCTIONS.md`, `README.md`) win, then the vendored
  stylesheets, then the harness `web/template/CHORD Template.dc.html` — which renders every screen
  and state at web and phone widths — then the Mockups board. Screens under `web/src/screens/`
  follow the harness markup element for element, and every string they render lives in
  `web/src/design/copy.ts`, error text from the API and the event stream aside. The rules, the
  recorded exceptions and what to do where the template is silent are in
  [`docs/conventions/design.md`](docs/conventions/design.md). The template is reference only —
  never imported or shipped, and `npm run lint` ignores it.

## Commands

```bash
./scripts/start.sh          # build + up (auto-detects an NVIDIA GPU); http://localhost:8080
./scripts/stop.sh
cd web && npm run dev       # Vite dev server — note the proxy port mismatch in docs/operations
cd web && npm run build     # tsc -b && vite build
cd web && npm run lint      # oxlint, then the design-rule check
docker compose logs -f server
```
