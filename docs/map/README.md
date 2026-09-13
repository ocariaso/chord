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

```
### `path/to/file.ext` — <one-line purpose>
**Exports:** the public surface (functions, components, constants, types)
**Imports from:** the in-repo modules it depends on
**Used by:** the in-repo modules that depend on it
**Notes:** anything a reader would otherwise have to discover by reading the file
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
   processing story in 109 lines.
3. [`server/app/api/routes_jobs.py`](../../server/app/api/routes_jobs.py) — how the outside
   world starts and watches work.
4. [`web/src/api/client.ts`](../../web/src/api/client.ts) — the contract, from the other side.
5. [`web/src/App.tsx`](../../web/src/App.tsx) — the three screens.
6. [`web/src/audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) — the only real
   algorithmic component on the client.
7. [`web/src/components/StemMixer.tsx`](../../web/src/components/StemMixer.tsx) — the state hub
   both views hang off.

Skip [`web/src/components/studio/amps/`](../../web/src/components/studio/amps/) entirely on a
first pass; the six amps are ~800 lines of presentational SVG that share one small interface.

## What lives where, at a glance

| Looking for | Directory |
| --- | --- |
| HTTP endpoints | [`server/app/api/`](../../server/app/api/) |
| audio analysis, downloads, orchestration | [`server/app/pipeline/`](../../server/app/pipeline/) |
| SQLite schema and access | [`server/app/db/`](../../server/app/db/) |
| settings and paths | [`server/app/core/`](../../server/app/core/) |
| request/response models | [`server/app/models/`](../../server/app/models/) |
| API client and types | [`web/src/api/`](../../web/src/api/) |
| Web Audio playback | [`web/src/audio/`](../../web/src/audio/) |
| screens and Simple view | [`web/src/components/`](../../web/src/components/) |
| the Studio view | [`web/src/components/studio/`](../../web/src/components/studio/) |
| reusable stateful logic | [`web/src/hooks/`](../../web/src/hooks/) |
| pure functions | [`web/src/utils/`](../../web/src/utils/) |

## Maintenance

**This map is expected to match the code exactly.** Unlike the prose elsewhere in `docs/`, it
is an index — a stale entry actively misleads.

The [`docs-map` skill](../../.claude/skills/docs-map/SKILL.md) defines the rule: any change that
adds, deletes, moves or renames a source file, or that changes a file's exports or purpose,
updates the corresponding entry in the same change. The skill carries the full procedure and the
entry template.

Prose pages under `architecture/`, `features/`, `api/`, `data/` and `operations/` describe
behavior and intent; they need updating when *behavior* changes, not when a file moves.
