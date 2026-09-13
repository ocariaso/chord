# TypeScript and React conventions

Observed in [`web/`](../../web/). React 19, TypeScript, 2-space indent, double quotes,
semicolons, ~120 column lines.

(`main.tsx` and `vite.config.ts` still carry the Vite scaffold's single quotes and no
semicolons. Everything hand-written since uses double quotes and semicolons.)

## Components

Named function declarations, with a `Props` interface directly above — not exported — and doc
comments on the props whose meaning the type doesn't carry:

```tsx
interface ProcessingScreenProps {
  job: Job;
  onCancel: () => void;
  isCancelling?: boolean;
  /** The first update seen in each stage, from useJobEvents; stage times come from these. */
  stageSnapshots?: Record<number, Job>;
  /** The template's `processing-loading`: the job is done and its stems are loading in the browser. */
  loading?: boolean;
}

export function ProcessingScreen({ job, onCancel, isCancelling = false, stageSnapshots = {}, loading = false }: ProcessingScreenProps) {
```

- **`function`, not `const X = () =>`**, and no `React.FC`.
- **Props destructured in the signature**, with defaults there too (`small = false`,
  `outlined = true`).
- **Named exports** everywhere except `App.tsx`, which is the Vite scaffold's default export.
- A component names the part of the design it is in its doc comment — the class, the state ids or
  the section of design.md (`` /** `.ch-stemrow` (design.md#controls): … */ ``) — which is how the
  code maps back to the standard.
- Small pieces used by one file live there as unexported functions (`Alert` in
  `LandingScreen.tsx`, `SeekSlider` and `SpeedChip` in `Transport.tsx`, `LyricRow` in
  `ChordBar.tsx`); shared ones move to `components/icons.tsx` or `components/controls/`.

## Where code goes

| Folder | Holds |
| --- | --- |
| [`screens/`](../../web/src/screens/) | a folder per template screen — `landing`, `processing`, `failure`, `results` — with a file for each part design.md names (`StemRow`, `ConsoleStrip`, `MasterStrip`, `AnalogModule`, `OutputDial`, `ChordBar`, `Transport`) |
| [`components/`](../../web/src/components/) | generic pieces (`ScreenCard`, `CoverArt`, `Dialog`, `icons.tsx`), the page `Footer`, and the template's controls in `controls/` |
| [`design/`](../../web/src/design/) | the template's non-visual vocabulary — copy, the state model, stem identity, the stage list, the breakpoint. No components, and nothing imported from `screens/` or `components/` |
| `hooks/`, `utils/`, `audio/`, `api/` | behavior with no design in it |

[design.md](design.md) is the standard for what goes inside a screen.

## Props naming

| Pattern | Use |
| --- | --- |
| `onX` | a callback prop (`onSeek`, `onToggleMute`, `onSpeedChange`) |
| `handleX` | the implementation inside a component (`handlePlayPause`, `handleRetryStems`) |
| `isX` / `hasX` | booleans (`isCancelling`, `isRetrying`, `hasVocals`) — except the template's own state fields, which keep its names (`playing`, `metronome`, `muted`, `solo`) |
| an optional `onX` | **a capability toggle** |

That last one is a real pattern, not an accident. An absent callback is how a control learns it
has nothing to do — the speed chip where AudioWorklet is unavailable, the metronome chip for a job
without a tempo:

```tsx
onSpeedChange={supportsSpeed ? handleSpeedChange : undefined}
onToggleMetronome={job.tempo_bpm ? handleToggleMetronome : undefined}
// …and in the child:
disabled={!onToggleMetronome}
```

The chips are disabled rather than removed, so the transport's layout never shifts. Prefer this
over a separate `canChangeSpeed` boolean — the callback's absence *is* the condition, and it can't
disagree with the handler. Below 720px the view tabs work the same way: the template locks the
view there, so `ResultsScreen` passes no `onViewChange` and `ResultsTopbar` renders no tabs. A
different *layout* is a prop instead — `Transport`'s `compact` swaps in the template's `.ch-m-bar`.

