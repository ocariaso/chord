# Web architecture

React 19 + TypeScript + Vite 8 SPA in [`web/`](../../web/). Styling comes from two vendored
stylesheets — the Nocturne token sheet and CHORD's `ch-` component layer — with Tailwind CSS 4
(via `@tailwindcss/vite`, not PostCSS) for layout. Built to static files and served by nginx.

The UI's design, copy and behavior follow [../conventions/design.md](../conventions/design.md), the
design standard; the UI was built from a design template, since removed, whose rules that page now
carries. [`src/design/`](../../web/src/design/) holds the design's vocabulary in a form the app can
import — the screens' copy, the player state model, the six stems, the stage list and the
breakpoint — and [`src/screens/`](../../web/src/screens/) holds one folder per screen: landing,
processing, failure and results, the standard's reference implementation.

Runtime dependencies are exactly `react` and `react-dom`. No router, no state library, no
data-fetching library, no component library, no waveform or audio library, no icon package —
every icon in the app is a hand-written inline SVG
([`icons.tsx`](../../web/src/components/icons.tsx), plus three in the footer).

## Screen flow

[`App.tsx`](../../web/src/App.tsx) is the entire router, and it holds no screen state. What
renders is derived on every render, checked in this order:

```text
activeJobId === null                          ──► LandingScreen
job.status === "done"                         ──► ResultsScreen    (loading → failed or ready)
connection not live   failed with notFound    ──► FailurePanel     "Job not found" · New track
                      retrying, or failed     ──► FailurePanel     "Connection lost" · Reconnect now / New track
job.status === "error"                        ──► FailurePanel     "Separation failed" · Try another source / Copy log
job.status === "cancelled"                    ──► FailurePanel     "Cancelled" · Resume job / Discard
queued · fetching · separating · analyzing    ──► ProcessingScreen
```

Because `done` is checked first, a finished job keeps its results even if the connection drops
afterwards.

`App` owns the job's identity (`activeJobId`), the create response (`createdJob`), which request is
in flight (`submitting`: `"file"`, `"url"` or `null`), the submit and resume errors, and the small
flags behind *Cancelling…*, *Resuming…* and *Copied*. Everything about the job itself comes from
`useJobEvents(activeJobId)`.

The landing → processing transition is optimistic: the POST resolves with a `JobResponse`, `App`
stores it and its `id`, and the processing screen renders from that response until the event
stream delivers its first update. There is no processing → results transition to manage: the
first render that sees `status === "done"` picks `ResultsScreen`. Nothing is read from or written
to `localStorage`, so results always open on the Mixer view.

