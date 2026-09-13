# Design conventions

The design template in [`web/template/`](../../web/template/) is the source of truth for how CHORD
looks, reads and behaves. This page is the standard for applying it: which part of the template
wins when its parts disagree, how a screen reproduces it, where its vocabulary lives in the code,
what `npm run lint` checks, and the places where the app deliberately departs from it.

## Which part of the template wins

The template is several artifacts, and they don't always agree. They rank in this order:

| Rank | Source | Settles |
| --- | --- | --- |
| 1 | [`INSTRUCTIONS.md`](../../web/template/template/INSTRUCTIONS.md) and [`README.md`](../../web/template/template/README.md) | ground rules, the state model, responsive behavior, accessibility |
| 2 | [`styles/nocturne.css`](../../web/src/styles/nocturne.css) and [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css), vendored unmodified | every color, font, spacing, radius, shadow and component class |
| 3 | `web/template/CHORD Template.dc.html`, the harness | class nesting, element order, copy, and the inline layout of each of its 21 scenarios |
| 4 | `web/template/CHORD Mockups.dc.html`, the approved board | only what the harness doesn't show |

A lower rank never overrides a higher one. The harness draws a separate phone frame for the
results screen — stem cards, a compact header, a different bottom bar — but INSTRUCTIONS §5 says
that below 720px the results lock to the Mixer and `.ch-stemrow` stacks, and `chord-theme.css`
implements exactly that. The app follows §5.

Both reference files open directly in a browser. The harness renders every scenario at web and
phone width, so it's the thing to compare a screen against.

## Where the template lives in the code

| Template | Code |
| --- | --- |
| A screen and its states — landing, processing, failure, results | a folder under [`web/src/screens/`](../../web/src/screens/) |
| A part INSTRUCTIONS §4 names | its own component: `StemRow`, `ConsoleStrip`, `MasterStrip`, `AnalogModule`, `OutputDial`, `ChordBar`, `Transport` |
| The fader, knob, MUTE/SOLO pair and waveform | [`web/src/components/controls/`](../../web/src/components/controls/) |
| The card every screen sits on | [`ScreenCard`](../../web/src/components/ScreenCard.tsx) |
| Every rendered string | [`design/copy.ts`](../../web/src/design/copy.ts) |
| The state model (§3) | [`design/player.ts`](../../web/src/design/player.ts), changed only by [`playerReducer.ts`](../../web/src/screens/results/playerReducer.ts) |
| Stem identity: keys, names, hues | [`design/stems.ts`](../../web/src/design/stems.ts) |
| The processing stage list (§4.6) | [`design/stages.ts`](../../web/src/design/stages.ts) |
| The breakpoint (§5) | [`design/layout.ts`](../../web/src/design/layout.ts) |

`design/` holds no components and never imports from `screens/` or `components/`.

## Ground rules

INSTRUCTIONS §0 and §10, as this codebase applies them:

1. **The stylesheets are the vocabulary.** They're vendored unmodified — never edited to fix a
   component — and app CSS defines no classes. A value the tokens lack belongs in the template as a
   token, not in a component as a literal.
2. **Runtime state goes in through four custom properties:** `--v` (control position), `--l`
   (meter level), `--p` (playback position) and `--stem` (hue). Never set `width`, `left`,
   `transform` or `background` inline on a control; its class maps the variable to the right
   property. The one computed shape is a waveform's `clip-path`, which the template asks for.
3. **Every control has a visible label and a numeric value.**
4. **Inter only**, through `var(--font-body)`.
5. **Don't invent classes.** Anything the template lacks is a composition of its classes plus
   layout.
6. **No new color.** The palette is the six stem hues, the two status hues (for dots and hairlines
   only) and the Nocturne ramps. A hairline mixes a token toward transparent.
7. **Stage messages and error text are exact.** Stage messages are matched against the API's
   `stage_message`.

## Reproducing a harness screen

Read the harness markup for the scenario and reproduce it element for element — same classes,
same nesting, same order, same copy — as idiomatic React rather than a port of the file.

The harness's inline declarations come across as written, except that a value a token carries
becomes the token:

| Harness | Code |
| --- | --- |
| `#e9e9ed` | `var(--color-text)` |
| `#e4e7f5` · `#b2b6ca` · `#9397ab` · `#75798c` · `#595d6c` · `#3f424d` | `var(--color-neutral-200)` · `-400` · `-500` · `-600` · `-700` · `-800` |
| `#d2cefd` · `#b5abfc` · `#9184d9` | `var(--color-accent-300)` · `var(--color-accent-400)` · `var(--color-accent)` |
| `#423a6a` · `#2b2741` | `var(--color-accent-800)` · `var(--color-accent-900)` |
| `#161826` · `#1d1f30` | `var(--color-bg)` · `var(--ch-panel-raised)` |
| `rgba(233,233,237,.08)` | `color-mix(in srgb, var(--color-text) 8%, transparent)` |
| `'Inter',sans-serif` | `var(--font-body)` |
| `var(--space-6)` | `var(--space-6)`, never its px value |
| `14px` | `14` — a size no token carries stays as the harness writes it |