## State placement

State lives at the lowest component that still sees every consumer. In practice that means two
owners: `App` (which job, the submission in flight and its error, the cancel and resume requests)
and `ResultsScreen` (the engine, the template's player state, and what the template leaves to the
app — load phase, speed, loop, chords, lyrics, dialogs). `App` holds no screen state — the job's
status decides what renders. See [../architecture/web.md](../architecture/web.md).

No context and no store. The template's `PlayerState`
([`design/player.ts`](../../web/src/design/player.ts)) is one `useReducer` in `ResultsScreen`; the
rest is `useState`. Props are threaded explicitly. When several components need the same set,
bundle it once — per-stem data as a `StemDisplay[]`, the per-stem callbacks as one `StemControls`
object — and hand each view the same two props:

```tsx
const controls: StemControls = {
  onGainChange(key, gain) { … },
  onToggleMute(key) { … },
  // …
};

<MixerView stems={stems} controls={controls} />
<ConsoleView stems={stems} controls={controls} … />
<AnalogView stems={stems} controls={controls} … />
```

### The player reducer

[`playerReducer.ts`](../../web/src/screens/results/playerReducer.ts) is the only place
`PlayerState` changes.

- Actions say what happened: `stemsLoaded`, `stemChanged`, `viewChanged`, `masterChanged`,
  `transposeChanged`, `metronomeChanged`, `playingChanged`, `timeChanged`.
- A handler tells the engine first and dispatches after. The reducer never touches the engine, so
  it stays a pure function of state and action.
- An action that changes nothing returns the same state object. The playhead time is dispatched
  every frame, and while playback is paused that costs no render.
- Limits are enforced in the reducer (`transposeChanged` clamps to ±11), not at each call site, and
  `stemsLoaded` keeps the settings of stems already on the mixer, so a retry after failed downloads
  doesn't reset them.

### Keyed state instead of resetting in effects

State that belongs to one job is stored *with* the job id and ignored on read when the id no
longer matches, rather than cleared by an effect when the id changes:

```ts
const [result, setResult] = useState<{ jobId: string; lyrics: Lyrics | null } | null>(null);
// …
return [result?.jobId === jobId ? result.lyrics : undefined, replaceLyrics];
```

`useLyrics` does this, and so does `useJobEvents` for its connection state and stage snapshots. A
new job never renders a frame with the previous job's data, and there's no reset effect to forget.

## `useRef` vs `useState`

Deliberate and consistent: **`useRef` for anything that must not trigger a render.**

```tsx
const engineRef = useRef<PlaybackEngine | null>(null);   // imperative object
const rafRef = useRef<number>(0);                          // animation frame handle
const readingsRef = useRef(createMeterReadings());         // per-frame scratch, never rendered
const [speed, setSpeed] = useState(1);                     // rendered → state
```

A ref also carries the latest callback into a long-lived subscription, so the subscription doesn't
restart whenever the callback's identity changes. `useAnimationFrame` and `Dialog` both do it:

```ts
const onFrameRef = useRef(onFrame);

useLayoutEffect(() => {
  onFrameRef.current = onFrame;
});
```

For an asynchronous sequence that can be overtaken, use a token: increment it when starting, and
have each continuation bail if it moved. `PlaybackEngine` does this for the transport, bumping
`transportToken` on every pause, seek and dispose:

```ts
const token = ++this.transportToken;
if (this.audioContext.state === "suspended") await this.audioContext.resume();
if (token !== this.transportToken) return;
```

## Async effects

Every async effect uses the same cancellation guard. This is non-negotiable — `StrictMode`
double-invokes effects in development and will expose any hook that skips it:

