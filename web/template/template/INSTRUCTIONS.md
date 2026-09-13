# CHORD UI — implementation instructions

Audience: the engineers (or coding agent) wiring this template into the
existing CHORD app. Read `README.md` first for the class inventory; this file
covers *how* to land it, in what order, and what to watch for.

Estimated effort: 1–2 days for the results screens, half a day for
landing/processing/failure, assuming the app already has gain/mute/solo state.

---

## 0. Ground rules

1. **The stylesheet is the source of truth.** Do not re-derive colors, spacing
   or radii in JS or in component-local CSS. If a value is missing, add a token
   to Nocturne, not a hex to a component.
2. **Runtime state goes in via CSS custom properties** (`--v`, `--l`, `--p`,
   `--stem`). Never set `width`, `left`, `transform` or `background` inline for
   a control — the class already maps the variable to the right property.
3. **Every control carries a visible label and a numeric value.** This is the
   whole point of the redesign. If you add a control, it gets a `.ch-label` and
   a `.ch-value`, or it does not ship.
4. **No new fonts, no skeuomorphic textures.** Inter only. Orbitron, Oswald,
   Rock Salt, Dancing Script and Share Tech Mono can be removed from
   `index.html` — nothing in the template requests them.
5. **Keep the existing scenario ids and hash routes** (`#/results-mixer` etc.)
   so existing review links keep working.

---

## 1. Install

```bash
cp template/chord-theme.css        src/styles/chord-theme.css
cp template/vendor/nocturne-styles.css src/styles/nocturne.css   # or point at your DS package
```

In the app shell, in this order:

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/styles/nocturne.css">   <!-- tokens + .btn/.input/.tag -->
<link rel="stylesheet" href="/styles/chord-theme.css"><!-- ch-* components -->
```

Order matters: `chord-theme.css` reads `var(--color-*)`, `var(--space-*)`,
`var(--radius-*)` from the Nocturne sheet and defines its own `--ch-*` on
`:root`.

Coexistence with Tailwind is fine — every class is `ch-`-prefixed and the sheet
sets no element-level rules except inside its own components. If your Tailwind
preflight resets `button`/`input`, load `chord-theme.css` **after** it.

---

## 2. File map

```
template/
├── chord-theme.css         ← ship this
├── README.md               ← class inventory + state map
├── INSTRUCTIONS.md         ← this file
├── vendor/
│   └── nocturne-styles.css ← the token sheet (or use your own DS build)
└── reference/
    ├── CHORD Template.dc.html   ← working harness, all 21 scenarios
    ├── CHORD Mockups.dc.html    ← approved static board (1a–1l)
    └── support.js               ← runtime the two reference files need
```

Open either reference file directly in a browser (they need `support.js` beside
them and the `_ds` stylesheet path adjusted) to compare against your build.
Neither file ships.

---

## 3. State model

The template needs exactly this much state. Anything else is yours.

```ts
type StemKey = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

interface StemState {
  key: StemKey;
  gain: number;        // 0..1, UI position (NOT dB)
  muted: boolean;
  solo: boolean;
  tone?: number;       // 0..1, optional shelf
  pan?: number;        // 0..1, 0.5 = centre
}

interface PlayerState {
  view: "mixer" | "console" | "analog";
  playing: boolean;
  time: number;        // seconds
  duration: number;    // seconds
  master: number;      // 0..1
  transpose: number;   // -11..11 semitones
  metronome: boolean;
  stems: StemState[];
}
```

Derived, never stored:

```ts
const db = (v: number) => -(1 - v) * 12;                  // UI position → dB
const fmtDb = (v: number, muted: boolean) =>
  muted ? "−∞" : `${db(v) < 0 ? "−" : ""}${Math.abs(db(v)).toFixed(1)}`;
