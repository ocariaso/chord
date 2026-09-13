# CHORD UI template — integration guide

A drop-in UI layer for the existing CHORD app: one stylesheet, a fixed set of
component classes, and a demo harness that renders every screen and state the
current review demo covers, at web and mobile widths.

Nothing here owns application logic. The stylesheet and class contract are
framework-agnostic; the harness is a reference implementation of the markup.

---

## 1. Files

| File | What it is | Ship it? |
| --- | --- | --- |
| `template/chord-theme.css` | The component layer: every class below, all values from Nocturne tokens. | **Yes** |
| `_ds/nocturne-…/styles.css` | Nocturne token sheet + base components (`.btn`, `.tag`, `.input`, `.field`, `.card`). Must load **before** the theme. | **Yes** |
| `CHORD Template.dc.html` | Demo harness: scenario nav, hash routes, all screens, live faders/knobs/transport. | Reference only |
| `CHORD Mockups.dc.html` | The approved static mockup board (`1a`–`1l`) for visual diffing. | Reference only |

Load order, once, at app root:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/ds/nocturne/styles.css">
<link rel="stylesheet" href="/css/chord-theme.css">
```

No JS dependency, no build step, no Tailwind requirement. It coexists with the
current Tailwind build — the classes are all `ch-`-prefixed and set no globals
beyond `:root` custom properties.

---

## 2. The runtime-value contract

Components take state as **CSS custom properties**, not inline geometry. This is
the whole integration surface for anything animated or dragged:

| Variable | Range | Applies to | Meaning |
| --- | --- | --- | --- |
| `--v` | 0…1 | `.ch-fader`, `.ch-vfader`, `.ch-knob`, `.ch-progress` | Control position (gain, progress) |
| `--l` | 0…1 | `.ch-meter i` | Meter level, post-fader |
| `--p` | 0…1 | `.ch-playhead`, `.ch-seek` | Playback position |
| `--stem` | color | any stem scope | Stem hue; set once on the row/strip, inherited by dot, fader fill, meter, waveform, knob arc |

```jsx
<div className="ch-stemrow" style={{ "--stem": "var(--ch-bass)" }}>
  <span className="ch-stemrow-name"><span className="ch-dot" />Bass</span>
  <span className="ch-stemrow-level">
    <span className="ch-fader ch-fader-thin" style={{ "--v": gain }} role="slider" />
    <span className="ch-value-sm">{fmtDb(gain)}</span>
  </span>
  …
</div>
```

Stem hues: `--ch-vocals` (the accent), `--ch-drums`, `--ch-bass`, `--ch-guitar`,
`--ch-piano`, `--ch-other`. They map 1:1 onto the API's `stem_names`.

---

## 3. Component reference

**Shell** — `.ch-app`, `.ch-topbar`, `.ch-section`, `.ch-panel` (+`.is-active`
for soloed, `.is-off` for muted), `.ch-divider-x` / `.ch-divider-y` (Nocturne's
fade-to-transparent rules).

**Type** — `.ch-label` (all-caps micro label; every control has one),
`.ch-value` / `.ch-value-sm` (tabular numerics), `.ch-hint`, `.ch-title`,
`.ch-subtitle`.

**Controls**
- `.ch-fader` (+`.ch-fader-thin`) — horizontal gain. Pair with `.ch-scale` for
  the −∞ / −12 / 0 / +6 ruler.
- `.ch-vfader` — vertical console fader; needs one `<span>` child (the cap).
- `.ch-knob` (+`.ch-knob-sm`) — analog knob; needs one `<span>` child (the cap
  and pointer are drawn by CSS). Sweep is 280°, centred at 220°.
- `.ch-meter` with `<i>` children — one `<i>` per channel, `--l` each.
  `.ch-ticks` is its dB scale.
- `.ch-toggle` (+`.is-on` for solo, `.is-on-muted` for mute) — text buttons.
  Never a bare LED: the label is the control.
- `.ch-chip` (+`.is-on`) — transport chips (speed, loop, metronome).
- `.ch-tabs` / `.ch-tab[aria-selected]` — the Mixer / Console / Analog switch.

**Content**
- `.ch-stemrow` + `.ch-stemrow-name` / `-level` / `-routing` — the mixer row.
- `.ch-wave` + `.ch-wave-a|b|c` — waveform. The clip-path envelopes are
  placeholders: generate a `polygon()` from your peaks array (top edge left→
  right, then bottom edge right→left) or swap in a `<canvas>` of the same box.
- `.ch-chordstrip`, `.ch-chord` (+`.is-current`, `.is-past`), `.ch-playhead`,
  `.ch-chord-now`, `.ch-chord-next`, `.ch-lyric`.
- `.ch-progress`, `.ch-stage` (+`.is-done`, `.is-current`), `.ch-stage-mark`.
- `.ch-dropzone` (+`.is-over`, `.is-rejected`), `.ch-dropicon`.
- `.ch-alert`, `.ch-alert-head`, `.ch-alert-body`, `.ch-log`.
- `.ch-transport`, `.ch-play`, `.ch-time`, `.ch-seek`.
- Mobile: `.ch-m-stem`, `.ch-m-bar`.
- Harness chrome only (do not ship): `.ch-nav`, `.ch-nav-group`, `.ch-nav-head`,
  `.ch-nav-item`.

---

## 4. Screen and state map

The harness routes on `#/<scenario-id>`; the ids are the current demo's ids, so
existing deep links keep working.