```tsx
useEffect(() => {
  let cancelled = false;
  setChordSegments(undefined);
  getChords(job.id)
    .then((segments) => {
      if (!cancelled) setChordSegments(segments);
    })
    .catch(() => {
      // No chord analysis for this job (detection switched off, or it never ran); the chord bar says so.
      if (!cancelled) setChordSegments(null);
    });
  return () => {
    cancelled = true;
  };
}, [job.id]);
```

Classes get the same treatment internally — `PlaybackEngine.load()` checks `this.disposed`
after each `await` so a disposed engine's in-flight fetches don't populate it. Nothing aborts those
fetches, though, so under `StrictMode` the first engine's downloads finish and are thrown away.

## Outside React: meters and the stretch worklet

No third-party imperative library is left; waveforms are a CSS `clip-path` traced from the decoded
buffer. Three pieces still work outside React's render cycle, each by design.

### Meters are written to the DOM every frame

`ConsoleView` and `AnalogView` read the engine's analysers inside
[`useAnimationFrame`](../../web/src/hooks/useAnimationFrame.ts) and write the result straight onto
elements: a meter's `--l` custom property, a needle's SVG `transform`, a readout's `textContent`.
React never re-renders for a meter — a custom-property write per frame is cheap, a component
render per frame is not.

```tsx
useAnimationFrame(true, (now) => {
  const readings = readingsRef.current;
  readMeters(readings, now);
  for (const element of meterElementsRef.current) {
    // …pick this element's peak and its LevelFollower…
    element.style.setProperty("--l", mapThroughAnchors(follower.update(peak, now), scale).toFixed(3));
  }
});
```

The rules that keep it cheap and correct:

- **Allocate nothing per frame.** `readMeters` fills a `MeterReadings` object kept in a ref, and
  the engine reads its analysers into preallocated `Float32Array`s.
- **Find elements once, not per frame** — `querySelectorAll("[data-meter]")` in a
  `useLayoutEffect` keyed on the strip count, or callback refs (`needleRef` and `valueRef` on
  `OutputDial`).
- **Keep ballistics in objects, not React state.** `LevelFollower` (instant attack, linear dB
  release, optional hold) and `Smoother` from [`meters.ts`](../../web/src/audio/meters.ts) are
  created once per element or dial and held in refs.
- **Throttle text.** Bars and needles move every frame; numbers change every 125 ms, because
  digits redrawn at 60 fps can't be read.
- **Give the JSX a constant starting value** (`style={{ "--l": 0 }}`). React writes a style
  property only when its rendered value changes, so a re-render doesn't reset what the frame loop
  wrote.

See [../features/metering.md](../features/metering.md).

### The stretch processor is a worklet, reached only by message