const audible = (s: StemState, any: boolean) => !s.muted && (!any || s.solo);
```

Use the real minus sign `−` (U+2212) in readouts, not a hyphen — it aligns with
tabular numerals.

**Gain curve:** the linear 0…1 → −12…0 dB mapping above is the demo's. If your
audio graph uses a different taper, change `db()` only; the visual position of
every fader and knob follows `--v` unchanged.

---

## 4. Components, wired

### 4.1 Stem row (Mixer view)

```jsx
<div className="ch-stemrow" style={{ "--stem": `var(--ch-${s.key})` }}>
  <span className="ch-stemrow-name">
    <span className="ch-dot" />
    {NAMES[s.key]}
  </span>
  <span className="ch-stemrow-level">
    <div
      className="ch-fader ch-fader-thin"
      style={{ "--v": s.gain }}
      role="slider"
      tabIndex={0}
      aria-label={`${NAMES[s.key]} level, ${fmtDb(s.gain, s.muted)} decibels`}
      aria-valuemin={0} aria-valuemax={1} aria-valuenow={s.gain}
      onPointerDown={startDrag(s.key)}
      onKeyDown={arrowKeys(s.key)}
    />
    <span className="ch-value-sm" style={{ width: 38, textAlign: "right" }}>
      {fmtDb(s.gain, s.muted)}
    </span>
  </span>
  <span className="ch-stemrow-routing">
    <button className={`ch-toggle ${s.muted ? "is-on-muted" : ""}`}
            aria-pressed={s.muted} onClick={() => toggleMute(s.key)}>MUTE</button>
    <button className={`ch-toggle ${s.solo ? "is-on" : ""}`}
            aria-pressed={s.solo} onClick={() => toggleSolo(s.key)}>SOLO</button>
  </span>
  <span className={`ch-wave ch-wave-a ${audible(s, anySolo) ? "" : "is-off"}`} />
