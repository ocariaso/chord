# Studio view

A skeuomorphic rack of guitar amps inside a walnut-and-brass cabinet, where each stem is a
different piece of gear. Functionally equivalent to the [Simple view](simple-view.md) — same
engine, same state, same callbacks — with entirely different chrome.

Everything lives in [`web/src/components/studio/`](../../web/src/components/studio/).

## Composition

```
StemMixer  (viewMode === "studio")
 └─ StudioCabinet            walnut shell, brass rails, leather posts, brass rivets
     └─ StudioMixer          layout + closeup state
         ├─ ScaleToFit
         │   └─ MasterUnit   sticky header: LCD chords, transport, transpose, gain, view LEDs
         └─ grid (2 cols desktop / 1 col mobile)
             └─ ScaleToFit
                 └─ VocalsAmp | GuitarAmp | BassAmp | PianoAmp | DrumsAmp | OtherAmp
         ├─ AmpCloseup       ─┐ rendered on tap, via ZoomOverlay
         └─ MasterCloseup    ─┘
```

Stem order is `STEM_ORDER = ["vocals", "guitar", "bass", "drums", "piano", "other"]` from
[`ampComponents.ts`](../../web/src/components/studio/ampComponents.ts) — note it differs from
the Simple view's order (drums and piano are swapped). The same filter-then-append logic keeps
unknown stems visible.

`AMP_COMPONENTS` maps stem name → component, with `OtherAmp` as the fallback:

```ts
const Amp = AMP_COMPONENTS[name] ?? OtherAmp;
```

So a Demucs model producing a stem CHORD doesn't have a design for still renders a working
channel.

## Why six bespoke amps