[`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js) runs on the audio thread, in
`AudioWorkletGlobalScope`. It is plain JavaScript loaded by URL —
`import stretchProcessorUrl from "./stretchProcessor.js?url"`, then
`audioContext.audioWorklet.addModule(stretchProcessorUrl)` — so `tsc` never checks it, and its
`/* global … */` header declares the worklet globals it uses. It shares no memory with the engine:
`PlaybackEngine` posts `start`, `stop`, `weights` and `blocks` messages, with block buffers
transferred rather than copied, and the processor asks for more input with `need`. Keep that
boundary — anything the processor needs arrives in a message. See
[../features/speed-and-loop.md](../features/speed-and-loop.md).

### The engine is an object React owns but doesn't render

`ResultsScreen` creates the `PlaybackEngine` in an effect, keeps it in a ref, and `dispose()`s it
in the cleanup. The effect depends on `[job.id, stemList]` alone — the stems joined into a string,
since a job update can carry a new array holding the same stems — with the lint suppression and the
reason next to it:

```tsx
    // applyLoad only dispatches and sets state; re-running this effect for its identity would re-download every stem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, stemList]);
```

UI state is read back from the engine after each asynchronous call rather than predicted, because
a start can be overtaken or fall back to 1×:

```tsx
void engine.play().then(() => {
  dispatch({ type: "playingChanged", playing: engine.isPlaying });
  setSpeed(engine.playbackRate);
  setSupportsSpeed(engine.supportsTimeStretch);
});
```

## Three-state values

Where the UI has three distinct displays, model three states rather than pairing a boolean with
a value:

```ts
/**
 * undefined = still loading, null = confirmed no lyrics found, otherwise the fetched result.
 * The setter takes lyrics saved from the manual entry dialog.
 */
export function useLyrics(jobId: string): [Lyrics | null | undefined, (lyrics: Lyrics) => void]
```

`ResultsScreen`'s chord segments follow the same rule (`ChordSegment[] | null | undefined` — the list,
no analysis, still loading). Always document which is which in a doc comment — the distinction is
invisible at the call site otherwise.

## Styling

**`ch-` and Nocturne classes carry all visual styling; runtime values reach them as CSS custom
properties.** Two stylesheets vendored from the design template are imported in
[`main.tsx`](../../web/src/main.tsx), before `index.css`:

| Sheet | Contents |
| --- | --- |
| [`styles/nocturne.css`](../../web/src/styles/nocturne.css) | Nocturne's tokens (`--color-*`, `--space-*`, `--radius-*`, `--font-body`) and base classes (`.btn`, `.input`, `.field`, `.dialog`, `.lighten`), minus the template's font `@import` — `index.html` loads Inter instead |
| [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css) | the `ch-` component layer, the six stem hues, two status hues and surfaces — as it came from the design template, now owned here |

[`index.css`](../../web/src/index.css) adds only the Tailwind import, the page's minimum height,
the design's canvas as the page ground (in tokens) and button cursors. It defines no classes and
overrides nothing in the vendored sheets. [design.md](design.md) is the standard the rest of this
section applies.

A component is a class plus one variable:

| Variable | Meaning | Set by |
| --- | --- | --- |
| `--v` | 0…1 control position | `Fader`, `VerticalFader`, `Knob`; the processing screen's `.ch-progress` |
| `--l` | 0…1 meter level | `ConsoleView`'s frame loop |
| `--p` | 0…1 playback position | `.ch-seek` in `Transport`, `.ch-playhead` in `ChordBar` and `StemWaveform` |
| `--stem` | the stem's hue — `var(--ch-<key>)` from `stemHue()` in `design/stems.ts` | each stem row, strip and module; status dots |

```tsx
<span
  className={thin ? "ch-fader ch-fader-thin" : "ch-fader"}
  style={{ "--v": value } as React.CSSProperties}
  role="slider"
  …
/>
```

- **Never inline geometry for something a class draws.** No computed `width`, `left`,
  `transform` or `background` for a fader cap, knob, meter or playhead — the class maps the
  variable onto the right property. The one computed shape is the waveform's `clip-path`, from
  `waveformPolygon`, which the template names as the thing to generate.
- **Inline styles carry the design's own declarations**, with a token wherever a token carries
  the value (`color: "var(--color-neutral-600)"`, `gap: "var(--space-4)"`), or do layout.
  **Tailwind utilities are layout only** — `flex`, `min-w-0`, `max-[720px]:hidden`,
  `px-(--space-8)`. [design.md](design.md#ground-rules) has the rules.
- **No new colors.** The palette is the six stem hues (`--ch-vocals` … `--ch-other`), the two
  status hues (`--ch-danger`, `--ch-warn`, for dots and hairlines only) and the Nocturne ramps
  (`--color-neutral-*`, `--color-accent-*`). Hairlines mix a token toward transparent
  (`color-mix(in srgb, var(--color-text) 6%, transparent)`) rather than introducing a color, and
  nothing is sampled from cover art. See [../features/theming.md](../features/theming.md).
- Custom properties need a cast where TypeScript types the style object: `as React.CSSProperties`.
- State modifiers are the sheet's `is-*` classes, chosen by ternary or template literal — there is
  no `clsx`-style helper:

  ```tsx
  className={off ? "ch-wave is-off" : "ch-wave"}
  ```

- `boxShadow: "inset 0 0 0 1px …"` instead of `border`, so outlines don't change layout size.
- **One breakpoint, 720px, shared with the stylesheet.** Components read `PHONE_QUERY` from
  [`design/layout.ts`](../../web/src/design/layout.ts) with `useMediaQuery`; `App` and `MixerView`
  use Tailwind's `max-[720px]:`; `chord-theme.css` stacks `.ch-stemrow` at the same width.
  `LandingScreen` and `ProcessingScreen` branch to their phone arrangements. The results screen
  keeps its markup, as [design.md](design.md#responsive) asks: `ResultsScreen` forces the Mixer and passes no
  `onViewChange`, and `Transport`'s `compact` prop swaps in `.ch-m-bar`.
- **Layout follows the design**, as
  [design.md](design.md#screens-and-their-states) records it. See
  [../features/results-views.md](../features/results-views.md).
- `touch-action: none` on the seek bar's hit area, where every direction drags.
- Under `prefers-reduced-motion` the playhead steps once a second instead of gliding every frame.

## Controls and accessibility

Every fader and knob is a `role="slider"` element with `aria-valuemin`, `aria-valuemax`,
`aria-valuenow`, an `aria-label` naming the stem and current value, and `aria-valuetext`. One hook,
[`useSliderControl`](../../web/src/hooks/useSliderControl.ts), supplies the behavior: pointer drag
by axis (a knob drags vertically, 160 px for the full range), the arrows and Home and End that
the design asks for, Page Up and Down from the ARIA slider pattern, and no double-click reset.
MUTE and SOLO are real `<button>`s with `aria-pressed`. The one pointer-only shortcut — dragging the
chord strip to seek — is
`aria-hidden`, with the transport's seek slider as the accessible way to do the same thing.

## API access

Only [`api/client.ts`](../../web/src/api/client.ts) knows the API exists. Two export shapes:

- **Request functions** that throw an `ApiError` (it carries `status`) and prefer the server's
  string `detail`:

  ```ts
  async function errorFrom(res: Response, fallback: string): Promise<ApiError> {
    const body = await res.json().catch(() => null);
    return new ApiError(detailOf(body) ?? `${fallback} (${res.status})`, res.status);
  }
  ```

- **URL builders** returning a plain string, for consumers that aren't these functions —
  `EventSource`, `sendBeacon`, `<img src>`, `PlaybackEngine.load()`'s `fetch`, `downloadFile`.

Interfaces here are hand-mirrored from the Pydantic models; see
[../api/contract-sync.md](../api/contract-sync.md).

## Utilities

Pure functions in [`utils/`](../../web/src/utils/), one concern per file, each with a doc
comment stating the contract:

```ts
/** "C", "L14", "R8" — the offset from centre in percent of a full side. */
export function formatPan(pan: number): string
```

No shared "helpers" bucket — `time.ts`, `tempo.ts`, `transpose.ts`, `lyrics.ts`, `levels.ts`,
`peaks.ts`, `clipboard.ts`, `download.ts`, `hasVocals.ts` are each a single subject. The signal
math the engine uses lives beside it, in [`audio/meters.ts`](../../web/src/audio/meters.ts). The
template's vocabulary — copy, the state model and its tapers, stem identity, the stage list — isn't
a utility; it lives in [`design/`](../../web/src/design/).

## Type-only imports

`verbatimModuleSyntax` is on in [`tsconfig.app.json`](../../web/tsconfig.app.json), so type
imports must be marked:

```ts
import type { Job } from "../api/client";
import { getChords, stemUrl, type ChordSegment, type Job } from "../api/client";
```

Inline `type` within a value import is the prevailing style. `erasableSyntaxOnly` is on too, so
there are no `enum`s, `namespace`s or constructor parameter properties — `ApiError` declares
`readonly status` and assigns it in the constructor for that reason. `noUnusedLocals` and
`noUnusedParameters` are also on — an unused variable **fails the build**, and the build runs
inside the Docker image.
