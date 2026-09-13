# Code map

A mechanical, file-by-file index of the repository, written so an agent (or a new contributor)
can locate the owner of any behavior without searching.

| Page | Covers |
| --- | --- |
| [tasks.md](tasks.md) | **start here** — routes "I want to change X" to the files involved |
| [root.md](root.md) | repository-root files: Compose, scripts, ignore rules |
| [server.md](server.md) | every file under [`server/`](../../server/) |
| [web.md](web.md) | every file under [`web/`](../../web/) |

## How to read an entry

Each file gets one block:

```markdown
### `path/to/file.ext` — <one-line purpose>
**Exports:** the public surface (functions, components, constants, types)
**Imports from:** the in-repo modules it depends on
**Used by:** the in-repo modules that depend on it
**Notes:** anything a reader would otherwise have to discover by reading the file
**See:** the prose docs that explain it
```

Conventions used throughout:

- `—` in a field means "none".
- **Imports from / Used by** list *in-repo* dependencies only. Third-party packages appear under
  Notes when they matter.
- Line counts are given for files over ~100 lines, as a rough sense of weight.
- "Leaf" means nothing in the repo imports it except the entry point that composes it.

## Reading order for a newcomer

If you're building a mental model from scratch, this order minimizes backtracking:

1. [`server/app/models/schemas.py`](../../server/app/models/schemas.py) — the vocabulary. Job
   statuses, the response shape, the stem names.
2. [`server/app/pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) — the whole
   processing story in one function, `run_job`, including how a cancelled or resumed run is
   abandoned.
3. [`server/app/api/routes_jobs.py`](../../server/app/api/routes_jobs.py) — how the outside
   world starts, watches, cancels and resumes work.
4. [`web/src/api/client.ts`](../../web/src/api/client.ts) — the contract, from the other side.
5. [`web/src/App.tsx`](../../web/src/App.tsx) — which screen shows, derived from the job's status.
6. [`web/src/audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) — the only audio
   truth: the stem graph, the transport clock, loops and speed.
7. [`web/src/design/player.ts`](../../web/src/design/player.ts) — the design template's player
   state, held as UI positions, and the tapers that turn them into dB. Its neighbours in
   [`design/`](../../web/src/design/) hold every rendered string, the stem identities and the
   stage list.
8. [`web/src/screens/results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx)
   — the state hub the three result views hang off.

Skip [`web/template/`](../../web/template/) unless you are changing how a screen looks — it is the
design reference the UI was built from, not code that runs; read it with
[../conventions/design.md](../conventions/design.md). On a first pass, also skip the signal
processing in [`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js) and
[`meters.ts`](../../web/src/audio/meters.ts); the engine's interface to both is small.

## What lives where, at a glance

| Looking for | Directory |
| --- | --- |
| HTTP endpoints | [`server/app/api/`](../../server/app/api/) |
| audio analysis, downloads, orchestration | [`server/app/pipeline/`](../../server/app/pipeline/) |
| SQLite schema and access | [`server/app/db/`](../../server/app/db/) |
| settings and paths | [`server/app/core/`](../../server/app/core/) |
| request/response models | [`server/app/models/`](../../server/app/models/) |
| API client and types | [`web/src/api/`](../../web/src/api/) |
| Web Audio playback, time-stretch and metering | [`web/src/audio/`](../../web/src/audio/) |
| design tokens and the `ch-` component styles | [`web/src/styles/`](../../web/src/styles/) |
| the template's vocabulary — copy, player state, stems, stages, breakpoint | [`web/src/design/`](../../web/src/design/) |
| the screens, one folder per template screen | [`web/src/screens/`](../../web/src/screens/) |
| the results screen — state hub, views, chords, transport, dialogs | [`web/src/screens/results/`](../../web/src/screens/results/) |
| the pieces the screens share — card, cover art, dialog, footer, icons | [`web/src/components/`](../../web/src/components/) |
| faders, knobs, mute/solo, waveforms | [`web/src/components/controls/`](../../web/src/components/controls/) |
| reusable stateful logic | [`web/src/hooks/`](../../web/src/hooks/) |
| pure functions | [`web/src/utils/`](../../web/src/utils/) |
| the design template's rules as a lint step | [`web/scripts/`](../../web/scripts/) |
| the design reference — harness, mockups, stylesheet sources | [`web/template/`](../../web/template/) |

## Maintenance

**This map is expected to match the code exactly.** Unlike the prose elsewhere in `docs/`, it
is an index — a stale entry actively misleads.

The [`docs-map` skill](../../.claude/skills/docs-map/SKILL.md) defines the rule: any change that
adds, deletes, moves or renames a source file, or that changes a file's exports, purpose or
in-repo dependencies, updates the corresponding entry in the same change. The skill carries the
full procedure and the entry template.

Prose pages under `architecture/`, `features/`, `api/`, `data/` and `operations/` describe
behavior and intent; they need updating when *behavior* changes, not when a file moves.