</div>
```

Drag handler (works for mouse, pen and touch — no library):

```js
const startDrag = key => e => {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const apply = ev => {
    const r = el.getBoundingClientRect();
    setGain(key, Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
  };
  apply(e);
  const move = ev => apply(ev);
  const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
};
```

Keyboard: ±0.01 on Arrow, ±0.1 on Shift+Arrow, 0/1 on Home/End. Required —
`role="slider"` without key handling fails audit.

### 4.2 Console strip

Row must be `.ch-striprow` (scrolls, no collapse); each strip is
`.ch-panel.ch-strip` with `--stem` set, `.is-active` when soloed, `.is-off`
when muted. Inside: `.ch-vfader` (one `<span>` child = the cap), `.ch-meter`
with one `<i>` per channel, `.ch-ticks` for the dB scale, then Level / Pan
rows and the MUTE/SOLO pair. Vertical drag is the same handler with
`(r.bottom - ev.clientY) / r.height`.

### 4.3 Analog knob

`.ch-knob` with one `<span>` child; the cap, pointer and value arc are all CSS.
Sweep is 280° starting at 220°, so `--v: 0` points lower-left and `--v: 1`
lower-right. Drag vertically: `v0 + (startY - ev.clientY) / 160` — never use
rotational drag, it is unusable with a mouse.

`.ch-knob-sm` is the 34px Tone/Pan variant; give it
`--stem: var(--color-neutral-700)` so only the Level knob carries stem color.

### 4.4 Output meters (Analog view)

Five SVG dials in a grid: `repeat(5, minmax(180px, 1fr))` with
`overflow-x: auto`. Each dial is authored on a `0 0 200 140` viewBox, needle
rotated about `(100, 108)` via a `transform="rotate(deg 100 108)"` string.
Value → degrees: `deg = v * 140 - 70`.

The 180px floor is load-bearing: below it the in-SVG type falls under 9px.
If you need them narrower, drop to three dials rather than shrinking five.

Meters are the one place to bypass React. Drive them from the audio thread:

```js
const raf = () => {
  meterEl.style.setProperty("--l", String(analyser.level()));
  needleEl.setAttribute("transform", `rotate(${v * 140 - 70} 100 108)`);
  requestAnimationFrame(raf);
};
```

Writing a custom property is cheap; a React re-render at 60fps is not.

### 4.5 Chord strip

One `.ch-chord` per segment with `flex: <duration>`, `.is-current` on the
segment containing `time`, `.is-past` before it. `.ch-playhead` takes
`--p: time / duration`. Click-to-seek on the strip container. Transpose with:

```js
const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const shift = (chord, semis) => chord.replace(/^([A-G]#?)/, root =>
  NOTES[(NOTES.indexOf(root) + semis + 120) % 12]);
```

Apply the same shift to `key_estimate`. Never mutate the stored analysis —
transpose is a display transform.

### 4.6 Processing

`.ch-progress` takes `--v: progress`. The stage list is fixed and ordered:
Queued → Downloading audio → Separating stems → Detecting tempo → Detecting
chords and key. Map `status` + `stage_message` to an index; earlier steps get
`.is-done`, the index gets `.is-current`, later steps get nothing. If a job
skips a stage (an uploaded file never fetches), mark it done, don't hide it —
the list is a fixed contract so the layout never jumps.

### 4.7 Failure states

All four are `.ch-alert` + optional `.ch-log`, with a primary and a secondary
action. The dot color is the only status hue used: `--ch-danger` for hard
failures, `--ch-warn` for recoverable ones, neutral for cancelled. Never tint
the whole panel.

---

## 5. Responsive rules

| Width | Behaviour |
| --- | --- |
| ≥1024px | All three views available; console/analog strips fill the width. |
| 720–1024px | Same, strip rows scroll horizontally at their floors (112 / 120 / 180px). |
| <720px | **Lock to Mixer.** Do not render the view tabs. `.ch-stemrow` stacks automatically; MUTE/SOLO become 44px targets. |

The results shell is fluid — no fixed widths anywhere. If you wrap it in a
max-width container, 1120px matches the harness.

---

## 6. Accessibility checklist

- Every fader/knob: `role="slider"`, `aria-valuemin/max/now`, `aria-label`
  including the stem name and current value, arrow-key support.
- MUTE/SOLO: real `<button>` with `aria-pressed`. The class change is visual
  only; screen readers read the pressed state.
- View tabs: `role="tablist"` / `role="tab"` + `aria-selected`.
- Focus: never remove the `:focus-visible` ring — it is defined once in the
  Nocturne sheet and inherited by every `ch-` control.
- Contrast floors already met by the tokens: body copy uses
  `--color-neutral-300/400`, never the accent at paragraph size.
- Motion: the only animation is the playhead. Respect
  `prefers-reduced-motion` by stepping it per second instead of per frame.

---

## 7. Migration order (ship in slices)

1. **Stylesheets in, nothing else.** Confirm `.btn`, `.input`, `.tag` render
   and no existing screen regresses.
2. **Stem list → `.ch-stemrow`.** Bind to existing gain/mute/solo. Ship it;
   this is 80% of the perceived redesign.
3. **Processing screen.** `.ch-progress` + `.ch-stage` from `status` /
   `stage_message`.
4. **Landing + failure states.** Dropzone and the four alert panels.
5. **Analysis bar** (key / transpose / tempo / master) above the stem list —
   it is shared by all three views, render it once outside the view switch.
6. **View tabs + Console.** Same state, different layout; no new API data.
7. **Analog view + output meters.** Last, because it wants real metering data.

Each slice is independently shippable and reversible.

---

## 8. Pitfalls

- **Don't** put `flex: 1; min-width: 0` on console strips or analog modules —
  they collapse under their own controls. Use `.ch-strip` / `.ch-module`,
  which carry the floors.
- **Don't** let the results header be `nowrap`; `.ch-topbar` wraps and
  `.ch-topbar-title` keeps a 180px floor so long filenames truncate gracefully
  instead of squeezing the title to nothing.
- **Don't** render the analysis bar per view — it duplicates and drifts.
- **Don't** animate `width`/`left` on faders; animate the custom property or
  nothing. The browser does not interpolate `--v` by default, which is correct
  here (controls should track the pointer exactly).
- **Don't** ship the placeholder waveform envelopes. `.ch-wave-a|b|c` are
  clip-path stand-ins; generate a `polygon()` from your peaks array (top edge
  left→right, then bottom edge right→left) or replace the element with a
  `<canvas>` of the same box. Keep `--stem` either way.
- **Don't** reuse `.ch-nav*` — that is harness chrome, not product UI.

---

## 9. QA checklist

Walk all 21 scenarios in the harness and diff against your build:

- [ ] Landing: idle, submitting, rejected file
- [ ] Processing: queued, downloading, separating, tempo, chords, loading stems, long filename
- [ ] Results Mixer: default, instrumental (silent vocals), lyrics not synced, no lyrics, long filename
- [ ] Results Console: six strips, soloed strip lifts, muted strip dims, master strip
- [ ] Results Analog: five dials on one line, labelled knobs, values under each
- [ ] Failure: pipeline failed (+log), cancelled, connection lost, stems failed to load
- [ ] Mobile ≤720px: mixer only, tabs hidden, 44px targets
- [ ] Keyboard: tab through every control, arrows move faders, focus ring visible
- [ ] Zoom to 200%: nothing clips, strip rows scroll

---

## 10. If you are a coding agent

- Build against `template/reference/CHORD Template.dc.html` — read its markup
  for the exact class nesting, then write idiomatic components in the host
  framework. Do not port the reference file itself.
- Do not invent classes. If something is missing, the answer is a composition
  of existing ones plus layout-only inline styles (flex/grid/gap).
- Do not add color. The palette is six stem hues, two status hues and the
  Nocturne ramps.
- Preserve the exact copy strings for stage messages and error text — they are
  matched against the existing API and referenced in tests.
- After each slice, run the QA checklist section for that slice only.
