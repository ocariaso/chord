# Design conventions

CHORD's UI follows one design, and this page is its standard: the rules every screen keeps, the
vocabulary the stylesheets provide, the states each screen has, and the calls taken where the design
left a choice. The screens in [`web/src/screens/`](../../web/src/screens/) are its reference
implementation. When this page and a screen disagree, one of them is wrong — fix it in the same
change.

The design came from a template: a written integration guide, a demo harness that rendered every
screen state at web and phone width, and a static mockup board. It lived in `web/template/` while the
UI was built from it and has since been removed; everything still binding is on this page. To read the
originals, `git show 2a9783e:web/template/template/INSTRUCTIONS.md` gives the guide,
`git show 2a9783e:web/template/template/README.md` the class inventory, and
`git show "2a9783e:web/template/CHORD Template.dc.html"` the harness. Code comments that say *the
template* or *the design*, or name a state id such as `processing-loading`, mean the design as
recorded here.

## Where the design lives

| What | Where |
| --- | --- |
| Rules, states and decisions | this page |
| Every color, font, spacing, radius, shadow and component class | [`styles/nocturne.css`](../../web/src/styles/nocturne.css) and [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css) |
| Every rendered string | [`design/copy.ts`](../../web/src/design/copy.ts) |
| The state model | [`design/player.ts`](../../web/src/design/player.ts), changed only by [`playerReducer.ts`](../../web/src/screens/results/playerReducer.ts) |
| Stem identity: keys, names, hues | [`design/stems.ts`](../../web/src/design/stems.ts) |
| The processing stage list | [`design/stages.ts`](../../web/src/design/stages.ts) |
| The breakpoint | [`design/layout.ts`](../../web/src/design/layout.ts) |
| A screen and its states | a folder under [`screens/`](../../web/src/screens/) |
| The fader, knob, MUTE/SOLO pair and waveform | [`components/controls/`](../../web/src/components/controls/) |
| The card the failure and results screens sit on (landing and processing sit on the page ground) | [`ScreenCard`](../../web/src/components/ScreenCard.tsx) |

`design/` holds no components and never imports from `screens/` or `components/`.

## Ground rules

1. **The stylesheets are the vocabulary.** They came with the template and are kept as they arrived.
   Changing a token or a `ch-` class changes the design: do it there, deliberately, never as a
   literal in a component. A value a token carries is written as the token (`var(--space-6)`, never
   `16.8px`), and app CSS defines no classes.