The failure panels' copy comes from `failureCopy` in
[`design/copy.ts`](../../web/src/design/copy.ts), keyed by the ids in
[Screens and their states](../conventions/design.md#screens-and-their-states). A job error
is always titled *Separation failed*, whichever stage failed: the body is the row's `error_message`,
the log block its `error_log`, and *Copy log* copies `error_log` — or `error_message` when the server
kept no log, so the button always has something to copy. The design template drew neither a
retries-exhausted *Connection lost* nor a missing job, so that body and the whole *Job not found*
panel are app-authored, and two of the template's own lines are reworded by decision (see
[decisions.md](decisions.md#the-ui-was-built-from-a-design-template)). How a job fails on the
server is in [job-lifecycle.md](job-lifecycle.md#failures).

`handleBack` clears `activeJobId`, which triggers `useJobEvents`' discard cleanup — which fires
the discard beacon. Every way back to the landing screen goes through it: *New track* in the
results and on the *Connection lost* and *Job not found* panels, *Try another source*, *Discard*,
and *Cancel* on the stem-loading screen (`ResultsScreen`'s `onBack`). Going back therefore
*deletes* a finished, failed or cancelled job, and cancels a running one. See
[job-lifecycle.md](job-lifecycle.md#discarding).

## Data access

[`web/src/api/client.ts`](../../web/src/api/client.ts) is the only module that knows the API
exists. Everything above it imports typed functions and URL builders from here.

Two shapes of export, by necessity:

- **Request functions** — `createJob`, `createJobFromUrl`, `getJob`, `cancelJob`, `resumeJob`,
  `getChords`, `getLyrics`, `saveLyrics`. A non-2xx response throws `ApiError`, which carries the
  HTTP `status` — `useJobEvents` needs it to tell a deleted job (404) from a network failure.
  `createJob`, `createJobFromUrl`, `cancelJob`, `resumeJob` and `saveLyrics` use the server's
  `{"detail": "..."}` as the message when it is a string, and a generic `"(status)"` message
  otherwise (FastAPI's validation errors carry a list there); `getJob`, `getChords` and
  `getLyrics` don't read the body.
- **URL builders** — `jobEventsUrl`, `cancelJobUrl`, `discardJobUrl`, `stemUrl`, `thumbnailUrl`,
  `downloadAllUrl`. These exist because most of their consumers aren't a function in this file:
  `EventSource`, `navigator.sendBeacon`, `<img src>`, `PlaybackEngine.load`'s fetch, and
  `downloadFile`'s blob fetch all take a plain string.

`createJob` posts the file as `FormData` with `fetch`, so an upload reports no progress. The landing
screen shows the template's *Submitting…* while the request is out — which covers the upload, nginx
buffering the whole body before it proxies it, and the server copying it to disk. Both create
functions go through a small `post` helper that turns a rejected `fetch` — no response arrived at
all — into a sentence: *"Upload failed — the server couldn't be reached."* for a file, *"Couldn't
start the download — the server couldn't be reached."* for a link. A 413 is special-cased to *"That
file is larger than the server accepts."*, because nginx answers it itself with an HTML page rather
than a JSON detail.

`getLyrics` is the one function that treats a 404 as data rather than failure — it returns
`null`, because "this song has no lyrics" is a normal outcome.

`API_BASE` is the literal `"/api"`. There is no environment variable and no absolute host; the
app always talks to its own origin, and something in front of it does the routing (nginx in
production, the Vite dev proxy locally).

## State ownership

The rule: **state lives at the lowest component that still sees everyone who needs it**, and
there are only two such components.

### `App` — job identity

`activeJobId`, the create response, and submit, cancel and resume activity. Nothing about
playback.

### `ResultsScreen` — everything about playback

[`ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) is the hub. The design's
state model ([State](../conventions/design.md#state)) is typed as `PlayerState` in
[`design/player.ts`](../../web/src/design/player.ts) and held in a `useReducer` over
[`playerReducer.ts`](../../web/src/screens/results/playerReducer.ts); what the state model leaves to
the app sits beside it in `useState`:

| State | Purpose |
| --- | --- |
| `engineRef` | the `PlaybackEngine` instance (a ref, not state — never re-renders) |
| `rafRef`, `reducedMotionRef` | the clock loop's handle, and the reduced-motion flag it reads |
| `player.stems` | one `StemState` per loaded stem, `{key, gain, muted, solo, tone, pan}`, with gain, tone and pan as 0…1 control positions |
| `player.master` | master fader position |
| `player.playing`, `player.duration` | mirrored *from* the engine for rendering; `duration` is the longest decoded buffer |
| `getTime`, `getProgress` | stable callbacks, not state: the engine's clock in seconds (floored under reduced motion) and as 0…1 of its duration — see [The render clock](#the-render-clock) |
| `player.view` | `mixer`, `console` or `analog`; ignored below 720px, where the Mixer is locked |
| `player.transpose` | semitone offset, clamped by the reducer to `MIN_TRANSPOSE`…`MAX_TRANSPOSE` (±11) |
| `player.metronome` | |
| `phase` | `loading`, then `failed` or `ready` |
| `failures`, `isRetrying` | per-stem load failures; a retry in flight |
| `envelopes` | one CSS `polygon()` per loaded stem |
| `speed`, `supportsSpeed` | playback rate, and whether the stretch worklet is usable |
| `loop` | `{start, end}`, with `end: null` between the A and B presses |
| `chordSegments` | `undefined` while loading, `null` when there is no analysis, else the list |
| `hasVocals` | computed from the decoded vocals buffer; stays true when the vocals stem failed to load |
| `exportOpen`, `lyricsDialog` | which dialog is open; the lyrics one as `sheet` or `edit` |

The split follows the design: `PlayerState` is exactly the state its screens need, and every
change to it is one of seven actions in one reducer. An action that changes nothing returns the
state it was given, so a redundant dispatch renders nothing. The playback position is deliberately
not in it.

Plus `useLyrics(job.id)`, which also returns the setter `LyricsDialog`'s save goes through, and two
`useMediaQuery` flags: `PHONE_QUERY` from [`design/layout.ts`](../../web/src/design/layout.ts), kept
as `isPhone`, and `prefers-reduced-motion`. `isPhone` locks the view to the Mixer, withholds the tab
handler from `ResultsTopbar`, drops the panel's `tabpanel` role, and is `Transport`'s `compact`
prop — the only component that renders different markup below 720px.

Every render derives `stems: StemDisplay[]` — the `StemState`, its name and `--stem` hue, `audible`
(the design's `audible()`), `silent` and envelope — and one `controls: StemControls` object holding
the five per-stem callbacks, and passes both to whichever view is showing. Each callback writes the
engine first and dispatches second, converting at that boundary: a gain position becomes linear gain
through the design's `db()` and then `dbToGain` from
[`utils/levels.ts`](../../web/src/utils/levels.ts), pan becomes −1…1 through `panToStereo`, tone
becomes shelf dB through `toneToShelfDb`. The master fader, which isn't part of `controls`, has a law
of its own: `masterDb`, then `dbToGain`.

The views render into one container — a `tabpanel` above 720px — and `ResultsTopbar`,
`AnalysisBar`, `ChordBar` and `Transport` sit outside it and stay mounted at every width. **No view
holds playback state of its own** — that is what makes switching views mid-playback seamless: the
engine never stops, only the view unmounts. The swap is immediate, with no transition. What a view
does keep is display state — meter ballistics in refs — and that starts over each time it mounts.
See [../features/results-views.md](../features/results-views.md).

Some behavior lives here rather than in the engine:

- Only the design's six stems are loaded: `templateStems` in
  [`design/stems.ts`](../../web/src/design/stems.ts) keeps the names in `job.stem_names` that are in
  `STEM_KEYS`, in its order, and skips any other.
- An instrumental's vocals stem is muted on load and marked *Silent* rather than hidden.
- A retry keeps the settings of the stems already on the mixer; `stemsLoaded` adds only the ones
  that weren't there.
- Seeking outside a set loop ends the loop; seeking inside it moves within it.
- The loop chip is a three-press cycle: A, then B, then off. A B press closer than 0.5 s to A is
  ignored, and the engine hears about the loop only once B is set.
- `speed` and `supportsSpeed` are read back from the engine after every `play()` and rate
  change, because a worklet that fails to load drops playback to 1×.

### Why no context or store

Every consumer of playback state is a descendant of `ResultsScreen`, at most three levels below it
— a view, its per-stem component, then a control. Prop threading is verbose — `Transport` takes
twelve props — but bundling per-stem state into `stems` and per-stem callbacks into `controls` keeps
view signatures short, keeps the data flow completely explicit, and means no component can mutate
playback except through the callbacks it was handed.

## The render clock

The position is read, never stored. `ResultsScreen` exposes the engine's clock as two stable
callbacks and runs one `requestAnimationFrame` loop of its own, started once on mount, that does
nothing but notice the end of the track — the engine never stops itself:

```ts
const getTime = useCallback(() => {
  const time = engineRef.current?.getCurrentTime() ?? 0;
  return reducedMotionRef.current ? Math.floor(time) : time;
}, []);

function tick() {
  const engine = engineRef.current;
  // The engine doesn't stop itself at the end of the track.
  if (engine?.hasEnded) {
    engine.pause();
    dispatch({ type: "playingChanged", playing: false });
  }
  rafRef.current = requestAnimationFrame(tick);
}
```

`getTime` goes to `ChordBar` and `Transport`, and `getProgress` (0…1 of `engine.duration`) to
`MixerView` as `progress`. Each display reads them every animation frame through one of two hooks:

- [`usePlayhead`](../../web/src/hooks/usePlayhead.ts) writes `--p` straight onto the chord strip's
  playhead, each Mixer waveform's playhead and the seek slider, skipping a write when the value is
  unchanged. Nothing renders.
- [`useClockValue`](../../web/src/hooks/useClockValue.ts) re-reads a derived primitive — the
  elapsed `m:ss`, the seek slider's whole seconds, the active and ended chord counts, the lyric line
  — and renders its component only when it changes: the chord bar on a boundary, a line or a
  second, the transport's `ElapsedTime` and `SeekSlider` once a second.

So playback renders neither `ResultsScreen` nor the view. Under reduced motion every reader gets the
floored clock and steps once a second together. The cost is one frame loop per display, running
paused as well as playing, and a frame of lag after a prop change that a clock value depends on. See
[decisions.md](decisions.md#the-playback-position-is-read-not-stored).

Meters take a separate path on purpose. `ConsoleView` and `AnalogView` each run their own loop
through [`useAnimationFrame`](../../web/src/hooks/useAnimationFrame.ts), call `readMeters` (a
stable callback onto the engine), and write the results straight to the DOM: `--l` on each meter
bar, a `transform` on each needle, and readout text at most every 125 ms. Those values never
enter React state, so the meters keep releasing toward silence after playback pauses without
rendering anything, and render nothing while it plays. React never
overwrites what the loops write, because the props it renders on those elements — `--l: 0`, a
needle's rest angle, the initial readout text — never change after mount. See
[../features/metering.md](../features/metering.md).

## Hooks

| Hook | Responsibility |
| --- | --- |
| [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) | one job's live status over SSE, reconnection with backoff, per-stage snapshots, discard-on-leave, and a heartbeat every 5 minutes that keeps the open job from the server's reaper |
| [`useLyrics`](../../web/src/hooks/useLyrics.ts) | fetch lyrics once per job; `undefined` = loading, `null` = none; also returns a setter for saved lyrics |
| [`useMediaQuery`](../../web/src/hooks/useMediaQuery.ts) | live `matchMedia` boolean — `PHONE_QUERY` in the landing, processing and results screens, and reduced motion |
| [`usePopover`](../../web/src/hooks/usePopover.ts) | click-toggled popover (the speed menu), closed by an outside press or Escape |
| [`useSeekDrag`](../../web/src/hooks/useSeekDrag.ts) | press or drag across an element → seek to that fraction of the duration; used by the chord strip and the transport's seek slider |
| [`useSliderControl`](../../web/src/hooks/useSliderControl.ts) | pointer and keyboard handling for a 0…1 control drawn through `--v` |
| [`useAnimationFrame`](../../web/src/hooks/useAnimationFrame.ts) | a `requestAnimationFrame` loop while `active`, always calling the latest callback |
| [`useClockValue`](../../web/src/hooks/useClockValue.ts) | a value derived from the playback clock, re-read every frame and rendered only when it changes |
| [`usePlayhead`](../../web/src/hooks/usePlayhead.ts) | a ref whose element gets `--p` written every frame from a 0…1 progress callback |
| [`useElementWidth`](../../web/src/hooks/useElementWidth.ts) | callback ref plus the element's width, kept current by a `ResizeObserver` |

`useSliderControl` backs every fader and knob. A horizontal fader follows the pointer's x, a
vertical one `(bottom − y) / height`, and a knob a vertical drag of 160 px for its full range —
rotational drag is unusable with a mouse. Arrow keys step 0.01, Shift+arrow and Page Up/Down step
0.1, and Home and End jump to 0 and 1: the keys
[Accessibility](../conventions/design.md#accessibility) specifies.
There is no double-click reset. A step is a fixed distance in position, not in dB.

The three-state `undefined | null | value` convention in `useLyrics` (and in `chordSegments`)
exists because the UI shows something different for each: the lyric row in
[`ChordBar`](../../web/src/screens/results/ChordBar.tsx) reads *Looking for lyrics…*, the synced
line, *Found, not synced — no timing available.* with *Open lyric sheet*, or *None found for this
track.* with *Add lyrics manually*.

Every async effect uses the same `let cancelled = false` + cleanup guard so a late resolve can't
write into an unmounted tree — worth preserving, because `StrictMode` double-invokes effects in
development and will surface any hook that skips it. `useJobEvents` and `useLyrics` also key
their state by job id and return nothing for a stale id, instead of resetting state in an
effect, so a new job never flashes the previous one's data.

## Subscription and cleanup

`useJobEvents` is the most side-effect-heavy hook in the app, and it splits its work into two
effects.

**Discard**, keyed on `[jobId]` alone:

1. Register a `pagehide` listener that `navigator.sendBeacon`s the discard endpoint, and call the
   same function from the effect's cleanup — so it also fires when `activeJobId` changes.
2. Skip the beacon if no status was ever observed for the job.

It is a separate effect so that reconnecting, which re-runs the subscription, can never fire it.
`sendBeacon` is used rather than `fetch` because the browser guarantees delivery of a beacon
during page teardown, where an in-flight `fetch` would be cancelled.

**Subscription**, keyed on `[jobId, generation]`:

1. `getJob()` once, so the UI has data before the first SSE tick. A job already terminal stops
   here.
2. Open an `EventSource` on `/api/jobs/{id}/events`. Each message delivers the job, resets the
   retry count and reports the connection `live`; a terminal status closes the stream.
3. On a stream error for a job that isn't terminal, close the `EventSource` — its built-in retry
   would reconnect with nothing to resume from — and schedule a retry of step 1 after 1 s, 2 s,
   4 s, 8 s, then every 10 s, reporting `retrying {attempt, lastError}`. After
   `MAX_RECONNECT_ATTEMPTS` (10) the state is `failed`: at least 75 s of retries in all.
4. A 404 from `getJob` fails at once with `notFound: true` — the job is gone, and retrying can't
   bring it back.

`App` shows *Connection lost*, with the retry count, for `retrying` and `failed`, and *Job not
found* for a 404. A dropped connection replaces the processing screen from the first retry.
Because every retry starts with `getJob`, updates missed while disconnected aren't lost — the row
is the state. Reloading the page still loses the job, since its id lives only in React state.

`reconnect(latest?)` bumps `generation`, which tears the subscription down and starts again at
step 1 with a fresh count. `App` calls it from *Reconnect now*, and after a resume with the
`JobResponse` the resume returned, so the screen shows `queued` before the stream does.

The hook also returns `stageSnapshots`: the first update it saw in each of the processing
screen's five stages, indexed through `processingStage` in
[`design/stages.ts`](../../web/src/design/stages.ts). `App` hands them to `ProcessingScreen` — directly,
and through `ResultsScreen` for the stem-loading screen — which subtracts their `updated_at`
timestamps to show how long each finished stage took. Both sides of every subtraction are server timestamps, so the client's clock
never enters. `reconnect(latest)` starts the snapshots over.

## Styling

The look lives in two vendored stylesheets, imported by [`main.tsx`](../../web/src/main.tsx)
ahead of Tailwind:

| Order | File | What it is |
| --- | --- | --- |
| 1 | [`styles/nocturne.css`](../../web/src/styles/nocturne.css) | The Nocturne token sheet — `--color-*` ramps, `--space-*`, `--radius-*`, fonts — and its base classes (`.btn`, `.input`, `.field`, `.tag`, `.dialog`, `.lighten`). Copied from the design template's Nocturne sheet with only its Google Fonts `@import` removed, and owned here since; `index.html` loads Inter 400/500/600 instead. |
| 2 | [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css) | CHORD's `ch-` component layer: the six stem hues, two status hues, panel surfaces, and every control and layout class. Copied unmodified from the design template, and owned here since. |
| 3 | [`index.css`](../../web/src/index.css) | `@import "tailwindcss"`, a full-height root, the page ground and button cursors. The ground is the canvas the template's harness drew, in tokens: a radial gradient from `--ch-panel-raised` at the top left through `--color-bg` to `--ch-well`, one viewport tall, over an `html` background of `--ch-well` so a longer page carries on in the colour the gradient ends at. It defines no classes. |

The conventions that follow are summarized here; the rules themselves are in
[../conventions/design.md](../conventions/design.md).

- **Copy comes from [`design/copy.ts`](../../web/src/design/copy.ts)**, verbatim from the design
  template unless marked app-authored. The stage labels in it double as the API's `stage_message` values.
- **Classes carry the look, and the palette is fixed.** Components compose `ch-` and Nocturne
  classes and introduce no colors of their own. The palette is the six stem hues (`--ch-vocals`
  … `--ch-other`), two status hues (`--ch-danger` and `--ch-warn`, only ever as dots and
  hairlines) and the Nocturne ramps — the same for every song. Cover art appears only inside its
  own tile.
- **Runtime values go in as CSS custom properties, never as inline geometry.** A control is a
  class plus one variable, and the class maps the variable onto width, position or rotation:

  | Variable | Range | Written by | Read by |
  | --- | --- | --- | --- |
  | `--v` | 0…1 | `Fader`, `VerticalFader`, `Knob`, `ProcessingScreen` | `.ch-fader`, `.ch-vfader`, `.ch-knob`, `.ch-progress` |
  | `--l` | 0…1 | `ConsoleView`'s frame loop, on the meters in `ConsoleStrip` and `MasterStrip` | `.ch-meter i` |
  | `--p` | 0…1 | `usePlayhead`'s frame loop, in `ChordBar` and `StemWaveform` (the playhead) and `Transport` (the seek slider) | `.ch-playhead`, `.ch-seek` |
  | `--stem` | a color | `StemRow`, `ConsoleStrip`, `AnalogModule` and the export rows, via `stemHue()` → `var(--ch-<key>)`; the small knobs, the master meter and the status dots, with a hue of their own | dot, fader fill, meter, waveform bars, knob arc |

- **Tailwind and inline `style` take tokens, not literals** — `style={{ gap: "var(--space-8)" }}`,
  or Tailwind's token shorthand `px-(--space-8)`. They are mostly layout (flex, grid, gaps,
  padding, widths), but components also set type inline (`font: "500 12.5px/1 var(--font-body)"`)
  and the odd token color, so the classes are not the only place visual styling lives.
  `npm run lint` runs [`scripts/check-design.mjs`](../../web/scripts/check-design.mjs) after oxlint
  to catch the mechanical breaks — an undefined token or class, a new colour or font, a spacing token
  written as px, a custom property other than the four above.
- **Markup follows the class contract** in [Classes](../conventions/design.md#classes) element for
  element, because the classes assume its nesting: `.ch-vfader` and `.ch-knob` each need exactly one
  `<span>` child, which is the cap.
- **One breakpoint: 720px.** It is `chord-theme.css`'s own `@media (max-width: 720px)`, which
  stacks `.ch-stemrow`; `PHONE_QUERY` in [`design/layout.ts`](../../web/src/design/layout.ts) repeats
  it for `useMediaQuery`, and Tailwind's `max-[720px]:` repeats it by hand in `App` (the side
  gutters), `MixerView` (hiding the column labels) and `AnalysisBar` (hiding the dividers between its
  groups). Below it the results follow [Responsive](../conventions/design.md#responsive)
  — the Mixer locked, no tabs, the rows stacked by the stylesheet — and only the transport renders
  different markup, `.ch-m-bar`. The landing and processing screens switch to their phone
  arrangements at the same width. See
  [../features/results-views.md](../features/results-views.md#below-720px).
- **Waveforms are `.ch-wave` bars clipped to the real envelope**: `utils/peaks.ts` turns each
  decoded buffer into a `polygon()`, applied as `clip-path`. See
  [audio-playback.md](audio-playback.md#waveforms).

See [../features/theming.md](../features/theming.md),
[decisions.md](decisions.md#the-ui-was-built-from-a-design-template) and
[decisions.md](decisions.md#vendored-stylesheets-driven-by-custom-properties).

`__APP_VERSION__` is injected by [`vite.config.ts`](../../web/vite.config.ts) from
`package.json`'s `version` and rendered in the footer; it's declared in
[`vite-env.d.ts`](../../web/src/vite-env.d.ts).

## Build and serve

```dockerfile
FROM node:20-alpine AS build      # npm ci, then npm run build (tsc -b && vite build)
FROM nginx:1.27-alpine            # copy dist/ + nginx.conf
```

The image runs `npm run build` only. `npm run lint`, and the design check in it, run only when
someone runs them — there is no CI.

`tsc -b` type-checks everything under `src` except the stretch worklet.
[`audio/stretchProcessor.js`](../../web/src/audio/stretchProcessor.js) is plain JavaScript,
because it runs in `AudioWorkletGlobalScope` and is loaded by URL (the engine imports it with
Vite's `?url` suffix, which emits it as a separate file), and the TypeScript config doesn't
enable `allowJs` — so the linters are the only tools that read it before a browser does.

[`nginx.conf`](../../web/nginx.conf) does four things:

- `try_files $uri $uri/ /index.html` — SPA fallback.
- `location /api/ { proxy_pass http://server:8000/; }` — note the trailing slash on the target,
  which **strips** the `/api` prefix. The server's routes are mounted at `/jobs`, not `/api/jobs`.
- `client_max_body_size 512m` inside `/api/`. nginx's 1 MB default would answer almost any audio
  upload with a 413 before it reached the server; this is the only upload size limit CHORD
  configures.
- For SSE: `proxy_buffering off`, `proxy_set_header Connection ""`, `proxy_http_version 1.1`,
  and `proxy_read_timeout 1h`. Without these, nginx would buffer the event stream and the
  progress UI would arrive in one lump at the end — or time out on a long separation.
