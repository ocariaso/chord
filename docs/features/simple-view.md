# Simple view

The default mixer: a readable chord readout, a transport, and one row per stem. Chosen by
`viewMode === "simple"` in [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx), and always
the view a newly finished job opens in — `App` writes
`localStorage["chord:viewMode"] = "simple"` on the transition to results.

## Layout

```
┌─ fixed full-viewport gradient (primary hue) ────────────────────────┐
│  max-w-3xl column                                                   │
│  ┌─ card (cardBg / cardBorder) ─────────────────────────────────┐   │
│  │  header:  thumbnail background + scrim                       │   │
│  │           title (marquee if it overflows)                    │   │
│  │           subtitle: author · key · BPM                       │   │
│  │           [Simple|Studio]  [download all]  [upload another]  │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  ChordTimeline:  active chord + next five                    │   │
│  │                  current lyric line                          │   │
│  │                  key · transpose · volume · metronome        │   │
│  │                  proportional segment bar + playhead         │   │
│  │  TransportBar:   play/pause · 0:42 · scrubber · 3:51         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  StemChannel × 6   (vocals, guitar, bass, piano, drums, other)      │
└─────────────────────────────────────────────────────────────────────┘
```

Stem order is `SIMPLE_STEM_ORDER = ["vocals", "guitar", "bass", "piano", "drums", "other"]`,
applied by `orderedStemNames()`, which filters that list to what exists and then appends any
unrecognized stem name so nothing is ever dropped. Note it differs from the Studio view's
`STEM_ORDER` (which swaps piano and drums) — the two views order stems independently.

## The marquee title

A pattern that appears three times in the codebase (here, `ProcessingScreen`, `MasterUnit`):
measure first, animate only if needed.

```tsx
<span ref={titleMeasureRef} aria-hidden="true" className="invisible absolute whitespace-nowrap …">
  {job.original_filename}
</span>
```

An invisible, absolutely-positioned, non-wrapping copy of the text gives its natural
`scrollWidth`. If that exceeds the container's `clientWidth`, `marqueeTextWidth` is set and the
real title renders as two side-by-side copies animated by the `marquee-loop` keyframes from
[`index.css`](../../web/src/index.css); otherwise it renders once with `truncate`.

The distance is passed as a CSS custom property rather than a generated class, because it's a
measured pixel value:

```tsx
style={{ "--marquee-distance": `-${marqueeTextWidth + MARQUEE_GAP}px`,
         animation: `marquee-loop ${marqueeDuration}s linear infinite` }}
```

Speed is width-proportional (`(width + gap) / 40`, floored at 4 s) so long and short titles
scroll at the same perceived rate. A `ResizeObserver` on the container re-measures on viewport
changes. Only `StemMixer`'s copy re-measures on `loading` too, since its container's width
changes when the loading screen is replaced.

## `ChordTimeline`

[`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx) packs the chord readout and
most of the global controls into one component. It returns `null` when
`segments.length === 0`, so a job without chord detection simply has no timeline.

Composed as named fragments — `chordGroup`, `keySpan`, `transposeGroup`, `volumeGroup`,
`metronomeButton` — then arranged **twice**, once for mobile and once for desktop:

```tsx
{isMobile ? (
  <div className="flex flex-col gap-2">
    {chordGroup}
    <div>{keySpan}{metronomeButton}</div>
    <div>{transposeGroup}{volumeGroup}</div>
  </div>
) : (
  <div className="flex flex-wrap items-center justify-between">
    {chordGroup}
    <div className="flex flex-col items-end gap-2">
      <div>{keySpan}{transposeGroup}</div>
      <div>{volumeGroup}{metronomeButton}</div>
    </div>
  </div>
)}
```

Two explicit arrangements rather than one responsive grid, because the groupings genuinely
differ — not just their direction. `isMobile` comes from
`useMediaQuery("(max-width: 639px)")` in `StemMixer` (Tailwind's `sm` breakpoint) and is passed
down, so both views agree on one definition of "mobile".

**Chord readout.** The active chord at `text-3xl`, then the next five at `text-lg` stepped
through `UPCOMING_OPACITY` (`neutral-500, 500, 600, 600, 700`) so the queue reads as a fade-out.
When nothing is active the chord shows `—`, and a `N` segment renders as `-` via
[`transposeChord`](../../web/src/utils/transpose.ts).

**Key readout.** `Key: <transposed label>` with an `i` button wired to
[`useClickTooltip`](../../web/src/hooks/useClickTooltip.ts) — a click/tap toggle rather than a
hover `title`, so it works on touch. It closes on outside pointerdown or Escape. The tooltip
text explains the transpose control's purpose: *"Adjust the key if detected wrong. This will
transpose the chords accordingly."* (The same string is also set as a `title` attribute, so
desktop hover works too.)

**Segment bar.** One `<div>` per segment, width `((end - start) / duration) * 100%`, the active
one filled with `accentColor` and the rest with
`color-mix(in srgb, ${cardBorder} 60%, #262626)`. A `pointer-events-none` white 2 px line is
positioned by percentage as the playhead, and `useSeekDrag` on the container makes the whole bar
click-and-drag seekable. Each segment also carries its chord as a `title` for hover inspection.

## `StemChannel`

[`StemChannel.tsx`](../../web/src/components/StemChannel.tsx) — one row per stem:

```
┌──────────┬─────────────────────────────────────┬──────────┬───┐
│ vocals   │  ▁▃▅▇▅▃▁▃▅▇▅▃▁▃▅▇▅▃▁▃▅▇▅▃▁          │ ──●───── │ ⤓ │
│ [M] [S]  │  (WaveSurfer, 56px, drag to seek)   │  volume  │   │
└──────────┴─────────────────────────────────────┴──────────┴───┘
```

- **M / S** — mute turns red when active; solo takes the `secondaryColor` fill. Inactive buttons
  get the themed inset border.
- **Waveform** — a WaveSurfer instance created in an effect keyed on `[buffer]`, with
  `interact: false`; seeking comes from `useSeekDrag` on the container instead. Registers itself
  via `onWaveSurferReady(name, instance)` so `StemMixer`'s animation-frame loop can push
  `setTime()` into it. Destroyed in the effect's cleanup. See
  [../architecture/audio-playback.md](../architecture/audio-playback.md#the-split-with-wavesurfer).
- **Volume** — a native `<input type="range">` with `style={{ accentColor }}`, which themes the
  browser's own slider chrome with one property.
- **Download** — fetches the WAV as a blob and triggers a save; shows a spinner while in flight.
  See [downloads.md](downloads.md).

The `progressColor` sync effect described in [theming.md](theming.md#the-late-color-problem)
lives here.

## Loading and error states

Before the stems finish decoding, `StemMixer` renders **`ProcessingScreen` again** rather than a
bespoke spinner, with a synthesized job object:

```tsx
<ProcessingScreen
  job={{ ...job, status: "separating", stage_message: "Loading stems...", progress: 1 }}
  connectionError={null} onRetry={onBack} onCancel={onBack} />
```

This is why `ProcessingScreen` takes an optional `onCancel` — its default behavior calls
`cancelJob(job.id)`, which would be wrong here: the server-side job is already done, and the
only thing to cancel is the client-side load. The prop's doc comment says exactly that.

A load failure renders a centered message plus a "Back to upload" button, with the brand blue
`#307E9F` hardcoded — the one place the accent isn't used, since a failed load may have had no
thumbnail to sample.