2. **Runtime state goes in through four custom properties** — see [Runtime values](#runtime-values).
   Never set `width`, `left`, `transform` or `background` inline on a control; its class maps the
   variable to the right property. The one computed shape is a waveform's `clip-path`.
3. **Every control has a visible label and a numeric value.** A control without both doesn't ship.
4. **Inter only**, through `var(--font-body)`, and no skeuomorphic textures.
5. **Don't invent classes.** Anything missing is a composition of existing classes plus layout.
   Inline styles carry the design's own declarations — type and color, through tokens — or layout;
   Tailwind utilities are layout only.
6. **No new color.** The palette is the six stem hues, the two status hues (for dots and hairlines
   only) and the Nocturne ramps. A hairline mixes a token toward transparent, and body copy uses
   `--color-neutral-300` or `-400`, never the accent at paragraph size.
7. **Stage messages and error text are exact.** Stage messages are matched against the API's
   `stage_message`.

## Runtime values

Components take state as custom properties, never as inline geometry:

| Variable | Range | Applies to | Meaning |
| --- | --- | --- | --- |
| `--v` | 0…1 | `.ch-fader`, `.ch-vfader`, `.ch-knob`, `.ch-progress` | control position |
| `--l` | 0…1 | `.ch-meter i` | meter level, post-fader |
| `--p` | 0…1 | `.ch-playhead`, `.ch-seek` | playback position |
| `--stem` | a color | any stem scope | the stem's hue, set once on a row, strip or module and inherited by its dot, fader fill, meter, waveform and knob arc |

The stem hues are `--ch-vocals` (the accent), `--ch-drums`, `--ch-bass`, `--ch-guitar`, `--ch-piano`
and `--ch-other`, one per API stem name. The browser doesn't interpolate `--v`, and that's right:
controls track the pointer exactly, so never animate `--v` or the geometry it drives.

## Classes

- **Shell:** `.ch-app`, `.ch-topbar` (it wraps, and `.ch-topbar-title` keeps a 180px floor so a long
  title truncates instead of squeezing), `.ch-section`, `.ch-panel` (`.is-active` when soloed,
  `.is-off` when muted), `.ch-divider-x`, `.ch-divider-y`.
- **Type:** `.ch-label` (the all-caps name every control carries), `.ch-value` and `.ch-value-sm`
  (tabular numerals), `.ch-hint`, `.ch-title`, `.ch-subtitle`, `.ch-dot` and `.ch-dot-status`.
- **Controls:**
  - `.ch-fader` (`.ch-fader-thin`), and `.ch-vfader` with one `<span>` child, the cap;
  - `.ch-knob` (`.ch-knob-sm`, 34px) with one `<span>` child — cap, pointer and arc are CSS, over a
    280° sweep — grouped with its label and value in `.ch-knob-group`;
  - `.ch-meter` with one `<i>` per channel, and `.ch-ticks` for its scale;
  - `.ch-toggle` (`.is-on` for solo, `.is-on-muted` for mute) — a text button, never a bare LED;
  - `.ch-chip` (`.is-on`), `.ch-tabs` and `.ch-tab`.
- **Content:**
  - `.ch-stemrow` with `-name`, `-level` and `-routing`, and `.ch-wave`;
  - `.ch-striprow`, `.ch-strip` and `.ch-module`;
  - `.ch-chordstrip`, `.ch-chord` (`.is-current`, `.is-past`), `.ch-playhead`, `.ch-chord-now`,
    `.ch-chord-next`, `.ch-lyric`, `.ch-lyric-next`;
  - `.ch-progress`, `.ch-stage` (`.is-done`, `.is-current`), `.ch-stage-mark`;
  - `.ch-dropzone` (`.is-over`, `.is-rejected`), `.ch-dropicon`;
  - `.ch-alert`, `.ch-alert-head`, `.ch-alert-body`, `.ch-log`;
  - `.ch-transport`, `.ch-play`, `.ch-time`, `.ch-seek`, and `.ch-m-bar`, the phone transport.
- **Nocturne:** `.btn` and its variants, `.input`, `.field`, `.dialog` and its parts, `.lighten`.
- **Leftovers from the template's demo — don't use:** `.ch-nav*`, the harness's own navigation;
  `.ch-m-stem`, the harness's phone stem card, which the app doesn't draw (see
  [Responsive](#responsive)); and `.ch-wave-a|b|c`, placeholder envelopes the app replaces with a
  traced `polygon()`.

## Screens and their states

Every state has an id, carried over from the template's harness. The ids name states in code
comments and in review.

| Id | State | Screen |
| --- | --- | --- |
| `upload` | idle | landing |
| `upload-submitting` | a request in flight | landing; the sending button reads *Submitting…* |
| `upload-error` | a file refused before upload (extension or empty) | landing with an alert |
| `processing-queued` | `status: queued` | processing |
| `processing-fetching` | `status: fetching`, *Downloading audio* | processing |
| `processing-separating` | `status: separating`, *Separating stems* | processing |
| `processing-tempo` | `status: separating`, *Detecting tempo* | processing |
| `processing-analyzing` | `status: analyzing`, *Detecting chords and key* | processing |
| `processing-loading` | `status: done`, stems decoding in the browser | processing at 100% |
| `processing-long-title` | a long `original_filename` | processing |
| `results-mixer` | `status: done` | results, Mixer |
| `results-console` | `status: done` | results, Console |
| `results-analog` | `status: done` | results, Analog |
| `results-instrumental` | a silent vocals stem | results, vocals muted and marked |
| `results-plain-lyrics` | lyrics without timing | results, *Open lyric sheet* |
| `results-no-lyrics` | no lyrics | results, *Add lyrics manually* |
| `job-error` | `status: error` | failure |
| `job-cancelled` | `status: cancelled` | failure |
| `connection-error` | the event stream failing | failure |
| `results-load-error` | stems that won't download | failure |

## Controls

- **A stem row** is the name, the level cell and the routing cell, then the waveform. The dB value
  sits inside `.ch-stemrow-level`, beside its fader.
- **Dragging:** a horizontal fader maps `(x − left) / width` and a vertical one
  `(bottom − y) / height`, with pointer capture, so mouse, pen and touch behave alike. A knob drags
  vertically, 160px for its full range — never rotationally, which is unusable with a mouse.
- **Keyboard:** an arrow moves ±0.01 and Shift+arrow ±0.1; Home and End go to 0 and 1; Page Up and
  Page Down move ±0.1, as the ARIA slider pattern expects.
- **Console:** strips sit in `.ch-striprow`, which scrolls instead of collapsing. Each is
  `.ch-panel.ch-strip` with `--stem` set, holding `.ch-vfader`, `.ch-meter`, `.ch-ticks`, the Level
  and Pan readouts and MUTE/SOLO, and the master strip ends the row.
- **Analog:** each stem is `.ch-panel.ch-module`: a Level knob in the stem's hue, then Tone and Pan
  as `.ch-knob-sm` with `--stem: var(--color-neutral-700)`, so only Level carries the hue. Every knob
  shows its label and its value.
- **Floors:** `.ch-strip` holds 112px and `.ch-module` 120px. Never give either
  `flex: 1; min-width: 0` — they collapse under their own controls.

## Metering

- **Meters bypass React.** A frame loop writes each meter's `--l` and each needle's `transform`
  straight to the DOM: a custom-property write per frame is cheap, a render per frame isn't.
- **Five dials** — Output left, Output right, True peak, Loudness and Correlation — sit in a grid of
  `repeat(5, minmax(180px, 1fr))` with `overflow-x: auto`. Each is drawn on a `0 0 200 140` viewBox,
  its needle rotating about `(100, 108)` through ±70°, with the mid label 10° left of centre.
- **The 180px floor is load-bearing:** any narrower puts the in-SVG type under 9px. If the dials
  must get narrower, show three instead of shrinking five.

## Chords and lyrics

- **The analysis bar** — key, transpose, tempo, master — is shared by all three views, so it renders
  once, above the view switch.
- **The strip** has one `.ch-chord` per segment with `flex: <duration>`, `.is-current` on the segment
  under the playhead and `.is-past` before it. `.ch-playhead` takes `--p`, and a click or drag on the
  strip seeks.
- **Transpose is a display transform.** It shifts chord roots and the key label, in sharps, and never
  touches the stored analysis.
- **The lyric row** shows the synced line at the playhead as plain text; plain lyrics get *Open lyric
  sheet*, and none get *Add lyrics manually*.

## Processing and failure

- **`.ch-progress`** takes `--v` from the job's progress.
- **The stage list is fixed and ordered:** Queued, Downloading audio, Separating stems, Detecting
  tempo, Detecting chords and key. Stages before the current one are `.is-done`, the current one
  `.is-current`, later ones plain. A skipped stage — an upload never downloads — shows as done, never
  hidden, so the layout doesn't jump.
- **A failure** is `.ch-alert` and an optional `.ch-log`, with a primary and a secondary action. The
  dot is the only status hue — `--ch-danger` for hard failures, `--ch-warn` for recoverable ones,
  neutral for cancelled — and the panel itself is never tinted.

## Copy

- **Every rendered string is in [`design/copy.ts`](../../web/src/design/copy.ts)**, accessible names
  included, grouped by screen: `landingCopy`, `processingCopy`, `resultsCopy`, `failureCopy` (keyed
  by state id), `dialogCopy` and `footerCopy`. Numbers are the exception: readouts, times and scale
  ticks are formatted where they're computed — [`utils/levels.ts`](../../web/src/utils/levels.ts),
  [`utils/time.ts`](../../web/src/utils/time.ts), and the tick constants beside the strips and dials
  that draw them.
- **Strings keep the template's wording** unless they're marked "App-authored" or "Reworded by
  decision". New strings are minimal and in the same voice. A string with values in it is a
  function, as in `failureCopy["connection-error"].body(attempt, max)`.
- **`processingCopy.stages` doubles as the API's stage messages**, so change it together with the
  server; see [../api/contract-sync.md](../api/contract-sync.md).
- **Error text is shown as it arrives**, not rewritten: the server's, [`api/client.ts`](../../web/src/api/client.ts)'s,
  and the connection errors [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) records for the log.
- **Typography:** readouts use the real minus sign, U+2212 (`formatDb` and `formatSigned` in
  [`utils/levels.ts`](../../web/src/utils/levels.ts)), and text uses the ellipsis character `…`, not
  three dots.

## State

The model is [`design/player.ts`](../../web/src/design/player.ts): `StemState` and `PlayerState`,
held in one `useReducer` in `ResultsScreen`. What it doesn't model — load phase, speed, loop, chords,
lyrics, open dialogs — is ordinary state beside it.

- **Controls store UI positions, 0…1.** Decibels are derived, never stored.
  - `db()` spans 36 dB with the bottom silent, which puts the Console strip's 0 / −12 / −24 / −∞
    ticks at thirds of the travel.
  - `masterDb()` runs through the master strip's own ticks, 0 / −6 / −18 / −∞.
  - A different taper changes these functions only; every fader and knob keeps following `--v`.
- **`audible()` dims a waveform:** a stem is audible when it isn't muted and either nothing is
  soloed or it is.
- **A strip or module shows solo before mute:** soloed is `.is-active` and reads "Soloed" even when
  also muted; muted alone is `.is-off`. Mute still silences the audio.

## Responsive

One breakpoint, 720px. The results shell is fluid from about 360px, and 1120px is its widest.

- **Where the breakpoint is read:**
  - components use `PHONE_QUERY` from `design/layout.ts` through `useMediaQuery`;
  - `App`, `MixerView` and `AnalysisBar` use Tailwind's `max-[720px]:`;
  - `chord-theme.css` has its own `@media (max-width: 720px)`.
- **From 1024px** all three views are available, their rows filling the width.
- **Between 720 and 1024px** the same, with the Console and Analog rows scrolling at their floors
  (112px, 120px, and 180px for the dials).
- **Below 720px, results** lock to the Mixer, with no view tabs. The stylesheet stacks the
  `.ch-stemrow` rows with 44px MUTE/SOLO targets, the Mixer's column labels and the analysis bar's
  dividers are hidden, and the transport becomes `.ch-m-bar`: play, seek and the Click chip.
- **Below 720px, landing and processing** switch to their own phone arrangements on `PHONE_QUERY`.

## Accessibility

- **Faders and knobs** are `role="slider"` with `aria-valuemin`, `aria-valuemax` and
  `aria-valuenow`, an `aria-label` naming the stem and value, and `aria-valuetext`, with the keys in
  [Controls](#controls), handled by [`useSliderControl`](../../web/src/hooks/useSliderControl.ts). A
  slider without keys fails an accessibility audit.
- **MUTE and SOLO** are `<button>`s with `aria-pressed`; the class change is visual only.
- **View tabs** use `tablist`, `tab` and `aria-selected`, move with the arrow keys, and label their
  panel.
- **The focus ring** is Nocturne's `:focus-visible`; never remove it.
- **Size floors:** no text under 9px, no meter scale under 10px, 44px hit targets on phones.
- **Motion:** the playhead is the only animation, and under `prefers-reduced-motion` it steps once a
  second.
- **Pointer-only shortcuts**, like dragging the chord strip to seek, are `aria-hidden`; the
  transport's seek slider does the same job accessibly.

## Where the design is silent

Some states were never drawn: the dialogs behind Export stems, Open lyric sheet and Add lyrics
manually; the speed popover; a job that no longer exists; loading and empty states such as "Looking
for lyrics…". For those:

- **Compose existing classes** — Nocturne's `.dialog`, `.field` and `.input`; `.ch-panel`,
  `.ch-chip`, `.ch-stemrow` and `.ch-alert` — with layout-only inline styles or Tailwind layout
  utilities.
- **Reuse a panel before inventing a layout.** A job that no longer exists gets the failure panel,
  with one action.
- **Keep copy minimal and in the design's voice**, under an "App-authored" comment in `copy.ts`.

Don't add UI to a screen the design draws unless it's recorded [below](#recorded-decisions); what was
removed for that reason is in [../architecture/decisions.md](../architecture/decisions.md).

## The design check

`npm run lint` runs oxlint, then [`web/scripts/check-design.mjs`](../../web/scripts/check-design.mjs).

- **Why a separate script:** the template's design system shipped its adherence rules as ESLint
  `no-restricted-syntax` selectors, which oxlint doesn't implement. The script carries them and adds
  what the ground rules make checkable.
- **Where its vocabulary comes from:** it reads the tokens and classes from the two stylesheets, so
  it keeps up when they change.

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

The `ch-` prefix belongs to the stylesheet's classes, so ids never start with it.

- **How it scans:** string literals, not an AST, and every report names the file and line. A token
  name built at runtime, such as `var(--ch-${key})`, is reported too, since no check can vouch for
  it — write each token out, as `design/stems.ts` does for the stem hues.
- **What it can't see**, so review checks it:
  - inline geometry on a control;
  - a control without a label and a value;
  - markup that drifts from this page;
  - a string written outside `copy.ts`.

## Recorded decisions

Where the template's parts disagreed, or promised something the app doesn't do, these calls were
taken. *Template* is what the retired files said or drew.

| Where | Template | App | Why |
| --- | --- | --- | --- |
| Results below 720px | the harness drew a separate phone frame: stem cards, a compact header | the desktop screen reflowed, locked to the Mixer | the written guide asked for it, and its rules outranked the demo |
| A stacked stem row below 720px | the README: "name + dB on line one, fader on line two" | the name alone on line one, the dB beside its fader on line two | the guide's markup, the harness and the stylesheet all nest the value in `.ch-stemrow-level`; lifting it out would break the 150px level column on the web |
| Analog Tone and Pan knobs | a label, no value | the value under each label | every control carries a label and a value |
| A Mixer waveform while another stem is soloed | the harness dimmed a waveform only when its own stem was muted | dimmed whenever the stem isn't `audible()`, held stems included | the guide's markup |
| A soloed, muted strip or module | the guide gave `.is-active` to soloed and `.is-off` to muted, without saying which wins | solo wins in the display | the harness picked solo |
| `job-cancelled` body | "…The upload is still in your queue for 24 hours if you want to resume it." | "…The upload is kept until you leave this page if you want to resume it." | leaving the page discards a cancelled job; nothing is held for 24 hours |
| `connection-error` secondary action | "Work offline" | "New track" | the app has no offline mode |
| Sticky transport, upload progress bar, loop markers on the chord strip, speed chip on phones | not drawn | removed | the app had grown them; the design doesn't have them |
| Footer | none | kept: Nocturne icon buttons and a `.ch-hint` line | kept by decision |
| `db()` | linear, −12…0 dB | 36 dB span with the bottom silent; the master through its own ticks | the guide invited a different taper, and these match the strips' tick columns |
| Page ground | a radial gradient `#1d1f33` → `#161826` → `#121320` | the same gradient through `--ch-panel-raised`, `--color-bg` and `--ch-well` | the nearest tokens; two of the stops weren't tokens |

A new decision is recorded here and in [../architecture/decisions.md](../architecture/decisions.md) in
the same change.

## Checking a UI change

1. `cd web && npm run build && npm run lint`.
2. Walk every state in [Screens and their states](#screens-and-their-states) that the change touches,
   at a desktop width and under 720px, and compare before and after — screenshots are the cheapest
   diff.
3. Tab through the touched controls: arrows move them, the focus ring shows, and at 200% zoom nothing
   clips and strip rows scroll.