| Scenario id | API state it renders | Screen |
| --- | --- | --- |
| `upload` | idle | Landing + dropzone |
| `upload-submitting` | POST in flight | Landing, submit button busy |
| `upload-error` | client-side reject (extension / empty file) | Landing + `.ch-alert` |
| `processing-queued` | `status: queued`, `progress: 0` | Processing |
| `processing-fetching` | `status: fetching`, `stage_message: "Downloading audio"` | Processing |
| `processing-separating` | `status: separating`, `stage_message: "Separating stems"` | Processing |
| `processing-tempo` | `status: separating`, `stage_message: "Detecting tempo"` | Processing |
| `processing-analyzing` | `status: analyzing`, `stage_message: "Detecting chords and key"` | Processing |
| `processing-loading` | `status: done`, stems decoding client-side | Processing at 100% |
| `processing-long-title` | long `original_filename` | Truncation check |
| `results-mixer` | `status: done` | Results, Mixer |
| `results-console` | `status: done` | Results, Console |
| `results-analog` | `status: done` | Results, Analog |
| `results-instrumental` | silent vocals stem | Results, stem marked Silent |
| `results-plain-lyrics` | lyrics without timing | Results, lyric row → sheet link |
| `results-no-lyrics` | no lyrics | Results, lyric row collapses |
| `job-error` | `status: error` + `error_message` | Failure |
| `job-cancelled` | `status: cancelled` | Failure |
| `connection-error` | poll failure (502) | Failure |
| `results-load-error` | stem fetch failure | Failure |

Stage list order is fixed: Queued → Downloading audio → Separating stems →
Detecting tempo → Detecting chords and key. Map `status` + `stage_message` to an
index; steps before it get `.is-done`, the index gets `.is-current`.

Fields consumed: `original_filename`, `author`, `status`, `progress`,
`stage_message`, `error_message`, `duration_seconds`, `key_estimate`,
`key_confidence`, `tempo_bpm`, `stem_names`, `has_thumbnail`.

---

## 5. What changed from the old demo, and why

- **Every knob and button is labelled.** Each control carries a `.ch-label`
  name and a live numeric value (dB, semitones, BPM, pan). The old unlabelled
  chrome knob, dead "Tone" knob and single-letter M/S LEDs are gone; MUTE and
  SOLO are text buttons with `aria-pressed`.
- **Skeuomorphism dropped, instrumentation kept.** No wood, chrome plates,
  screws or LED-segment fonts. Three views instead of Simple/Studio: Mixer
  (default), Console (faders + metering), Analog (knobs + needle VUs). All three
  use the full width and the same data.
- **One type system.** Inter throughout, tabular numerics for every readout;
  the five display fonts (Orbitron, Oswald, Rock Salt, Dancing Script, Share
  Tech Mono) are no longer needed — you can drop those font requests.
- **Contrast and size floors.** No text below 9px, no meter scale below 10px,
  44px minimum hit targets on mobile, `:focus-visible` accent ring on every
  control.

---

## 6. Responsive behaviour

The results screens are fluid; they hold together from ~360px up. Breakpoints
live in the stylesheet, not in JS:

- `≤720px`: `.ch-stemrow` stacks — name + dB on line one, fader on line two,
  MUTE/SOLO at 44px on line three, waveform last.
- Console view: `.ch-striprow` scrolls horizontally and `.ch-strip` holds a
  112px floor, so strips never collapse under their own controls. Use the Mixer
  view as the mobile default.
- Analog view: `.ch-module` holds a 120px floor inside the same scrolling row;
  fall back to Mixer under 720px.
- **Mobile is locked to the Mixer view.** Don't render the view tabs below
  720px — Console and Analog both need the width, and the harness forces
  `view: "mixer"` whenever the canvas is mobile.
- `.ch-topbar` wraps and `.ch-topbar-title` keeps a 180px floor, so the action
  cluster drops to a second line instead of truncating the track name.

---

## 7. Integration order (suggested)

1. Load the two stylesheets; confirm `.btn`, `.input` and `.tag` render.
2. Replace the results stem list with `.ch-stemrow` markup bound to your
   existing gain/mute/solo state. Nothing else needs to move yet.
3. Replace the processing screen with `.ch-progress` + `.ch-stage` driven by
   `status` / `stage_message`.
4. Swap the landing dropzone and the four failure panels.
5. Add the view tabs and the Console / Analog views last — they are the same
   stem state rendered differently, so they need no new API data.