Each amp is a separate component with its own palette, cabinet texture, knob style, icon and
LED color — see
[the decision](../architecture/decisions.md#amps-are-bespoke-not-configured). They share only:

- `AmpProps` from [`types.ts`](../../web/src/components/studio/types.ts),
- the width constants `AMP_WIDTH` / `AMP_MOBILE_WIDTH`,
- and four hooks: `useStemWaveform`, `useSeekDrag`, `useKnobDrag`, `useDownload`.

Every amp's body is the same six lines of logic:

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const { isDownloading, download } = useDownload(downloadHref, `${name}.wav`);
const seekDrag = useSeekDrag(duration, onSeek);
useStemWaveform(containerRef, name, buffer, downloadHref,
                waveColor, progressColor, height, onWaveSurferReady);
```

…followed by a large amount of purely presentational JSX. The duplication is the feature; a
shared "amp shell" would collapse the visual identities into one.

`AmpProps` carries two flags worth understanding:

- **`controlsOnly`** — render just the control row and waveform, skipping the decorative shell.
  Used by the closeup overlay, and by the grid on mobile (`controlsOnly={isMobile}`), where the
  ornamental cabinet would eat the whole screen.
- **`isMobile`** — selects `AMP_MOBILE_WIDTH` (340) instead of `AMP_WIDTH` (480). Deliberately
  *not* implied by `controlsOnly`: the closeup passes `controlsOnly` but wants the full desktop
  width, because `ZoomOverlay` does its own fit-to-viewport scaling. The distinction is
  documented in the interface's doc comments.
- **`lyricLine`** — only ever passed to the vocals amp
  (`lyricLine={name === "vocals" ? lyricLine : undefined}`).

## `MasterUnit`

[`MasterUnit.tsx`](../../web/src/components/studio/MasterUnit.tsx) (~483 lines) is the Studio
view's control surface, and the Studio counterpart to `ChordTimeline` + `TransportBar` combined:

- **LCD chord display** — active chord in Orbitron 28px with a green text-shadow glow
  (`#4ade80`), upcoming five stepped through the hardcoded `UPCOMING_COLORS` green ramp.
- **Title plate** — thumbnail background with a dark gradient scrim, marquee title, and the
  `author · key · BPM` subtitle. Uses the same measure-then-animate marquee as the Simple view,
  minus the `ResizeObserver` (it re-measures on `title` only).
- **Transport** — play/pause, elapsed/total via `formatTime`, and a seek bar driven by
  `useSeekDrag`.
- **`GainRing`** — a local component: master volume as a knob wrapped in a `LevelRing`.
- **Transpose**, **metronome**, **download all**, **upload another**.
- **View-mode LEDs** — two small lamps labeled Simple and Studio; the active one glows (the
  Simple lamp in `accentColor`, the Studio lamp in the LCD green).

It renders sticky at the top of the scroll area, on a background matching the cabinet interior
so it occludes cleanly:

```tsx
<div className="sticky top-0 z-10 w-full pb-1"
     style={{ backgroundColor: CABINET_INTERIOR_COLOR, backgroundImage: CABINET_INTERIOR_IMAGE }}>
```

Its props are assembled once in `StudioMixer` as `masterProps` and spread into both `MasterUnit`
and `MasterCloseup`, so the closeup cannot drift from the header.

## Knobs

Three related pieces, all SVG in a `56×56` viewBox centered at `(28, 28)`:

| File | Role |
| --- | --- |
| [`useKnobDrag.ts`](../../web/src/components/studio/useKnobDrag.ts) | the interaction |
| [`Knob.tsx`](../../web/src/components/studio/Knob.tsx) | the general knob, configurable |
| [`ScallopedKnob.tsx`](../../web/src/components/studio/ScallopedKnob.tsx) | Bass's two-layer chrome knob only |
| [`LevelRing.tsx`](../../web/src/components/studio/LevelRing.tsx) | the green→amber→red arc |

`useKnobDrag` is vertical-drag-to-adjust with pointer capture:

```ts
const delta = (dragRef.current.startY - e.clientY) / sensitivity;   // sensitivity = 200
const next = Math.max(0, Math.min(1, dragRef.current.startValue + delta));
```

Dragging up increases. `setPointerCapture` means the drag keeps tracking after the pointer
leaves the small SVG — essential for a 26px target. Values are always `0…1`, matching the gain
range.

`valueToRotation(value)` maps that to `-135 + value * 270` — the 270° sweep a real potentiometer
travels, so the pointer line's angle reads like hardware.

`LevelRing` draws the arc with a `strokeDasharray` trick: the visible portion is
`value * RING_SWEEP` where `RING_SWEEP` is 270/360 of the circumference, rotated by `126°` so
the gap sits at the bottom.

`ScallopedKnob` exists purely so Bass's identity isn't reused — its own doc comment says so.

`.touch-none` on the knob and waveform elements is load-bearing beyond scroll prevention: both
click handlers check `target.closest("button, .touch-none")` and bail, so dragging a knob or
scrubbing a waveform doesn't also open the closeup overlay.

## Tap to zoom

Clicking an amp (or Master) anywhere that isn't a control opens a magnified copy.

```tsx
function handleAmpClick(e, name) {
  const target = e.target as HTMLElement;
  if (target.closest("button, .touch-none")) return;      // a control, not the shell
  setCloseup({ name, rect: e.currentTarget.getBoundingClientRect() });
}
```

The captured `DOMRect` is where the overlay animates *from* and back *to*.

[`ZoomOverlay.tsx`](../../web/src/components/studio/ZoomOverlay.tsx) does a FLIP-style
transition entirely in imperative DOM style writes:

1. In `useLayoutEffect`, clear any transform and measure the card's own natural rect.
2. Compute the settled scale as
   `min(maxZoomScale, innerWidth * 0.9 / natural.width, innerHeight * 0.9 / natural.height)` —
   so the target 200% is capped by whatever actually fits.
3. Set the starting transform to `transformBetween(naturalRect, originRect)` — a translate+scale
   that maps the card exactly onto the clicked element's box — with `opacity: 0`.
4. Force a reflow (`void card.getBoundingClientRect()`) so the browser commits that start state,
   then in a `requestAnimationFrame` set the transition and the resting transform.
5. Closing reverses the same transform, then calls `onClose` after `TRANSITION_MS` (280ms).

The reflow-then-rAF dance is the crux: without it the browser coalesces both style writes and
there's nothing to animate from.

[`AmpCloseup`](../../web/src/components/studio/AmpCloseup.tsx) renders **the exact same amp
component**, with `controlsOnly`, so the zoomed controls are real and live rather than a picture.
Its one adaptation: the closeup's WaveSurfer instance is not registered in `waveSurfersRef`, so
it can't be driven by the shared tick loop and instead follows the `currentTime` prop:

```tsx
useEffect(() => { waveSurferRef.current?.setTime(currentTime); }, [currentTime]);
```

[`MasterCloseup`](../../web/src/components/studio/MasterCloseup.tsx) is the same idea in twelve
lines, spreading `masterProps` into a second `MasterUnit`.

## Fixed geometry and `ScaleToFit`

The Studio view is drawn at fixed pixel widths, from
[`constants.ts`](../../web/src/components/studio/constants.ts):

```ts
AMP_WIDTH = 480
GRID_GAP  = 24
MASTER_WIDTH = AMP_WIDTH * 2 + GRID_GAP            // 984 — Master spans both columns
CABINET_WIDTH = MASTER_WIDTH + bezel*2 + gap*2 + post*2 + paddingX*2
```

`CABINET_WIDTH` is *derived* from all the chrome dimensions, so changing a post width or bezel
padding keeps the cabinet exactly wrapping the grid. Mobile gets its own slimmer chrome
constants (`CABINET_POST_WIDTH_MOBILE`, etc.) because the desktop chrome would consume most of
a phone's width.

[`ScaleToFit`](../../web/src/components/studio/ScaleToFit.tsx) handles the rest: measure the
child's natural `offsetWidth` (unaffected by transforms), compute
`min(1, available / natural)`, apply `transform: scale()`, and size the wrapper to the scaled
dimensions so surrounding layout stays correct. It never scales **up**, so desktop is a no-op.

Two widths plus scaling gives three tiers: desktop renders at native size; a phone renders at
the 340px mobile design width; a very narrow phone additionally scales that down.

`ResizeObserver` watches both the outer and inner elements, so the scale recomputes on viewport
change and on any content reflow.

## The cabinet

[`StudioCabinet.tsx`](../../web/src/components/studio/StudioCabinet.tsx) is pure decoration —
four gradient constants (`WALNUT`, `BRASS`, `LEATHER`, `RIVET`), two brass rails with a
"CHORD Rig Cabinet" plate in Oswald, two leather posts holding brass rivets, and a velvet
interior (`CABINET_INTERIOR_COLOR` / `CABINET_INTERIOR_IMAGE`) shared with `StudioMixer`'s
sticky header.

It takes only `children` and `isMobile`, and knows nothing about audio.

## Fonts

The Studio look depends on the Google Fonts loaded in
[`index.html`](../../web/index.html) — **Oswald** for labels and plates, **Orbitron** for the
LCD, plus Share Tech Mono, Rock Salt and Dancing Script used by individual amps. They're
referenced as `font-['Oswald']` or inline `fontFamily`. If the fonts fail to load, the view
falls back to system sans and loses much of its character.
