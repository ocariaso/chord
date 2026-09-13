# Results views

What a finished job renders: a shell of topbar, analysis bar, chord bar and transport around one
of three views — **Mixer**, **Console** and **Analog** — all drawn from the same state.
[`App.tsx`](../../web/src/App.tsx) renders
[`ResultsScreen`](../../web/src/screens/results/ResultsScreen.tsx) for any job whose status is
`done`; the loading and failure phases before this screen are covered in
[stem separation](stem-separation.md#client-side). The screen renders the results states in
[Screens and their states](../conventions/design.md#screens-and-their-states); the standard is
[../conventions/design.md](../conventions/design.md).

## Composition

```
ResultsScreen                 the engine, PlayerState, and what the state model leaves to the app
 ├─ ScreenCard (.ch-app)
 │   ├─ ResultsTopbar         cover, title, meta, Mixer/Console/Analog tabs, Export stems, New track
 │   ├─ AnalysisBar           key + confidence, transpose, tempo, master level
 │   ├─ ChordBar              current and next chords, chord strip, lyric row
 │   ├─ view panel            MixerView (StemRow) | ConsoleView (ConsoleStrip, MasterStrip)
 │   │                          | AnalogView (OutputDial, AnalogModule)
 │   └─ Transport             play, time, seek, speed, loop, metronome — play, seek and Click below 720px
 ├─ ExportDialog              outside the card
 └─ LyricsDialog
```

The analysis bar, chord bar and transport render **once, outside the view switch**, at every
width. The design template named
the failure this avoids: an analysis bar rendered per view duplicates and drifts. Below 720px the
same shell reflows; see [below 720px](#below-720px).

## One state, three renderings

[`ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) holds everything; the views
are stateless apart from their meter refs. The design's state model — [State](../conventions/design.md#state), typed as
`PlayerState` in [`design/player.ts`](../../web/src/design/player.ts) — lives in a `useReducer` over
[`playerReducer.ts`](../../web/src/screens/results/playerReducer.ts):

| `PlayerState` | Holds |
| --- | --- |
| `stems` | one `StemState` per loaded stem: `{key, gain, muted, solo, tone, pan}`, with gain, tone and pan as 0…1 control positions |
| `master` | 0…1, shared by the analysis bar's fader and the Console master strip |
| `view` | `"mixer"`, `"console"` or `"analog"` |
| `transpose`, `metronome` | the global controls the state model knows about |
| `playing`, `time`, `duration` | transport display, polled from the engine |

What the state model leaves to the app sits beside the reducer in `useState`:

| State | Holds |
| --- | --- |
| `phase`, `failures`, `isRetrying` | loading, failed or ready; see [stem separation](stem-separation.md#client-side) |
| `envelopes` | one waveform `polygon()` per loaded stem |
| `speed`, `supportsSpeed`, `loop` | the practice controls |
| `chordSegments`, `lyrics`, `hasVocals` | analysis results |
| `exportOpen`, `lyricsDialog` | which dialog is open |

Every change to `PlayerState` is one of eight reducer actions. An action that changes nothing
returns the state it was given, so the frame loop's time update renders nothing while playback is
paused, and `stemsLoaded` after a retry keeps the settings of the stems already on the mixer.

Each render derives a `StemDisplay[]` — the `StemState`, its name, its `--stem` hue, `audible` (the
design's `audible()`), `silent` and the waveform envelope — and passes it with a `StemControls`
object of five callbacks. Every callback writes the
[`PlaybackEngine`](../../web/src/audio/playbackEngine.ts) and dispatches **in the same handler** —
`onGainChange` calls `setVolume(key, dbToGain(db(gain)))` and then dispatches `stemChanged` — so the
engine stays the only audio truth and the state only mirrors it for display. Views never touch the
engine except through `readMeters` (see [metering](metering.md)).

Nothing is persisted: the view, mix, transpose, speed and loop all reset when you leave the job.

### Shared control behavior

Every fader and knob is a `role="slider"` element driven by
[`useSliderControl`](../../web/src/hooks/useSliderControl.ts):

| Input | Effect |
| --- | --- |
| pointer, horizontal fader | position from x across the track |
| pointer, vertical fader | `(bottom − y) / height` |
| pointer, knob | vertical drag, 160 px for the full range (rotational drag is unusable with a mouse) |
| Arrow keys | ±0.01, or ±0.1 with Shift |
| PageUp / PageDown | ±0.1 |
| Home / End | 0 / 1 |

That is the keyboard spec in [Controls](../conventions/design.md#controls), and nothing else: there is no
double-click reset. End puts a level or the master back at 0.0 dB, but no key centres Tone or Pan.

The level law lives in [`design/player.ts`](../../web/src/design/player.ts), under the name the
template gave it: `db()` maps a stem control's position linearly onto −36…0 dB, and `masterDb()` takes the
master fader through −36, −18, −6 and 0 dB at each third of its travel, to match the master strip's
ticks; position 0 is silent on both. Readouts use a real minus sign (U+2212) so they sit on the
tabular-numeral grid, and a muted stem reads `−∞` whatever its fader says (`fmtDb`).

## The shell

### Topbar

[`ResultsTopbar.tsx`](../../web/src/screens/results/ResultsTopbar.tsx), a `.ch-topbar` that wraps,
so on a narrow window the actions drop to a second line rather than squeezing the title:

- [`CoverArt`](../../web/src/components/CoverArt.tsx) at 44 px (see [theming](theming.md#cover-art)).
- The title, an `h1`, on one line with an ellipsis.
- A meta line `author · m:ss · N stems`. The time is the engine's decoded duration, so it always
  matches the transport's; `N` counts the stems that actually loaded, and one reads `1 stem`.
- The view tabs: `role="tablist"`, `aria-selected`, a roving `tabIndex`, ArrowLeft/ArrowRight
  wrapping and Home/End. Not rendered at 720 px and below.
- **Export stems** opens the [export dialog](downloads.md#the-export-dialog).
- **New track** calls `onBack`. `App` clears the active job, and the `useJobEvents` cleanup sends
  the discard beacon, so the finished job is **deleted on the server**
  ([why](../architecture/decisions.md#discard-on-leave)).

### Analysis bar

[`AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx), four groups in a row that wraps
on a narrow window:

| Group | Shows |
| --- | --- |
| Key | the transposed key label or `—`, plus `NN% confident` when `key_confidence` is set — see [chords and key](chords-and-key.md#client-rendering) |
| Transpose | − / + buttons (disabled at ±11), a signed readout, the hint *semitones · chords follow* — see [transpose](transpose.md) |
| Tempo | BPM as an integer or one decimal (`formatBpm` in [`tempo.ts`](../../web/src/utils/tempo.ts)), or `—` for a null or zero tempo — see [tempo](tempo-and-metronome.md) |
| Master level | a thin fader on the master's own law, with a dB readout |

### Chord bar

[`ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx): the chord readout row, the
duration-proportional chord strip with its playhead, and the lyric row. Rendering is described in
[chords and key](chords-and-key.md#client-rendering) and [lyrics](lyrics.md#client-side). The strip
seeks on pointer press and drag; it is `aria-hidden`, because the transport's seek slider is the
accessible way to seek. It draws chords and the playhead and nothing else — a set loop shows only
on the transport's loop chip — and the synced lyric line is plain text, not a control.

### Transport

[`Transport.tsx`](../../web/src/screens/results/Transport.tsx) is the last thing in the card. The
page never scrolls and the card fills the viewport, so the transport is always on screen; the view
panel above it takes whatever height is left.

Left to right: play/pause, elapsed time, the seek slider, duration, the speed chip, the loop chip
and the metronome chip. The seek slider is a 4 px bar inside a full-height transparent wrapper that
takes the pointer; its keys are Arrow ±5 s, Shift+Arrow or PageUp/PageDown ±30 s, Home and End.
Speed and loop are covered in [speed and loop](speed-and-loop.md), the metronome in
[tempo and metronome](tempo-and-metronome.md#the-metronome). A chip whose prerequisite is missing
stays in place, **disabled** at 45% opacity, with a `title` saying why — it is not removed.

### Dialogs

[`Dialog.tsx`](../../web/src/components/Dialog.tsx) wraps Nocturne's `.dialog` over
`.dialog-backdrop`, rendered after the card: `role="dialog"`, `aria-modal`, labelled by its
heading. On open, focus moves to the element marked `data-autofocus`, else the first focusable
element; Tab and Shift+Tab wrap inside; Escape or a press on the backdrop closes; on close, focus
returns to whatever had it before. The two dialogs are the
[export dialog](downloads.md#the-export-dialog) and the
[lyric sheet and manual entry](lyrics.md#the-lyric-sheet-and-manual-entry).

## Mixer

[`MixerView.tsx`](../../web/src/screens/results/MixerView.tsx), the default view. Column headings
(Stem, Level, Routing, Waveform), then one [`StemRow`](../../web/src/screens/results/StemRow.tsx)
per stem, a `.ch-stemrow`:

- **Name** — the stem's dot and label.
- **Level** — a thin fader and its dB readout.
- **Routing** — [`RoutingToggles`](../../web/src/components/controls/RoutingToggles.tsx): MUTE and
  SOLO as real text buttons with `aria-pressed` and names such as *Mute Vocals*.
- **Waveform** — [`StemWaveform`](../../web/src/components/controls/StemWaveform.tsx): the
  `.ch-wave` bar pattern clipped to the stem's real envelope. `waveformPolygon` in
  [`peaks.ts`](../../web/src/utils/peaks.ts) builds a CSS `polygon()` from 160 peak bins (every 8th
  sample, square-root lifted so a quiet stem still has a shape, with a 2% floor so silence stays
  visible) each time a load finishes. The waveform dims while the stem isn't heard — the design's
  `audible()`, so a stem held by another's solo dims too. A `.ch-playhead` crosses it at the playback
  position, but it doesn't seek; position is set on the chord strip and the transport, and the
  element is `aria-hidden`.

Rows follow `STEM_KEYS` in [`design/stems.ts`](../../web/src/design/stems.ts) — vocals, drums,
bass, guitar, piano, other, the design's order and the API's `STEM_NAMES` order. A stem outside
those six isn't loaded or shown: the design has no name or hue for it. An instrumental's vocals
row arrives muted and the view adds *No vocal content detected — the vocals stem is present but
silent.*

The Mixer has **no pan or tone controls**.

## Console

[`ConsoleView.tsx`](../../web/src/screens/results/ConsoleView.tsx): a `.ch-striprow` of
[`ConsoleStrip`](../../web/src/screens/results/ConsoleStrip.tsx)s beside a
[`MasterStrip`](../../web/src/screens/results/MasterStrip.tsx), filling the view panel's height. The
row never scrolls: strips share the width and narrow below `.ch-strip`'s 112 px floor when they must,
clipping their own controls at the edge, and their faders shrink with the window's height.

Each stem strip is a `.ch-panel.ch-strip` — `.is-active` (the raised panel with an accent hairline)
when soloed, otherwise `.is-off` (55% opacity) when muted — holding the label, a state label, a
vertical fader, a post-fader stereo meter with 0 / −12 / −24 / −∞ ticks, Level and Pan readouts,
and MUTE/SOLO. Pan is **displayed, not adjustable**, here; the knob is in Analog.

The state label and the panel class follow the design's order
([State](../conventions/design.md#state)), solo first:

| State label | When |
| --- | --- |
| Soloed | soloed, muted or not; the only label in the accent colour |
| Silent | muted, not soloed, and it is an instrumental's vocals stem |
| Muted | muted and not soloed |
| Held | neither, while another stem is soloed |
| Playing | anything else; it describes routing, so it also reads *Playing* while paused |

So a stem that is both soloed and muted reads *Soloed* and lifts while the engine keeps it silent —
in the audio, [mute beats solo](../architecture/audio-playback.md#mute-solo-and-volume). Its meter
shows the silence, and its Mixer waveform, which follows `audible()`, dims.

The master strip is 190 px wide: a vertical fader bound to the same `master` value as the analysis
bar, a master meter with 0 / −6 / −18 / −∞ ticks — the fader's cap and the meter's fill both line
up with them — readouts for Output (the master fader in dB), Peak (true peak, held) and Metronome
(On/Off), and a second Export stems button. What the meters measure is in [metering](metering.md).

## Analog

[`AnalogView.tsx`](../../web/src/screens/results/AnalogView.tsx): output needle meters above a row
of [`AnalogModule`](../../web/src/screens/results/AnalogModule.tsx)s.

The five dials — Output left, Output right, True peak (dBTP), Loudness (LUFS) and Correlation — sit
in a grid of `repeat(5, minmax(0, 1fr))`, each SVG capped at 14% of the viewport's height, and the
whole dial section is hidden in a window under 900 px tall, where it and the modules can't both fit.
[`OutputDial`](../../web/src/screens/results/OutputDial.tsx) draws its scale text inside a 200×140
SVG viewBox, so under about 180 px per dial that text drops below 9 px — accepted over scrolling. Whenever the output is
silent, paused included, Correlation reads `—` and its needle eases back to centre.

Each stem gets a `.ch-panel.ch-module` (narrowing below its 120 px floor rather than scrolling) —
`.is-active` when soloed, otherwise `.is-off` when muted, solo first as on the Console strips:

| Control | Size | Range and readout |
| --- | --- | --- |
| Level | 74 px `.ch-knob`, stem-hued arc | the fader law; dB readout under it |
| Tone | 34 px `.ch-knob-sm`, neutral arc | tilts the stem around its pivot, ±6 dB at the extremes (`+3.0 dB`) |
| Pan | 34 px `.ch-knob-sm`, neutral arc | −1…1 on a `StereoPannerNode` (`C`, `L14`, `R8` — percent of a full side) |

Tone is a low shelf and a high shelf at the same pivot frequency, moved in opposite directions. The
pivots are per stem in [`design/stems.ts`](../../web/src/design/stems.ts): vocals 1500 Hz, drums
2000, bass 250, guitar 1200, piano and other 1000. Each small knob shows its value under its label:
the [ground rules](../conventions/design.md#ground-rules) want a visible value on every control,
though the template's harness drew these two with a label only.

**Tone and pan can only be changed in this view.**

## Below 720px

`ResultsScreen` matches `PHONE_QUERY` — `(max-width: 720px)`, in
[`design/layout.ts`](../../web/src/design/layout.ts), the width of the one breakpoint in
[`chord-theme.css`](../../web/src/styles/chord-theme.css) — and below it follows
[Responsive](../conventions/design.md#responsive): the same screen, locked to the Mixer and
reflowed by the stylesheet, not a separate phone layout. The template's harness drew one — stem
cards, a compact header with key and tempo, an *Export* chip — and the app doesn't follow it,
because the template's written rules outranked the harness
([why](../architecture/decisions.md#the-ui-was-built-from-a-design-template)).

| Part | At 720 px and below |
| --- | --- |
| View | locked to Mixer. `view` itself is left alone, so widening the window returns to the view chosen before. No tabs, and the panel drops `role="tabpanel"` |
| Topbar | unchanged but for the missing tabs; it wraps, so *Export stems* and *New track* take a line of their own |
| Analysis bar | rendered, its four groups wrapping with the dividers between them hidden (`max-[720px]:hidden` in `AnalysisBar`) — key, transpose, tempo and master level all stay |
| Chord bar | rendered in full: the chord now and the next three, the strip, and the lyric row with its label |
| Stems | each `.ch-stemrow` stacked by the stylesheet: the name, then the fader with its dB readout, then MUTE and SOLO at 44 px, then the waveform. The column headings are hidden (`max-[720px]:hidden` in `MixerView`), since the columns they head are gone |
| Transport | `.ch-m-bar`: a 46 px play button, the seek slider and a *Click* metronome chip — no time readouts, **no speed chip and no loop chip** |

The cost of the lock: on a phone there are no meters, no tone or pan, and no way to change speed or
to set or clear a loop. A speed or loop set before the window narrowed carries over — playback stays
at that speed, and the loop keeps looping until a seek lands outside it.

## Reduced motion

With `prefers-reduced-motion: reduce`, `ResultsScreen` stores `Math.floor(time)` instead of the
exact position ([Accessibility](../conventions/design.md#accessibility)). The playhead, the time readouts, the current chord and the lyric
line then **step once a second** — which also means the chord and lyric highlights can trail the
audio by up to a second. The meters and needles are not affected and keep moving every frame.

## Rendering cost

`ResultsScreen` runs its own `requestAnimationFrame` loop that reads `engine.getCurrentTime()` and
dispatches it, pausing the engine when `hasEnded` reports it ran off the end. While playing, that is
a new time every frame, so **the whole results tree re-renders at frame rate**: topbar, analysis
bar, chord bar, the active view and the transport. None of them is memoized, and `stems` and
`controls` are rebuilt on every render. While paused the reducer returns the same state and React
skips the work.

The meters are the deliberate exception, written straight to the DOM; see
[why the meters bypass React](metering.md#why-the-meters-bypass-react).

## Known gaps

- Phones get the Mixer only: no meters, tone, pan, speed or loop.
- A soloed, muted stem reads *Soloed* and lifts on the Console and Analog views, but is silent.
- No reset gesture: a double-click does nothing, and no key centres Tone or Pan.
- The page never scrolls, so a window too small for a view clips it instead: strips and modules
  narrow past their floors, the Analog dials hide under 900 px of height, and only a phone's stem
  panel scrolls.
- The view switch unmounts the outgoing view, so meter holds and needle positions restart when you
  come back to it.