Two things never come across:

- **Demo values.** The harness's levels, times and progress are fixed. The app feeds the same
  variables from state (`--v`, `--p`) or from the frame loop (`--l`).
- **Stand-ins.** `.ch-wave-a|b|c` are placeholder envelopes, so the app traces a polygon from the
  decoded stem; `.ch-nav*` is harness chrome.

The accessibility the harness leaves out — roles, labels, keyboard handling — is added; see
[Accessibility](#accessibility).

Don't add UI to a screen the template draws unless it's recorded
[below](#recorded-departures-and-decisions). What was removed for that reason, and why, is in
[../architecture/decisions.md](../architecture/decisions.md).

## Where the template is silent

The template doesn't draw every state: the dialogs behind Export stems, Open lyric sheet and Add
lyrics manually; the speed popover; a job that no longer exists; loading and empty states such as
"Looking for lyrics…". For those:

- **Compose the template's classes** — Nocturne's `.dialog`, `.field` and `.input`; the template's
  `.ch-panel`, `.ch-chip`, `.ch-stemrow` and `.ch-alert` — with layout-only inline styles or
  Tailwind layout utilities.
- **Reuse a template panel before inventing a layout.** A job that no longer exists gets the
  failure panel, with one action.
- **Keep copy minimal and in the template's voice**, under an "App-authored" comment in
  `copy.ts`.

## Copy

- **Every rendered string is in [`design/copy.ts`](../../web/src/design/copy.ts)**, accessible
  names included, grouped by screen: `landingCopy`, `processingCopy`, `resultsCopy`, `failureCopy`
  (keyed by the template's scenario ids), `dialogCopy` and `footerCopy`. Numbers are the
  exception: readouts, times and scale ticks are formatted where they're computed —
  [`utils/levels.ts`](../../web/src/utils/levels.ts), [`utils/time.ts`](../../web/src/utils/time.ts),
  and the tick constants beside the strips and dials that draw them.
- **Strings are verbatim from the harness** unless they're marked "App-authored" or "Reworded by
  decision". A string with values in it is a function, as in
  `failureCopy["connection-error"].body(attempt, max)`.
- **`processingCopy.stages` doubles as the API's stage messages**, so change it together with the
  server; see [../api/contract-sync.md](../api/contract-sync.md).
- **Error text is shown as it arrives**, not rewritten: the server's, [`api/client.ts`](../../web/src/api/client.ts)'s,
  and the connection errors [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) records for the log.
- **Typography:** readouts use the real minus sign, U+2212 (`formatDb` and `formatSigned` in
  [`utils/levels.ts`](../../web/src/utils/levels.ts)), and text uses the ellipsis character `…`,
  not three dots.

## State

INSTRUCTIONS §3's model is [`design/player.ts`](../../web/src/design/player.ts): `StemState` and
`PlayerState`, held in one `useReducer` in `ResultsScreen`. What the template doesn't model — load
phase, speed, loop, chords, lyrics, open dialogs — is ordinary state beside it.

- **Controls store UI positions, 0…1.** Decibels are derived, never stored.
  - `db()` spans 36 dB with the bottom silent, which puts the Console strip's 0 / −12 / −24 / −∞
    ticks at thirds of the travel.
  - `masterDb()` runs through the master strip's own ticks, 0 / −6 / −18 / −∞.
  - §3 allows exactly this change: replace `db()`, and every fader and knob keeps following `--v`.
- **`audible()` dims a waveform:** a stem is audible when it isn't muted and either nothing is
  soloed or it is.
- **A strip or module shows state in the harness's order.** Soloed comes first (`.is-active`,
  "Soloed"), then muted (`.is-off`). Mute still silences the audio.

## Responsive

One breakpoint: 720px.

- **Where the breakpoint is read:**
  - components use `PHONE_QUERY` from `design/layout.ts` through `useMediaQuery`;
  - `App` and `MixerView` use Tailwind's `max-[720px]:`;
  - `chord-theme.css` has its own `@media (max-width: 720px)`.
- **Landing and processing** follow the harness's phone frames, since the written rules say
  nothing about them.
- **Results follow INSTRUCTIONS §5:** locked to the Mixer, with no view tabs. The stylesheet
  stacks the `.ch-stemrow` rows with 44px MUTE/SOLO targets, and the transport becomes
  `.ch-m-bar`: play, seek and the Click chip. The Mixer's column labels and the analysis bar's
  dividers are hidden too: the columns the labels head and the single row the dividers split no
  longer exist once everything stacks.
- **Between 720 and 1024px**, the Console and Analog rows scroll horizontally at their floors.

## Accessibility

INSTRUCTIONS §6, as implemented:

- **Faders and knobs** are `role="slider"` with `aria-valuemin`, `aria-valuemax` and
  `aria-valuenow`, an `aria-label` naming the stem and value, and `aria-valuetext`. Keyboard
  handling is in [`useSliderControl`](../../web/src/hooks/useSliderControl.ts):
  - an arrow moves ±0.01, and Shift+arrow ±0.1;
  - Home and End go to 0 and 1;
  - Page Up and Page Down move ±0.1 — not in §4.1, but part of the ARIA slider pattern.
- **MUTE and SOLO** are `<button>`s with `aria-pressed`.
- **View tabs** use `tablist`, `tab` and `aria-selected`, move with the arrow keys, and label
  their panel.
- **The focus ring** is Nocturne's `:focus-visible`; never remove it.
- **`prefers-reduced-motion`** steps the playhead once a second.
- **Pointer-only shortcuts**, like dragging the chord strip to seek, are `aria-hidden`; the
  transport's seek slider does the same job accessibly.

## The design check

`npm run lint` runs oxlint, then [`web/scripts/check-design.mjs`](../../web/scripts/check-design.mjs).

- **Why a separate script:** the design system ships its adherence rules as ESLint
  `no-restricted-syntax` selectors (`web/template/_ds/…/_adherence.oxlintrc.json`), which oxlint
  doesn't implement. The script carries them and adds what the ground rules make checkable.
- **Where its vocabulary comes from:** it reads the tokens and classes from the two vendored
  stylesheets, so it keeps up when they change.

| It flags | Because |
| --- | --- |
| a hex color | tokens carry every color |
| a color function, except black `rgba()` in a shadow | no new color |
| a font shorthand or `fontFamily` without `var(--font-body)` or `var(--font-heading)` | Inter only |
| a spacing token's value written as px, such as `16.8px` | write `var(--space-6)` |
| a `var(--…)` token neither stylesheet defines, or one built at runtime | there is no `--space-5` or `--space-7`, for instance, and a built name can't be checked |
| a `ch-`, `is-`, `btn`, `dialog`, `field`, `input` or `lighten` class the stylesheets don't define | don't invent classes |
| an inline custom property other than `--v`, `--l`, `--p` and `--stem` | runtime state goes through those four |
| a class selector in app CSS | compose instead |

The `ch-` prefix belongs to the template's classes, so ids never start with it.

- **How it scans:** string literals, not an AST, and every report names the file and line. A token
  name built at runtime, such as `var(--ch-${key})`, is reported too, since no check can vouch for
  it — write each token out, as `design/stems.ts` does for the stem hues.
- **What it can't see**, so review checks it:
  - inline geometry on a control;
  - a control without a label and a value;
  - markup that drifts from the harness;
  - a string written outside `copy.ts`.

## Recorded departures and decisions

| Where | Template | App | Why |
| --- | --- | --- | --- |
| Results below 720px | the harness's phone frame | INSTRUCTIONS §5, as the stylesheet implements it | the written rules outrank the harness |
| A stacked stem row below 720px | README.md: "name + dB on line one, fader on line two" | the name alone on line one, the dB beside its fader on line two | INSTRUCTIONS §4.1's markup, the harness and the stylesheet's own rules all nest the value in `.ch-stemrow-level`; lifting it out would break the 150px level column on the web |
| Analog Tone and Pan knobs | a label, no value | the value under each label (`formatTone`, `formatPan`) | INSTRUCTIONS §0.3: every control carries a visible label and a numeric value; the written rules outrank the harness |
| A Mixer waveform while another stem is soloed | the harness dims a waveform only when its own stem is muted | INSTRUCTIONS §4.1: dimmed whenever the stem isn't `audible()`, held stems included | the written rules outrank the harness |
| `job-cancelled` body | "…The upload is still in your queue for 24 hours if you want to resume it." | "…The upload is kept until you leave this page if you want to resume it." | leaving the page discards a cancelled job; nothing is held for 24 hours |
| `connection-error` secondary action | "Work offline" | "New track" | the app has no offline mode |
| Footer | none | kept: Nocturne icon buttons and a `.ch-hint` line | kept by decision |
| `db()` | linear, −12…0 dB | 36 dB span with the bottom silent; the master through its own ticks | §3 invites a different taper, and these match the strips' tick columns |
| Page ground | the harness canvas, a radial gradient `#1d1f33` → `#161826` → `#121320` | the same gradient through `--ch-panel-raised`, `--color-bg` and `--ch-well` | the nearest tokens; two of the harness's stops aren't tokens |

A new departure is recorded here and in [../architecture/decisions.md](../architecture/decisions.md)
in the same change.

## Checking a UI change

1. `cd web && npm run build && npm run lint`.
2. Open the harness and the app side by side for every scenario the change touches, at a desktop
   width and at a phone width under 720px, and walk INSTRUCTIONS §9's checklist for that slice.
3. Tab through the touched controls: arrows move them, the focus ring shows, and nothing clips at
   200% zoom.
