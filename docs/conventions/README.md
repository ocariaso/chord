# Conventions

Patterns actually used in this codebase, derived from reading it rather than prescribed. Match
them; where you disagree, change them everywhere rather than introducing a second style.

| Page | Covers |
| --- | --- |
| [python.md](python.md) | server-side style, layering rules, error handling |
| [typescript.md](typescript.md) | web-side style, React patterns, hooks, styling |
| [design.md](design.md) | the design template as the source of truth: which part wins, reproducing the harness, copy, state, responsive rules, the design check, recorded departures |

## Shared across both halves

### Comments explain *why*, never *what*

This is the single most consistent habit in the repo, and the most important one to preserve.
Comments are reserved for the non-obvious: a workaround, a constraint, a deliberate omission.

```python
# The separator is a process-wide singleton, so the callback is swapped per job rather than
# fixed at construction.
```

```ts
// EventSource would retry on its own with nothing to resume from; take over instead.
```

There are no `// increment i` comments and no restated signatures. If a line needs explaining
and the reason is obvious from the code, the comment is omitted.

### Empty catch blocks are always annotated

Never a bare silent swallow. Every one says why nothing is done:

```ts
} catch {
  // A job that finished in the meantime answers 409; the event stream reports its real state either way.
}
```

```ts
try {
  source.stop();
} catch {
  // already stopped
}
```

```python
except Exception:  # noqa: BLE001 - run_job already records failures on the job row
```

### Named constants, not magic numbers

Tuning values are module-level constants with meaningful names, even when used once:
`_MIN_SCORE_IMPROVEMENT`, `_SUPERSEDED_POLL_SECONDS`, `SILENCE_RMS_THRESHOLD`, `FADER_RANGE_DB`,
`KNOB_DRAG_PIXELS`. Values derived from them are *computed* rather than restated:

```ts
const truePeakFrom = MASTER_METER_FFT_SIZE - TRUE_PEAK_SPAN;
const windowSamples = Math.round(MOMENTARY_LOUDNESS_SECONDS * this.audioContext.sampleRate);
const windowStart = Math.max(0, LOUDNESS_FFT_SIZE - windowSamples);
```

The exceptions are literals at the call site: subprocess and HTTP timeouts, the SSE poll interval,
and the 720px breakpoint, which [`design/layout.ts`](../../web/src/design/layout.ts) names
(`PHONE_QUERY`) but Tailwind's `max-[720px]:` in `App` and `MixerView` repeats. The full list is in
[../operations/configuration.md](../operations/configuration.md#hardcoded-values-worth-knowing).

### Failures degrade, they don't propagate

Optional features return a falsy value rather than raising. A missing `ffprobe`, a lrclib outage,
a failed thumbnail extraction, a stem that won't download — each is logged or reported where
appropriate and yields `None` / `null` / `false` / a list of failures, and the job or render
continues without that piece. `PlaybackEngine.load()` resolves with the stems that failed rather
than rejecting, so the rest still play.

Required steps do the opposite. `metadata.read_audio_info` raises on audio libsndfile can't open,
because nothing after it can run without a duration, and `run_job`'s single `except Exception`
turns every such failure into `status=error` — a sentence for the user in `error_message`, the
exception in `error_log`. Anything that *must* reach the user does.

### One name per concept, imported rather than retyped

`THUMBNAIL_FILENAME`, `STEM_NAMES`, `job_dir()`, `TERMINAL_STATUSES`, `MIN_TRANSPOSE` /
`MAX_TRANSPOSE` each exist once within their half and are imported by their consumers —
including across layers, where routes import `job_dir` from `pipeline.pipeline` rather than
composing the path themselves.

The exceptions are the deliberate cross-language duplications (`NOTE_NAMES`,
`TERMINAL_STATUSES`, the stage messages, the whole API contract), which are documented as such in
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

`web/.oxlintrc.json` configures two rules on top of oxlint's defaults (`react/rules-of-hooks` as
an error, `react/only-export-components` as a warning) and ignores `template/**`, the vendored
design template. `npm run lint` runs it, then
[`web/scripts/check-design.mjs`](../../web/scripts/check-design.mjs), the design template's
adherence rules ([design.md](design.md#the-design-check)); nothing runs on the server.

The two stylesheets in `web/src/styles/` are vendored from that template and keep its formatting.

## Naming

- **Files**: `snake_case.py`; `PascalCase.tsx` for components, `camelCase.ts` for everything
  else.
- **Private helpers** are `_`-prefixed in Python (`_row_to_response`, `_update_job`,
  `_is_superseded`) and plain non-exported functions in TypeScript.
- **Hooks** are `use*`; handlers are `handle*` inside a component and `on*` as a prop.
- **Booleans** read as predicates: `isPlaying`, `hasVocals`, `isCancelling`, `has_thumbnail`.
- **CSS classes** come from the vendored sheets — `ch-*` components with `is-*` state modifiers
  (`is-on`, `is-off`, `is-current`). Nothing in `web/src` defines its own, and nothing else uses
  the `ch-` prefix, ids included.

## Adding to the codebase

Whatever you change, the file-by-file index in [../map/](../map/) must keep matching the code —
that's what the [`docs-map` skill](../../.claude/skills/docs-map/SKILL.md) enforces. Start from
[../map/tasks.md](../map/tasks.md), which routes a change description to the files it touches.
