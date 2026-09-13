# Conventions

Patterns actually used in this codebase, derived from reading it rather than prescribed. Match
them; where you disagree, change them everywhere rather than introducing a second style.

| Page | Covers |
| --- | --- |
| [python.md](python.md) | server-side style, layering rules, error handling |
| [typescript.md](typescript.md) | web-side style, React patterns, hooks, styling |

## Shared across both halves

### Comments explain *why*, never *what*

This is the single most consistent habit in the repo, and the most important one to preserve.
Comments are reserved for the non-obvious: a workaround, a constraint, a deliberate omission.

```python
# madmom's key model names some keys with flats (e.g. "Db major"); the rest of the
# app only deals in sharps, so normalize to the enharmonic sharp spelling on the way in.
```

```ts
// A real media element (loaded from the same stem URL) gives WaveSurfer a genuine
// duration to compute cursor/progress position from; `peaks` still skips re-decoding
// for the waveform itself, since PlaybackEngine already owns audible playback.
```

There are no `// increment i` comments and no restated signatures. If a line needs explaining
and the reason is obvious from the code, the comment is omitted.

### Empty catch blocks are always annotated

Never a bare silent swallow. Every one says why nothing is done:

```ts
} catch {
  // The download simply won't start; nothing else to recover here.
}
```

```ts
} catch {
  // Private browsing or storage disabled; StemMixer just falls back to its own default.
}
```

```python
except Exception:  # noqa: BLE001 - run_job already records failures on the job row
```

### Named constants, not magic numbers

Tuning values are module-level constants with meaningful names, even when used once:
`_MIN_SCORE_IMPROVEMENT`, `SILENCE_RMS_THRESHOLD`, `VIEW_TRANSITION_MS`, `MARQUEE_GAP`,
`AMP_WIDTH`. Derived geometry is *computed* from them rather than restated:

```ts
export const MASTER_WIDTH = AMP_WIDTH * 2 + GRID_GAP;
export const CABINET_WIDTH =
  MASTER_WIDTH + CABINET_BEZEL_PADDING * 2 + CABINET_GAP * 2 + CABINET_POST_WIDTH * 2 + CABINET_PADDING_X * 2;
```

### Failures degrade, they don't propagate

Optional features return a falsy value rather than raising. A missing `ffprobe`, a lrclib
outage, a tainted canvas, a failed thumbnail extraction — each is logged where appropriate and
returns `None` / `null` / `false`, and the job or render continues without that piece.

The inverse also holds: anything that *must* reach the user does. `run_job`'s single
`except Exception` guarantees every failure lands on the job row as `status=error`.

### One name per concept, imported rather than retyped

`THUMBNAIL_FILENAME`, `STEM_NAMES`, `job_dir()`, `TERMINAL_STATUSES` each exist once and are
imported by their consumers — including across layers, where routes import `job_dir` from
`pipeline.pipeline` rather than composing the path themselves.

The exceptions are the deliberate cross-language duplications (`NOTE_NAMES`,
`TERMINAL_STATUSES`, the whole API contract), which are documented as such in
[../api/contract-sync.md](../api/contract-sync.md).

## Formatting

No formatter or linter config is enforced in CI — there is no CI. Observed conventions:

| | Server | Web |
| --- | --- | --- |
| Indentation | 4 spaces | 2 spaces |
| Line length | ~110 | ~120 |
| Quotes | double | double (the two Vite-scaffolded files, `main.tsx` and `vite.config.ts`, still use single) |
| Semicolons | n/a | yes |
| Trailing commas | yes, multiline | yes, multiline |

`web/.oxlintrc.json` enables only two rules (`react/rules-of-hooks` as an error,
`react/only-export-components` as a warning). `npm run lint` runs it; nothing runs on the server.

## Naming

- **Files**: `snake_case.py`; `PascalCase.tsx` for components, `camelCase.ts` for everything
  else.
- **Private helpers** are `_`-prefixed in Python (`_row_to_response`, `_update_job`,
  `_is_cancelled`) and plain non-exported functions in TypeScript.
- **Hooks** are `use*`; handlers are `handle*` inside a component and `on*` as a prop.
- **Booleans** read as predicates: `isPlaying`, `hasVocals`, `isDownloading`, `has_thumbnail`.

## Adding to the codebase

Whatever you change, the file-by-file index in [../map/](../map/) must keep matching the code —
that's what the [`docs-map` skill](../../.claude/skills/docs-map/SKILL.md) enforces. Start from
[../map/tasks.md](../map/tasks.md), which routes a change description to the files it touches.
