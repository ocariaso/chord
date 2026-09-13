# Map: `web/`

React 19 + TypeScript + Vite SPA, served by nginx. Runtime dependencies: `react` and `react-dom` —
nothing else. The look is the Nocturne design system's token sheet plus the `ch-` component layer,
both vendored from the design template the UI was built from and owned here since; Tailwind 4
supplies layout utilities only. Every icon is hand-written inline SVG. The rest of what the design
defines — its copy, player state model, stems, stage list and breakpoint — lives in
[`src/design/`](../../web/src/design/), and
[`scripts/check-design.mjs`](../../web/scripts/check-design.mjs) checks the design's ground rules
on every `npm run lint` (see [../conventions/design.md](../conventions/design.md)).

```
web/
├── Dockerfile  .dockerignore  nginx.conf  index.html
├── package.json  vite.config.ts  tsconfig*.json  .oxlintrc.json
├── public/      favicon.svg  icons.svg
├── scripts/     check-design.mjs
└── src/
    ├── main.tsx  App.tsx  index.css  vite-env.d.ts
    ├── api/          client.ts
    ├── audio/        playbackEngine.ts  meters.ts  stretchProcessor.js
    ├── styles/       nocturne.css  chord-theme.css
    ├── design/       copy  player  stems  stages  layout
    ├── hooks/        useJobEvents  useLyrics  useMediaQuery  usePopover  useSeekDrag
    │                 useSliderControl  useAnimationFrame  useClockValue  usePlayhead
    │                 useElementWidth
    ├── utils/        time  tempo  transpose  lyrics  hasVocals  download  levels  peaks
    │                 clipboard
    ├── assets/       hero.png  react.svg  vite.svg
    ├── components/   FitToPanel  CoverArt  Dialog  Footer  icons
    │   └── controls/  Fader  Knob  RoutingToggles  StemWaveform
    └── screens/
        ├── landing/     LandingScreen
        ├── processing/  ProcessingScreen
        ├── failure/     FailurePanel
        └── results/     ResultsScreen  playerReducer  types
                         ResultsTopbar  AnalysisBar  ChordBar  Transport
                         MixerView  StemRow
                         ConsoleView  ConsoleStrip  MasterStrip
                         AnalogView  AnalogModule  OutputDial
                         ExportDialog  LyricsDialog
```

Phones — below 720px, `PHONE_QUERY` in `design/layout.ts` — follow
[Responsive](../conventions/design.md#responsive). The landing and processing screens branch into
the phone arrangements the template's harness drew on `useMediaQuery(PHONE_QUERY)`;
the results screen locks to the Mixer with no view tabs and a compact transport, and otherwise keeps
the web markup — `chord-theme.css` stacks the stem rows, and `max-[720px]:` utilities hide the
Mixer's column labels and the analysis bar's dividers.

In the entries below, `landing/`, `processing/`, `failure/` and `results/` are the folders under
`src/screens/`, and `controls/` is `src/components/controls/`.

---

## Build and serve

### `Dockerfile` — multi-stage build
**Notes:** `node:20-alpine` runs `npm ci` (before the source copy, so a code change doesn't
reinstall deps) then `npm run build`; `nginx:1.27-alpine` receives `dist/` and `nginx.conf`.
Because the build is `tsc -b && vite build`, **a type error fails the image build** — lint, and so
the design check, never runs there. `COPY . .` also copies `scripts/` into the build stage; nothing
imports it, so it never reaches `dist/`.

### `.dockerignore` — keeps `node_modules/` and `dist/` out of the build context
**Notes:** without it, `COPY . .` would lay the host's `node_modules` over the image's own `npm ci`
install.

### `nginx.conf` — static serving + API proxy (43 lines)
**Notes:** six jobs. (1) `try_files $uri $uri/ /index.html` — SPA fallback. (2)
`proxy_pass http://server:8000/` — **the trailing slash strips the `/api` prefix**, which is why
server routes are mounted at `/jobs`. (3) SSE survival: `proxy_buffering off`,
`proxy_set_header Connection ""`, `proxy_http_version 1.1`, `proxy_read_timeout 1h` — all four
required, or progress arrives in one lump or times out. (4) `client_max_body_size 512m` on
`/api/` — without it nginx's 1 MB default answers real uploads with a 413 (which `createJob` turns
into a sentence, since the body is HTML). (5) `gzip on` (level 5, bodies over 1024 bytes) for
`text/css`, `application/javascript`, `application/json` and `image/svg+xml` only — stems and
artwork are already compressed, and `text/event-stream` is left out so each event goes out as it is
written. (6) Caching: `location /assets/` answers `Cache-Control: public, max-age=31536000,
immutable`, safe because Vite puts a content hash in every file name there, and
`location = /index.html` answers `no-cache`, because it names the current hashed assets. The SPA
fallback serves `index.html` for other paths without that header.
**See:** [../operations/docker.md](../operations/docker.md#nginx)

### `index.html` — the shell
**Notes:** `#root` div, module script, `/favicon.svg`, and a Google Fonts stylesheet for **Inter
400/500/600** with `preconnect` hints — the only typeface the design uses. Offline, the token
stacks fall back to `system-ui`.

### `package.json`
**Notes:** `version` is injected into the app as `__APP_VERSION__` and rendered in the footer.
Scripts: `dev`, `build` (`tsc -b && vite build`), `lint` (`oxlint && node scripts/check-design.mjs`
— the design check runs only when oxlint exits cleanly), `preview`. Dependencies are `react` and
`react-dom` only.

### `vite.config.ts`
**Notes:** `react()` + `tailwindcss()` (Tailwind 4 as a Vite plugin, **not** PostCSS).
`define.__APP_VERSION__` from `package.json`. Dev proxy `/api` → `http://localhost:8787` with
`rewrite` stripping `/api`, mirroring nginx. **The target port 8787 disagrees with the server's
documented 8000** — see
[../operations/local-development.md](../operations/local-development.md#the-vite-proxy-port-mismatch).
The `?url` import that loads the stretch worklet needs no configuration: Vite emits the file as a
hashed asset.

### `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json`
**Notes:** project references. `tsconfig.app.json` covers `src` with `verbatimModuleSyntax`
(type imports must be marked `type`), `erasableSyntaxOnly` (no parameter properties or enums),
`noUnusedLocals` and `noUnusedParameters` — **an unused variable fails the build**, and the build
runs inside Docker. `allowJs` is off, so `audio/stretchProcessor.js` is **not type-checked**.

### `.oxlintrc.json`
**Notes:** plugins `react`, `typescript`, `oxc`; two rules configured —
`react/rules-of-hooks` (error) and `react/only-export-components` (warn, constants allowed) — on
top of oxlint's defaults, which include the React compiler-derived checks (`refs`,
`set-state-in-effect`, `purity`). The design system's own adherence config was written as ESLint
selectors oxlint doesn't implement; those rules run as `scripts/check-design.mjs` instead.

### `scripts/check-design.mjs` — the design's ground rules as a lint step (201 lines)
**Exports:** — (a Node script: prints `path:line  message` for each violation and exits 1)
**Imports from:** — (reads `src/` from disk)
**Used by:** `package.json`'s `lint` script, after oxlint
**Notes:** the rules the design system ships as ESLint `no-restricted-syntax` selectors
(the template's `_ds/…/_adherence.oxlintrc.json`), plus the parts of design.md's
[Ground rules](../conventions/design.md#ground-rules) a script can see. It first reads `src/styles/`, collecting every custom property, class and
`--space-N` px value the two vendored sheets define, then walks every other `.ts`, `.tsx`, `.js` and
`.css` file under `src/` and reports: a hex colour; a colour function other than a plain-black
`rgba(0, 0, 0, a)` shadow; a spacing token's px value written out (`8.4px` rather than
`var(--space-3)`); a `var(--…)` neither sheet defines, or one built at runtime; an inline custom
property other than `--v`, `--l`, `--p` and `--stem`; a class in an owned family (`ch-*`, `is-*`,
`btn*`, `dialog*`, `field`,
`input`, `lighten`) neither sheet defines; a font other than `var(--font-body)` or
`var(--font-heading)`; and any class defined in app CSS, where every selector up to a `{` is
checked, one-line rules included. **It scans string literals and template-literal text, not an
AST**: a number in a `style` object is never checked, a regex literal or JSX text can trip it, and a
template literal is checked piece by piece around its substitutions — so a `var(--…)` name ending
in `-` is the head of one built at runtime (`` `var(--ch-${key})` ``), and it is reported, because
what it completes to can't be checked. `scripts/` is in neither tsconfig project, so the script
isn't type-checked.
**See:** [../conventions/design.md](../conventions/design.md)

### `.gitignore`, `README.md`, `package-lock.json`, `public/`, `src/assets/` — everything else
**Notes:** `.gitignore` is web-local; `README.md` is the unmodified create-vite React + TypeScript
readme; `package-lock.json` pins the tree `npm ci` installs. `public/favicon.svg` is the tab icon;
`public/icons.svg` and all three `src/assets/` files (`hero.png`, `react.svg`, `vite.svg`) are
scaffold leftovers nothing references.

---

## Entry points

### `src/main.tsx` — mounts `<App/>` in `StrictMode`
**Imports from:** `App`, `styles/nocturne.css`, `styles/chord-theme.css`, `index.css`
**Notes:** the three stylesheets are imported in that order because `chord-theme.css` reads
Nocturne's variables. Vite scaffold style (single quotes, no semicolons). `StrictMode` double-invokes mount effects in development, so under `npm run dev`
`ResultsScreen` downloads its stems twice.

### `src/index.css` — global styles (28 lines)
**Used by:** `main.tsx`
**Notes:** `@import "tailwindcss"`; `height: 100%` and `overflow: hidden` on `html`, `body` and
`#root` — **the page never scrolls**; the app is one viewport (`h-dvh` in `App.tsx`) and screens share
out its height; the page ground; and button cursors (`pointer`, or `not-allowed` when disabled). The
ground is the canvas the template's harness drew, in tokens: `html` in `--ch-well`, and on `body` a
radial glow from `--ch-panel-raised` at the top left through `--color-bg` to `--ch-well`, sized to
the viewport (`100% 100%`, no repeat). It defines no class and no keyframes — app CSS that
defines a class fails `check-design.mjs`. Tailwind's preflight **and utilities** sit in cascade
layers while the vendored sheets are unlayered, so **a Tailwind class can't override a property a
`ch-` or Nocturne class sets** — use an inline style.

### `src/vite-env.d.ts` — ambient types
**Notes:** `vite/client` types (which also declare `*?url` imports) and the `__APP_VERSION__`
declaration.

### `src/App.tsx` — screen router and job identity (202 lines)
**Exports:** `App` (default)
**Imports from:** `api/client`, `components/Footer`, `design/copy`, `hooks/useJobEvents`,
`failure/FailurePanel`, `landing/LandingScreen`, `processing/ProcessingScreen`,
`results/ResultsScreen`, `utils/clipboard`
**Used by:** `main.tsx`
**Notes:** there is no screen state. `activeJobId === null` shows `LandingScreen`; otherwise
`renderJob` lets the job decide, in this order — `done` → `ResultsScreen`, handed `stageSnapshots`
for its loading screen and checked first, so a finished job never shows a connection failure; a
connection that isn't `live` → `FailurePanel`: *Job not found* on a
404 (with *New track* only), otherwise *Connection lost* (the retry count, or that retries stopped,
with *Reconnect now* and *New track*); `error` → *Separation failed*, with `error_message` as its
body, `error_log` as its log, *Try another source* and *Copy log* (which copies the log, or the
message when there is none, and reads *Copied* for 2 s); `cancelled` → *Cancelled* with *Resume
job* (`resumeJob`, then `reconnect(latest)`; a failure shows as the panel's log) and *Discard*;
anything else → `ProcessingScreen`. **The failed row's `stage_message` isn't read** — every job
failure has the same title, whichever stage failed. Titles, bodies and labels come from
`failureCopy` and `landingCopy`. `createdJob` (the POST response) fills the gap before the stream's
first update. Owns the in-flight submission (`Submission`, which picks the button that reads
*Submitting…*) and its `SubmitError` — a `landingCopy` title over the thrown message — plus the
cancel, resume and copy-log handlers; a cancel that fails is ignored (a job that finished meanwhile
answers 409), since the stream reports the real state. **Leaving a job discards it**: `handleBack`
— *New track*, *Try another source* and *Discard* — clears `activeJobId`, and `useJobEvents`'
cleanup fires the beacon: the server cancels a job still running (keeping its files) and deletes a
finished one. Lays the screens out in exactly one viewport (`h-dvh`, overflow hidden): `main` is
`flex-1 min-h-0` with 20px top, `--space-8` (22.4px) sides and a bottom of 8px on the landing screen
or 20px elsewhere, around a full-height 1120px column, with 12px side gutters and 12px top from
`max-[720px]:` utilities below 720px. **The one-row `Footer` renders only on the landing screen**
(`activeJobId === null`); processing, failure and results keep the whole viewport.
**See:** [../architecture/web.md](../architecture/web.md)

---

## `src/api/`

### `src/api/client.ts` — the only module that knows the API exists (166 lines)
**Exports:** types `JobStatus`, `Job`, `ChordSegment`, `LyricsLine`, `Lyrics`; class `ApiError`;
functions `createJob`, `createJobFromUrl`, `getJob`, `cancelJob`, `resumeJob`, `getChords`,
`getLyrics`, `saveLyrics`; URL builders `jobEventsUrl`, `cancelJobUrl`, `discardJobUrl`, `stemUrl`,
`stemDownloadUrl`, `thumbnailUrl`, `downloadAllUrl`
**Imports from:** —
**Used by:** `App`, `useJobEvents`, `useLyrics`, `components/CoverArt`, `design/stages` (type),
`utils/lyrics` (type), `processing/ProcessingScreen` (type), `results/ResultsScreen`,
`results/ResultsTopbar` (type), `results/ChordBar` (types), `results/ExportDialog`,
`results/LyricsDialog`
**Notes:** `API_BASE` is the literal `"/api"`. **`createJob` is a plain multipart `fetch`, so an
upload reports no progress** — the landing screen reads *Submitting…* until the response. Both
create calls go through the private `post`, which turns a `fetch` that rejects (no response at all)
into an `ApiError` with status 0 and a sentence; a 413 comes from nginx as HTML, so `createJob` maps
it to a sentence too. `ApiError` carries the HTTP status (`useJobEvents` needs to
tell a 404 from a 502). `detailOf` accepts only a string `detail` — FastAPI's 422 carries a list.
**`getLyrics` maps 404 → `null`** rather than throwing, because "no lyrics" is a normal outcome.
`cancelJobUrl` has no caller outside `cancelJob`. **Two URLs per stem:** `stemUrl` is the stored
`.flac`, which only `ResultsScreen` fetches, for playback; `stemDownloadUrl` is the `.wav` the server
converts as it streams, which only `ExportDialog` fetches. Every interface here is hand-mirrored from
`server/app/models/schemas.py`.
**See:** [../api/contract-sync.md](../api/contract-sync.md)

---

## `src/audio/`

### `src/audio/playbackEngine.ts` — the audio truth (633 lines)
**Exports:** `StemInput`, `StemLoadFailure`, `LoopRegion`, `MeterReadings`,
`createMeterReadings`, `PlaybackEngine`
**Imports from:** `audio/meters`, `audio/stretchProcessor.js` (as a URL, via `?url`)
**Used by:** `results/ResultsScreen`; `results/ConsoleView` and `results/AnalogView`
(`createMeterReadings` and the `MeterReadings` type)
**Notes:** a plain class, no React. One `AudioContext`. Per stem: source → lowshelf → highshelf (the
Tone tilt, around `StemInput.tonePivotHz`) → gain (fader × mute/solo) → `StereoPannerNode` → master,
with a splitter and two `AnalyserNode`s tapped after the panner. The master feeds the destination, a
peak/correlation/true-peak analyser pair, and a K-weighting `IIRFilterNode` chain into a loudness
pair; `metronomeGain` connects **straight to the destination**, bypassing master volume.
**`load()` resolves with the stems that failed** (`{name, url, message}` — the HTTP status and any
string `detail`, or the decode error) instead of rejecting, and **reports no progress**: each stem
is fetched whole, then decoded. A retry calls it again with inputs rebuilt from the failures, since
a failure carries no `tonePivotHz`. It checks `disposed` after every await (`StrictMode`
double-invokes the mount effect). Position is derived, never stored:
`anchorTrackTime + (currentTime − anchorContextTime) × rate`, wrapped into the loop;
`transportToken` makes an overtaken asynchronous `play()` abandon itself. At 1× stems are
`AudioBufferSourceNode`s (sample-locked by construction; loops use their native `loop` points, so
`clearLoop()` is seamless). At any other rate a `chord-stretch` `AudioWorkletNode` is created lazily
with one output per stem — its stem list is fixed at creation — and fed one-second blocks: ahead of
every start (from 1 s before the position to 4 s × rate after it, plus around a loop's start), then
whenever the worklet asks. **`supportsTimeStretch` requires `AudioContext.audioWorklet`, which
browsers expose only to secure origins**; it also turns false if the module fails to load, and
`play()` then falls back to 1×. The metronome is a lookahead scheduler (a 25 ms timer booking clicks
120 ms ahead) over `trackPieces`, which cuts context time at loop wraps — so clicks follow loops and
speed; beat one is still track time zero. Momentary loudness measures the last 400 ms of a
32768-sample analyser buffer; above 81.9 kHz that is more than the buffer holds, so it measures the
whole buffer. Every gain, pan and tone change goes through `setTargetAtTime` (15 ms). `dispose()`
must be called — browsers limit open contexts. `getStemState()`, `loopRegion` and
`isMetronomeEnabled` have no callers.
**See:** [../architecture/audio-playback.md](../architecture/audio-playback.md)

### `src/audio/meters.ts` — measurement math and ballistics (177 lines)
**Exports:** `IirCoefficients`, `kWeightingFilters`, `peakOf`, `meanSquareOf`, `truePeakOf`,
`correlationOf`, `loudnessFromMeanSquares`, `LevelFollower`, `Smoother`
**Imports from:** `utils/levels`
**Used by:** `audio/playbackEngine`, `results/ConsoleView` (`LevelFollower`), `results/AnalogView`
(`LevelFollower`, `Smoother`)
**Notes:** pure functions and two small stateful classes, no audio nodes. `kWeightingFilters`
derives the BS.1770 shelf and RLB high-pass for **any** sample rate (the spec tabulates 48 kHz only)
the way libebur128 does. `truePeakOf` interpolates three in-between positions with 12-tap
Hann-windowed sinc kernels — display-grade, not a certified true-peak meter. `correlationOf` returns
`null` below an energy floor, where the value would be noise. `LevelFollower.update` takes a
**linear** peak and returns dB: instant attack, linear release in dB/s, optional hold, and anything
under −90 dB reads as −∞. `Smoother` leaves its value alone on a `null` input.
**See:** [../features/metering.md](../features/metering.md)

### `src/audio/stretchProcessor.js` — the time-stretch worklet (286 lines)
**Exports:** — (registers the `chord-stretch` processor in `AudioWorkletGlobalScope`)
**Imports from:** —
**Used by:** `audio/playbackEngine` (loaded by URL with `audioWorklet.addModule`)
**Notes:** **plain JavaScript** — it runs in the worklet scope, is not bundled, and `tsc` never sees
it. WSOLA: 60 ms frames on a 30 ms hop with a periodic Hann window, ±15 ms similarity search
(every 4th offset, then refined). Similarity is measured on a gain-weighted mix of the audible
stems and **every stem is cut at the same positions**, which is what keeps them sample-aligned at
any speed. It holds no song: every 8th hop it works out the one-second blocks the next 3 s will
read, posts `need` for the missing ones (asking again after 1 s), and — only once more than 12 are
cached — drops the blocks it no longer needs; needed blocks and arrivals are never capped. A block
that hasn't arrived plays as silence. The `start` message carries an absolute `when`, so output
begins on an exact frame. Messages in: `blocks`, `weights`, `start`, `stop`. `process()`'s
per-quantum path allocates nothing — indexed loops rather than `for…of` or `subarray()`, because
garbage collection on the audio thread is heard as dropouts; working out and posting a `need`
request every 8th hop is the one place that allocates.
**See:** [../features/speed-and-loop.md](../features/speed-and-loop.md)

---

## `src/styles/`

### `src/styles/nocturne.css` — the design system's tokens and base components (295 lines)
**Used by:** `main.tsx`
**Notes:** vendored from the design template's Nocturne sheet, **minus its Google Fonts
`@import`** — bundled after other CSS it would be invalid, so `index.html` loads Inter instead. The
template is gone, so this copy is owned here now.
Defines `--color-*` (the neutral and accent ramps), `--font-*`, `--space-*`, `--radius-*`,
`--shadow-*`, global element rules (box-sizing, heading scale, the `:focus-visible` accent ring,
`::selection`), and the classes `.btn`, `.input`/`.field`, `.tag`, `.card`, `.dialog*`, `.hr`,
`.radio`, `.seg*`, `.nav*`, `.table`, `.elev-*`, `.text-muted` and `.lighten`. Colors, type and
spacing go through these tokens; geometry the template's harness wrote inline (paddings, column widths)
was copied into the components as literals, the way the harness had it. With `chord-theme.css` it is
the vocabulary `scripts/check-design.mjs` checks against: a token or owned class neither sheet
defines fails lint.

### `src/styles/chord-theme.css` — the `ch-` component layer (611 lines)
**Used by:** `main.tsx`
**Notes:** vendored **unmodified** from the design template, which is gone, so this copy is owned
here now; record any change to it here. Every `ch-` class the screens use; the stem hues
`--ch-vocals` … `--ch-other` and the two status hues; the panel and well surfaces. Components pass
runtime state through custom properties — **`--v`** (control position), **`--l`** (meter level),
**`--p`** (playback position), **`--stem`** (hue), the only four `check-design.mjs` lets a component
set — though some geometry is still set inline (chord segments' `flex`, the waveform's
`clip-path`). Its one breakpoint, `@media (max-width: 720px)`, stacks `.ch-stemrow` — the name on
the first line, then level, routing (toggles at a 44px hit height) and waveform on lines of their
own — which is the phone Mixer; **`PHONE_QUERY` uses the same width**. Unused by the app: `.ch-nav*`
(the template harness's chrome), `.ch-scale`, `.ch-wave-a/-b/-c` (placeholder envelopes, replaced by
`utils/peaks`), `.ch-m-stem` (the phone frame's stem card) and `.ch-lyric-past`.
**See:** [../features/theming.md](../features/theming.md)

---

## `src/hooks/`

### `src/hooks/useJobEvents.ts` — one job's live status (162 lines)
**Exports:** `useJobEvents`, `ConnectionState`, `MAX_RECONNECT_ATTEMPTS`
**Imports from:** `api/client`, `design/stages`
**Used by:** `App`
**Notes:** returns `{ job, connection, stageSnapshots, reconnect }`. The discard beacon lives in
**its own effect keyed on `jobId` alone**, so reconnecting can never fire it; it runs on `pagehide`
and on cleanup, once an update for the job has been delivered. The server cancels a still-running
job and deletes a finished one — which is why leaving a job cleans it up, and why Fast Refresh
re-running effects in development can discard the job on screen. The subscription effect
(`[jobId, generation, deliver]`; `deliver` is stable) calls `getJob` then opens an `EventSource`; a
stream error on a non-terminal job schedules a retry with backoff (1 s doubling to 10 s,
`MAX_RECONNECT_ATTEMPTS = 10`), a 404 fails at once with `notFound`, and any message resets the
count. `stageSnapshots` keeps the first update seen in each processing stage (indexed by
`processingStage`); `reconnect(latest)` shows a just-returned job at once and restarts the
snapshots. State is stored with its job id and filtered on read, instead of being reset in an
effect. `TERMINAL_STATUSES` here must match the server's set.
**See:** [../architecture/web.md](../architecture/web.md)

### `src/hooks/useLyrics.ts` — fetch lyrics once (29 lines)
**Exports:** `useLyrics`
**Imports from:** `api/client`
**Used by:** `results/ResultsScreen`
**Notes:** returns `[lyrics, replaceLyrics]` where `lyrics` is `Lyrics | null | undefined` —
**`undefined` = loading, `null` = none**, documented in its doc comment. A lookup that fails for any
other reason (a network error, a 5xx) also becomes `null`, so it reads as *None found for this
track.* with *Add lyrics manually*. The result is stored with its job id, so another job reads as
loading until its own lookup answers. The setter takes lyrics saved from `LyricsDialog`.

### `src/hooks/useMediaQuery.ts` — live `matchMedia` boolean (16 lines)
**Exports:** `useMediaQuery`
**Used by:** `landing/LandingScreen`, `processing/ProcessingScreen`, `results/ResultsScreen` — all
with `PHONE_QUERY` from `design/layout`. `ResultsScreen` also asks
`"(prefers-reduced-motion: reduce)"`.

### `src/hooks/usePopover.ts` — click-toggled popover state (25 lines)
**Exports:** `usePopover<T>`
**Used by:** `results/Transport` (the speed chip)
**Notes:** returns `{open, setOpen, containerRef}`; closes on an outside `pointerdown` or Escape,
with listeners attached only while open. Destructure it — reading `.open` off the returned object
trips the React refs lint.

### `src/hooks/useSeekDrag.ts` — click-or-drag seeking (35 lines)
**Exports:** `useSeekDrag`
**Used by:** `results/ChordBar`, `results/Transport`
**Notes:** the element it's attached to defines 0–100%. Ignores non-primary buttons,
`preventDefault()`s to stop text selection, captures the pointer for the drag, handles
`pointercancel`, and does nothing while `duration <= 0`.

### `src/hooks/useSliderControl.ts` — pointer and keyboard for 0…1 controls (95 lines)
**Exports:** `useSliderControl`, `SliderAxis`
**Imports from:** —
**Used by:** `controls/Fader`, `controls/Knob`
**Notes:** returns pointer handlers and `onKeyDown`, spread onto the element. `horizontal` maps
pointer x across the element, `vertical` maps `(bottom − y) / height` (the formula
the design template gave), `knob` is **vertical drag, 160 px for the full range** — rotational drag
is unusable with a mouse — and doesn't jump on press. Keys: arrows ±0.01, Shift ±0.1,
PageUp/PageDown ±0.1, Home/End. **There is no default value and no double-click reset.** Values are
rounded to 0.001 so arrow steps don't accumulate float noise into `aria-valuenow`. A press focuses
the element, because its `preventDefault()` would otherwise cancel the focus keyboard control needs.

### `src/hooks/useAnimationFrame.ts` — a rAF loop while active (24 lines)
**Exports:** `useAnimationFrame`
**Used by:** `results/ConsoleView`, `results/AnalogView`, `hooks/useClockValue`, `hooks/usePlayhead`
— all pass `active = true`, so their loops run whenever the component is mounted, paused or not
**Notes:** calls the latest `onFrame` (held in a ref) every frame while `active`. The loop depends
only on `active`, so a new callback on every render never restarts it. For displays that write
straight to the DOM: a custom-property write per frame is cheap, a re-render per frame of a whole
view is not. Each caller runs a loop of its own — a playing Mixer runs one per waveform playhead
plus the chord bar's and transport's.

### `src/hooks/useClockValue.ts` — a clock-derived value that renders only on change (13 lines)
**Exports:** `useClockValue<T extends string | number>`
**Imports from:** `hooks/useAnimationFrame`
**Used by:** `results/ChordBar`, `results/Transport`
**Notes:** calls `read()` every animation frame and stores the result with `setState`, which bails
out without rendering when the value is unchanged — so a whole-second readout renders once a second
and a chord index once per boundary, although the clock moves every frame. `T` is a primitive on
purpose: a new object each frame would render every frame. `read` runs **every frame, paused
included**, so it must be cheap. The value is a frame behind a prop change that affects `read` (new
segments, replaced lyrics) — callers guard their indexes for that frame.

### `src/hooks/usePlayhead.ts` — `--p` written straight to the DOM (23 lines)
**Exports:** `usePlayhead<T extends HTMLElement>`
**Imports from:** `hooks/useAnimationFrame`
**Used by:** `controls/StemWaveform`, `results/ChordBar`, `results/Transport`
**Notes:** returns a ref; every animation frame, and in a `useLayoutEffect` after every render (so a
playhead mounted while paused is in place before its first paint), it writes `progress()` to the
element's `--p` with `toFixed(4)`, **skipping the write when the value is unchanged**, so a paused
playhead restyles nothing. The element must not set `--p` in its JSX — React would write it back.
The same bypass the meters use for `--l`.

### `src/hooks/useElementWidth.ts` — an element's width (15 lines)
**Exports:** `useElementWidth<T>`
**Used by:** `results/ChordBar`
**Notes:** returns a **callback ref** (with React 19's cleanup return) plus the width a
`ResizeObserver` reports — a callback ref, so it works on elements that mount later.

---

## `src/utils/`

Pure functions, one subject per file.

### `src/utils/time.ts` — `formatTime(seconds)` (11 lines)
**Used by:** `processing/ProcessingScreen`, `results/ResultsTopbar`, `results/ChordBar`,
`results/Transport`
**Notes:** `"3:51"` (`"0:00"` for non-finite), with 5 ms of slack before flooring: decoding at a
device rate other than a stem's own can leave it a frame short — a 36-second track decodes to
35.99998 s at 44.1 kHz — which would otherwise read 0:35.

### `src/utils/tempo.ts` — `formatBpm(bpm)` (4 lines)
**Used by:** `results/AnalysisBar`
**Notes:** a whole tempo without a decimal, anything else to one.

### `src/utils/transpose.ts` — `transposeChord`, `transposeKeyLabel` (24 lines)
**Used by:** `results/AnalysisBar` (`transposeKeyLabel`), `results/ChordBar` (`transposeChord`)
**Notes:** `NOTE_NAMES` here **duplicates** the array in `server/app/pipeline/chords.py` — both
must stay sharps-only. `transposeChord` shifts only a label that has a root, so `"N"` (no chord)
comes back unchanged; `results/ChordBar` checks for `N` itself, showing *—* as the current chord and
no label on the strip. The `((i + n) % 12 + 12) % 12` double modulo is required
because JS `%` keeps the sign.
**See:** [../features/transpose.md](../features/transpose.md)

### `src/utils/lyrics.ts` — `currentLineIndex(lines, time)` (11 lines)
**Imports from:** `api/client` (type)
**Used by:** `results/ChordBar`
**Notes:** −1 before the first line. A linear scan relying on sorted times with an early `break`,
run from the chord bar's `useClockValue` — every animation frame, playing or paused, while synced
lyrics are showing.

### `src/utils/hasVocals.ts` — `detectHasVocals(buffer)` (14 lines)
**Used by:** `results/ResultsScreen`
**Notes:** the RMS of channel 0 over every 8th sample (`SAMPLE_STRIDE`), against
`SILENCE_RMS_THRESHOLD = 0.01`. Instrumentals separate into a **near-silent** vocals stem rather
than an absent one; a silent one starts muted and is marked by a hint under the lyric row (in every view) and, while it
stays muted, the Console strip's *Silent* label. The lyric row still renders.

### `src/utils/download.ts` — `downloadFile(url, filename)` (14 lines)
**Used by:** `results/ExportDialog`
**Notes:** fetch → blob → object URL → synthetic `<a download>` → revoke. Chosen over a plain link
so the client can **name the file** (stems arrive with no `Content-Disposition`, and the zip's
names the raw job id), **detect failure** (a non-ok response throws), and show an in-flight label.
Buffers the whole file in memory.

### `src/utils/levels.ts` — level, pan and tone math and formatting (67 lines)
**Exports:** `MINUS`, `dbToGain`, `gainToDb`, `formatDb`, `formatSigned`, `Anchors`,
`mapThroughAnchors`, `PAN_CENTER`, `panToStereo`, `formatPan`, `TONE_FLAT`, `TONE_RANGE_DB`,
`toneToShelfDb`, `formatTone`
**Imports from:** —
**Used by:** `audio/meters`, `design/player`, `results/ResultsScreen`, `results/AnalysisBar`,
`results/ConsoleView`, `results/ConsoleStrip`, `results/MasterStrip`, `results/AnalogView`,
`results/AnalogModule`
**Notes:** generic math only — the fader tapers, `FADER_RANGE_DB` and the meter scales are the
design's, and live in `design/player.ts`. Those scales are anchor lists for `mapThroughAnchors`, a
clamped piecewise-linear map whose `!(value > first)` test also catches −∞. `formatDb` uses
**U+2212** (`MINUS`), not a hyphen, so readouts align on tabular numerals, and folds `-0.0` to
`0.0`; `formatSigned` does the same for readouts whose sign matters (transpose, correlation, tone).
Pan positions read `C`/`L14`/`R8`; the Tone knob's extremes shelve highs by ±6 dB (`TONE_RANGE_DB`)
and lows by the opposite.

### `src/utils/peaks.ts` — `waveformPolygon(buffer, bins = 160)` (37 lines)
**Used by:** `results/ResultsScreen`
**Notes:** a CSS `polygon()` — top edge left→right, bottom edge right→left — used as `clip-path` on
`.ch-wave`, replacing the template's placeholder envelopes. Peaks over every 8th sample, lifted with
a square root so quiet stems still show a shape, with a 2% half-height floor so silence reads as a
thin band. Recomputed for every loaded stem each time a load finishes, a retry included.

### `src/utils/clipboard.ts` — `copyText(text)` (18 lines)
**Used by:** `App`
**Notes:** `navigator.clipboard`, falling back to a hidden textarea and `execCommand("copy")` —
the async Clipboard API is missing on plain-HTTP origins other than localhost.

---

## `src/design/` — the design's vocabulary in code

Everything the design defines that isn't CSS. Screens and controls take their words, state
shapes, tapers and stem identities from here rather than writing their own;
[../conventions/design.md](../conventions/design.md) explains the rules.

### `src/design/copy.ts` — every rendered string (232 lines)
**Exports:** `countWord`, `brand`, `stemNames`, `landingCopy`, `processingCopy`, `resultsCopy`,
`failureCopy`, `dialogCopy`, `footerCopy`
**Imports from:** —
**Used by:** `App`, `components/Footer`, `controls/RoutingToggles`, `design/stages`,
`design/stems`, `landing/LandingScreen`, `processing/ProcessingScreen`, `results/ResultsScreen`,
`results/ResultsTopbar`, `results/AnalysisBar`, `results/ChordBar`, `results/Transport`,
`results/MixerView`, `results/StemRow`, `results/ConsoleStrip`, `results/MasterStrip`,
`results/AnalogView`, `results/AnalogModule`, `results/OutputDial`, `results/ExportDialog`,
`results/LyricsDialog`
**Notes:** strings are verbatim from the design template's harness unless they sit under an
*App-authored* comment — states the template didn't draw: empty files, busy and failure states,
accessible names, both dialogs and the footer. Two template lines are **reworded by decision**,
each marked: the *Cancelled* body (the template promised a 24-hour queue) and *Connection lost*'s
secondary action, *New track* in place of *Work offline*. Grouped by screen; values that need data
are functions (`rejectedBody(fileName)`, `levelLabel(stem, value)`), and `failureCopy` is keyed by the state ids in
[Screens and their states](../conventions/design.md#screens-and-their-states). **Some strings restate server facts and must change with them:**
`processingCopy.stages` is `PROCESSING_STAGES`, whose last four labels are the server's
`stage_message` strings; *up to 12 minutes* (`dropHint`, `phoneDropHint`) is
`max_duration_seconds`' default; *44.1 / 48 kHz preserved* is `_PRESERVED_SAMPLE_RATES`; *MP3 or
FLAC* and the rejection copy are `ALLOWED_UPLOAD_EXTENSIONS`; and *six* stems (`intro`)
and the stem list (`stemsHint`) are the Demucs model. `stemNames` is
read by key, through `stemName` in `design/stems`. `countWord` spells counts up to six only (the
stem-failure body); `footerCopy.copyright` hardcodes the author's name.
**See:** [../conventions/design.md](../conventions/design.md)

### `src/design/player.ts` — the design's state model and what derives from it (86 lines)
**Exports:** types `StemKey`, `StemState`, `ResultView`, `PlayerState`; `MIN_TRANSPOSE`,
`MAX_TRANSPOSE`, `FADER_RANGE_DB`, `db`, `masterDb`, `fmtDb`, `audible`, `STEM_METER_SCALE`,
`MASTER_METER_SCALE`
**Imports from:** `utils/levels`
**Used by:** `design/stems` (type), `results/ResultsScreen`, `results/playerReducer`,
`results/types` (types), `results/ResultsTopbar` (type), `results/AnalysisBar`, `results/StemRow`,
`results/ConsoleView`, `results/ConsoleStrip`, `results/MasterStrip`, `results/AnalogModule`
**Notes:** design.md's [State](../conventions/design.md#state) as types. `StemState` and `PlayerState` hold **0…1 UI positions,
not dB** (gain, tone, pan, master); everything else is derived, never stored, under the template's
own function names. **`PlayerState` has no playback position**: `PlaybackEngine`'s clock is read
every frame where it's shown (`useClockValue`, `usePlayhead`). `StemKey` is the design's six stems. **Two fader tapers, each matching its
strip's ticks.** `db()` maps a stem position linearly onto −36…0 dB with the bottom silent — the
scale of the `0 / −12 / −24 / −∞` `TICKS` in `results/ConsoleStrip`, so change `FADER_RANGE_DB`
and those labels together (the template's demo used −12…0 and asked for the audio graph's own
taper). `masterDb()` goes through `MASTER_TICKS`, the master strip's `0 / −6 / −18 / −∞`, giving the
top of the travel more room; `MASTER_METER_SCALE` is those anchors inverted, so master fader, meter
and ticks can't drift apart, while `STEM_METER_SCALE` is written out to match the stem ticks.
`fmtDb(v, muted)` reads *−∞* for a muted stem. `audible()` — not muted, and nothing soloed or this
one — puts **mute over solo**, as `isAudible()` in the engine does; it dims the Mixer's waveforms,
but the Console strip's label and the strip and module panels show solo first instead (see
`results/ConsoleStrip`). `MIN_TRANSPOSE` / `MAX_TRANSPOSE` are ±11: twelve semitones is the same
pitch class.

### `src/design/stems.ts` — stem identity (46 lines)
**Exports:** `STEM_KEYS`, `templateStems`, `stemName`, `stemHue`, `tonePivotHz`
**Imports from:** `design/copy`, `design/player` (type)
**Used by:** `results/ResultsScreen`
**Notes:** `STEM_KEYS` is vocals, drums, bass, guitar, piano, other — the design's order, and
`STEM_NAMES`'. **`templateStems(names)` keeps only the job's stems that are in `STEM_KEYS`, in that
order, so a stem outside the six is never loaded**, played or offered for single download (the zip
still carries it): the design has no name or hue for it. Change `STEM_KEYS` with the Demucs model.
`stemHue` reads `STEM_HUES`, which writes each `var(--ch-<key>)` out: it's a `Record<StemKey, string>`,
so a key without a hue doesn't compile, and `check-design.mjs` fails a hue token `chord-theme.css`
doesn't define. Each stem's Tone pivots near the middle of
its instrument's range (bass 250 Hz, piano and other 1 kHz, guitar 1.2 kHz, vocals 1.5 kHz, drums
2 kHz).

### `src/design/stages.ts` — the processing stage contract (30 lines)
**Exports:** `PROCESSING_STAGES`, `QUEUED_STAGE`, `SEPARATING_STAGE`, `DETECTING_CHORDS_STAGE`,
`processingStage`
**Imports from:** `api/client` (type), `design/copy`
**Used by:** `processing/ProcessingScreen`, `useJobEvents`
**Notes:** `PROCESSING_STAGES` is `processingCopy.stages`: five labels, of which the last four
double as the server's `stage_message` strings — a queued row has no stage message, so *Queued*
exists only here. `processingStage` maps a job to an index (`fetching` is a bare `1`, with no
constant) and returns the list's length for any status past processing. Tempo detection runs under
`separating`, so only its stage message tells *Detecting tempo* apart — rename that label and the
stage is never recognised. Adding a status means updating this switch. `DETECTING_TEMPO_STAGE` is
module-private.

### `src/design/layout.ts` — the breakpoint (7 lines)
**Exports:** `PHONE_QUERY`
**Imports from:** —
**Used by:** `landing/LandingScreen`, `processing/ProcessingScreen`, `results/ResultsScreen`
**Notes:** `"(max-width: 720px)"`, the design's one breakpoint. Its comment names every place that
must agree: `@media (max-width: 720px)` in `chord-theme.css`, and the `max-[720px]:` utilities in
`App.tsx`, `results/MixerView` (its column labels) and `results/AnalysisBar` (its dividers).

---

## `src/components/` — the pieces the screens share

### `src/components/FitToPanel.tsx` — scale a view to its panel (65 lines)
**Exports:** `FitToPanel`
**Used by:** `results/ResultsScreen`
**Notes:** fills the results view panel (`flex-1 min-h-0`, overflow hidden) and, **only when the view
doesn't fit**, scales it down uniformly with `transform: scale()` from the top-left, widening it by
the inverse scale so it still spans the panel — nothing is cropped and nothing scrolls. The scale is
`min(1, panel height / content height, panel width / minWidth)`, recomputed by a `ResizeObserver` on
both elements: unscaled, the content grows to fill the panel (`flex: 1 0 auto`), so it only reads
taller when the view is; scaled, it keeps its natural height (`flex: none`), and `offsetHeight`
ignores the transform, so the view can be measured at any scale. Changes under 0.005 are ignored.
`minWidth` is the view's stylesheet floors summed (`VIEW_MIN_WIDTH` in `ResultsScreen`), so the
strips, modules and dials never lay out below them. `enabled={false}` (phones) renders the view
unscaled and leaves scrolling to the panel. Pointer maths through `getBoundingClientRect` already
follows the transform; a `position: fixed` descendant would be positioned against it, and there is
none. The template's `ScreenCard`, the card every screen once sat on, is gone: every screen now sits
on the page ground.

### `src/components/CoverArt.tsx` — the artwork tile (42 lines)
**Exports:** `CoverArt`
**Imports from:** `api/client`
**Used by:** `processing/ProcessingScreen`, `results/ResultsTopbar`
**Notes:** the accent-gradient tile the template's harness drew, with the thumbnail drawn through Nocturne's
`.lighten` (dark artwork falls into the gradient). Hides the image if it fails to load. The hairline
edge is an overlay, so the image can't cover it, and is drawn only when `outlined` (the default) —
the phone processing screen passes `false`, as the harness's phone tile had none.

### `src/components/Dialog.tsx` — modal (89 lines)
**Exports:** `Dialog`
**Used by:** `results/ExportDialog`, `results/LyricsDialog`
**Notes:** Nocturne's `.dialog` over `.dialog-backdrop`, given `z-index: 50` inline (the speed
popover sits at 20). Focuses `[data-autofocus]` or the first focusable element, traps Tab, closes on
Escape or a press on the backdrop, and restores focus on unmount. `onClose` is read through a ref so
the focus effect runs once. `width` widens it past Nocturne's 440px.

### `src/components/Footer.tsx` — footer links (70 lines)
**Exports:** `Footer`
**Imports from:** `design/copy`
**Used by:** `App`
**Notes:** the template had no footer; this one is kept by decision. GitHub, a bug-report `mailto:`
and Ko-fi as Nocturne ghost icon buttons (`.btn-icon`), plus `footerCopy.copyright` —
`© <year> Ormin Cariaso · v{__APP_VERSION__}`, on one wrapping row so it takes as little of the
unscrolled page as it can. In the page flow (`flex-none` under `main`), not fixed, and **rendered on
the landing screen only** — `App` drops it once a job is active. Hardcodes the author's
URLs and email.

### `src/components/icons.tsx` — shared inline SVG (72 lines)
**Exports:** `UploadIcon`, `PlusIcon`, `PlayIcon`, `PauseIcon`, `MetronomeIcon`, `StopIcon`, `AlertIcon`,
`CheckIcon`
**Used by:** `landing/LandingScreen` (`UploadIcon`), `processing/ProcessingScreen` (`CheckIcon`),
`failure/FailurePanel` (`StopIcon`, `AlertIcon`), `results/ResultsTopbar` (`PlusIcon`),
`results/Transport` (`PlayIcon`, `PauseIcon`, `MetronomeIcon`)
**Notes:** the template harness's paths — plus `StopIcon` and `AlertIcon`, app-authored in the same
24px, 1.6–1.8 stroke style for the failure panel's mark — drawn in `currentColor` except `CheckIcon`, whose stroke is the
`color` it is given — the accent for a done stage, transparent otherwise.

---

## `src/components/controls/` — the instrument controls

### `controls/Fader.tsx` — `Fader` and `VerticalFader` (54 lines)
**Exports:** `Fader`, `VerticalFader`
**Imports from:** `hooks/useSliderControl`
**Used by:** `results/AnalysisBar` and `results/StemRow` (`Fader`, always `thin`);
`results/ConsoleStrip` and `results/MasterStrip` (`VerticalFader`)
**Notes:** `.ch-fader` (optionally `.ch-fader-thin`) and `.ch-vfader` with its cap child, positioned
by `--v` alone. `role="slider"` with `aria-valuetext` and a label that carries the value. No
default value: only a drag or the keyboard moves a fader. Both assume a flex parent — the classes
set no `display`.

### `controls/Knob.tsx` — `.ch-knob` (35 lines)
**Exports:** `Knob`
**Imports from:** `hooks/useSliderControl`
**Used by:** `results/AnalogModule`
**Notes:** the class draws cap, pointer and arc from `--v`; `small` is `.ch-knob-sm`, the 34px
Tone/Pan size, and `hue` overrides `--stem`, so only a Level knob carries the stem color. No default
value or reset.

### `controls/RoutingToggles.tsx` — MUTE / SOLO (36 lines)
**Exports:** `RoutingToggles`
**Imports from:** `design/copy`
**Used by:** `results/StemRow`, `results/ConsoleStrip`, `results/AnalogModule`
**Notes:** a fragment of two text buttons (`.is-on-muted` / `.is-on`) with `aria-pressed`; each
parent supplies the element they sit in. `stem` is the display name, used only for the accessible
names (*Mute Vocals*), which contain the visible text.

### `controls/StemWaveform.tsx` — `.ch-wave` (24 lines)
**Exports:** `StemWaveform`
**Imports from:** `hooks/usePlayhead`
**Used by:** `results/StemRow`
**Notes:** the bar pattern clipped (`clip-path`) to the stem's real envelope from `utils/peaks`,
`.is-off` while the stem isn't heard, with a `.ch-playhead` beside it in an `aria-hidden`
wrapper (the clip would cut a child away). It takes `progress: () => number`, not a position, and
`usePlayhead` writes the playhead's `--p` every frame, so playback never renders the row. The wrapper carries `order-5` and a full basis, standing
in for the stylesheet's phone rule on `.ch-wave`. **Display only** — it doesn't seek; the chord
strip and the transport do.

---

## `src/screens/` — one folder per screen

Each screen renders its states from
[Screens and their states](../conventions/design.md#screens-and-their-states) and takes every string
from `design/copy`; together they are the design's reference implementation.

### `src/screens/landing/LandingScreen.tsx` — the landing screen (250 lines)
**Exports:** `LandingScreen`, `Submission`, `SubmitError`
**Imports from:** `components/icons`, `design/copy`, `design/layout`, `hooks/useMediaQuery`
**Used by:** `App`
**Notes:** one centered column on the page ground, grown
(`flex-1 min-h-0`) to fill `main` and vertically centered above the footer, its padding and gaps
`clamp()`ed to `vh` so a short window tightens it rather than scrolling. The `upload`, `upload-submitting`
and `upload-error` states, in two arrangements: web, and the phone layout below 720px — no *Choose file* button (the column dropzone is
itself the control: `role="button"`, Enter or Space), a full-width *Fetch track*, no intro paragraph
or divider. Client-side rejection of anything but `.mp3`/`.flac` (`ACCEPTED_EXTENSIONS`, plus the
input's `accept`), and of empty files, **before any request**: the dropzone turns `.is-rejected`
and names the file, and an alert explains. Server failures arrive through `error`; a rejection's
alert takes the place of a server error's. *Submitting…* replaces the label of the button that sent
the request (`Submission`) — on phones the one *Fetch track* button shows it for a file too — and
every control is disabled while busy; there is no upload progress. The URL input is `required`, so
the button stays enabled, as the template harness's did. `Track URL` renders at 12px because
Nocturne's `.field > label` outranks `.ch-label` — as it did in the harness.
**See:** [../features/ingest.md](../features/ingest.md)

### `src/screens/processing/ProcessingScreen.tsx` — live progress (162 lines)
**Exports:** `ProcessingScreen`
**Imports from:** `api/client` (type), `components/CoverArt`, `components/icons`, `design/copy`,
`design/layout`, `design/stages`, `hooks/useMediaQuery`, `utils/time`
**Used by:** `App`, **and `results/ResultsScreen`** (as its stem-loading screen, via `loading`)
**Notes:** like `LandingScreen`, one centered 460px column on the page ground,
grown (`flex-1 min-h-0`) and vertically centered, with `vh`-clamped padding and gaps — cover art, title and meta, then a large percentage over
the stage message and bar, the stage list, and *Cancel* at the foot. The `processing-*` states. The fixed five-stage list: stages before the
current one are `.is-done`, and a skipped stage shows done rather than disappearing. A done stage's
time is the gap between the server `updated_at` of the first update seen in it and in the next
stage seen (`stageSnapshots`), searching up to and including the job's completion snapshot (index
`PROCESSING_STAGES.length`) — *Queued* starts at `job.created_at` — so **no client clock is
involved** and render stays pure. Tempo and chord detection that finished during separation are
never seen as stages, so *Separating stems* ends at the next snapshot that exists, and a step never
seen shows done with no time. No hint or time-remaining estimate sits under the bar. The phone
layout shows no stage times, ticks or format, an 88px tile without its hairline, and a full-width
*Cancel*. With `loading` it shows *Loading stems…* at 100% with the last stage current — no download
progress, since the engine reports none — and `ResultsScreen` passes on
the same `stageSnapshots`, so the done stages keep their times; its *Cancel* is then
`ResultsScreen`'s `onBack`, which discards the finished job.
**See:** [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md)

### `src/screens/failure/FailurePanel.tsx` — failure states (100 lines)
**Exports:** `FailurePanel`, `FailureTone`, `FailureAction`
**Imports from:** `components/icons`
**Used by:** `App`, `results/ResultsScreen`
**Notes:** the `job-error`, `job-cancelled`, `connection-error` and `results-load-error` states:
`.ch-alert` + optional `.ch-log` (newlines kept — a stem failure logs one request per line) + a
primary and optional secondary action, centered and wrapping. Like `LandingScreen` and
`ProcessingScreen` it is one centered 480px column on the page ground, grown
(`flex-1 min-h-0`) and vertically centered, with `vh`-clamped padding and gaps. The log is cut at
`30vh` (overflow hidden) so a long traceback never scrolls the page; *Copy log* still copies all of
it. Above the title (an `h1`, 32px) sits a 56px `.ch-dropicon`
mark; **there is no status dot**. The tone picks the mark — `StopIcon` for `neutral`, `AlertIcon`
otherwise, in `--color-neutral-300` — and the hue of the mark's hairline ring, `--ch-danger`,
`--ch-warn` or `--color-accent-700`; nothing else is tinted. Every
one of those states has a secondary action; only *Job not found* leaves it out. The words come from the
caller. `role="alert"` announces it on mount.

---

## `src/screens/results/` — the results screen

### `results/ResultsScreen.tsx` — the results state hub (407 lines)
**Exports:** `ResultsScreen`
**Imports from:** `api/client`, `audio/playbackEngine`, `components/FitToPanel`, `design/copy`,
`design/layout`, `design/player`, `design/stems`, `hooks/useLyrics`, `hooks/useMediaQuery`,
`utils/hasVocals`, `utils/levels`, `utils/peaks`, `failure/FailurePanel`,
`processing/ProcessingScreen`, `results/AnalogView`, `results/AnalysisBar`, `results/ChordBar`,
`results/ConsoleView`, `results/ExportDialog`, `results/LyricsDialog`, `results/MixerView`,
`results/playerReducer`, `results/ResultsTopbar`, `results/Transport`, `results/types`
**Used by:** `App`
**Notes:** owns the engine and **all** playback state: `PlayerState` through
`useReducer(playerReducer)` — view, playing, duration, master, transpose, metronome and each
stem's gain, mute, solo, tone and pan — plus what the state model leaves to the app: load phase and
failures, waveform envelopes, speed and whether it's supported, loop, chords (`undefined` loading /
`null` after any failed fetch), `hasVocals`, lyrics, and which dialog is open. Every view gets the
same `StemDisplay[]` and `StemControls`, so switching views mid-song is seamless. **No card**: the
bars and view sit in a `.ch-app` column with its background dropped, on the page ground, divided only
by the bars' hairlines. The view panel between the bars is `flex-1 min-h-0` and wraps the view in
`FitToPanel`, which scales it down when the window is too short, or narrower than
`VIEW_MIN_WIDTH[view]` (the view's stylesheet floors summed: Mixer 560, Console and Analog 1020), so
nothing is cropped; below 720px scaling is off and the panel scrolls instead, where stacked stem rows
can't fit — the one scrolling region in the app. Loads only
`templateStems(job.stem_names)`. Three phases: `loading` (`ProcessingScreen` with `loading` and the
`stageSnapshots` prop `App` passes through), `failed` (*Stems failed to load* — *Retry download*
reloads only the failures, *Open anyway* shows what loaded, even when nothing did), `ready`. **The
playback position is read, never stored**: `getTime` (the engine's clock) goes to `ChordBar` and
`Transport`, and `getProgress` (0…1 of `engine.duration`) to `MixerView` as `progress` — both
stable `useCallback`s — and each display reads them every frame through `useClockValue` or
`usePlayhead`, so **playback doesn't re-render this screen**; only a component whose shown value
changed renders. Under `prefers-reduced-motion` `getTime` floors to whole seconds, so everything
that reads it (playheads, chord highlight, lyric line, time readouts) steps once a second; the meters
and needles ignore it. Its own `requestAnimationFrame` loop only pauses the engine when `hasEnded`.
`handleSeek` dispatches only `playingChanged` once the seek resolves. **Below 720px** the view is forced to the Mixer, the topbar gets no
`onViewChange` (so no tabs, and the view panel drops its `tabpanel` role) and the transport is
`compact`; the rest is the web markup, which the stylesheet and `max-[720px]:` utilities adapt. An
instrumental's silent
vocals start muted on the first load; a vocals stem that failed to load isn't treated as silent.
Seeking outside a set loop ends it, and a second loop press within 0.5 s of A is ignored. Stem
faders go through `db()` and the master through `masterDb()`; the metronome is offered only for a
non-zero tempo, speed only when `supportsTimeStretch`. The load effect depends on the stems by value
(`stemList`, the kept names joined), so a job update that carries a new array of the same stems
doesn't download them again.
**See:** [../features/results-views.md](../features/results-views.md)

### `results/playerReducer.ts` — every `PlayerState` change (58 lines)
**Exports:** `PlayerAction`, `INITIAL_PLAYER`, `playerReducer`
**Imports from:** `design/player`
**Used by:** `results/ResultsScreen`
**Notes:** the one place `PlayerState` changes. `INITIAL_PLAYER` is the Mixer, stopped, the master
at the top of its travel (0 dB), and no stems. `stemsLoaded` keeps the settings of stems already on
the mixer, so a retry that adds the stems that failed leaves the rest alone. `transposeChanged`
clamps to ±11. `playingChanged` returns the same state object when nothing changed, so a redundant
dispatch costs no render. There is no time action: the position isn't state.

### `results/types.ts` — shared shapes (30 lines)
**Exports:** `StemDisplay`, `StemControls`, `LoopState`
**Imports from:** `design/player` (types)
**Used by:** `results/ResultsScreen`, `results/MixerView`, `results/StemRow`, `results/ConsoleView`,
`results/ConsoleStrip`, `results/AnalogView`, `results/AnalogModule`, `results/Transport`
(`LoopState`), `results/ExportDialog` (`StemDisplay`)
**Notes:** `StemDisplay` is one stem as the views draw it: its `StemState` plus what the results
screen derives — display name, `--stem` hue, `audible`, `silent` (an instrumental's vocals) and the
waveform `envelope`. `StemControls` is the per-stem callback set, keyed by `StemKey`.

### `results/ResultsTopbar.tsx` — title, view tabs, actions (87 lines)
**Exports:** `ResultsTopbar`
**Imports from:** `api/client` (type), `components/CoverArt`, `components/icons`, `design/copy`,
`design/player` (type), `utils/time`
**Used by:** `results/ResultsScreen`
**Notes:** `.ch-topbar`, its chrome background overridden to transparent so only its bottom hairline
sets it off the page ground: a 44px cover tile, the title as an `h1` (the heading rule's letter-spacing
undone) over *author · length · N stems*, the view tabs, *Export stems* and *New track*. It wraps, so
the actions drop to a second line before the title truncates. The subtitle's length is the decoded
duration, not the server's, so it always matches the transport. The tablist uses roving `tabIndex`
with Arrow/Home/End keys; tab ids derive from `panelId`. **No tabs render without `onViewChange`**,
which is how phones get none; there is no other phone arrangement.

### `results/AnalysisBar.tsx` — key, transpose, tempo, master (103 lines)
**Exports:** `AnalysisBar`
**Imports from:** `controls/Fader`, `design/copy`, `design/player`, `utils/levels`, `utils/tempo`,
`utils/transpose`
**Used by:** `results/ResultsScreen`
**Notes:** rendered once above all three views, as the design requires ([Chords and lyrics](../conventions/design.md#chords-and-lyrics)) —
on phones too, where its groups wrap into a column and the dividers between them hide
(`max-[720px]:hidden`). The key label follows transpose, with *N% confident* when the server sent a
confidence; the − / + buttons stop at `MIN_TRANSPOSE` / `MAX_TRANSPOSE`. Tempo shows one decimal
only when it isn't whole, and *—* when there is none. The master fader is thin and its readout
follows `masterDb()`.

### `results/ChordBar.tsx` — chords and the lyric row (168 lines)
**Exports:** `ChordBar`
**Imports from:** `api/client` (types), `design/copy`, `hooks/useClockValue`, `hooks/useElementWidth`,
`hooks/usePlayhead`, `hooks/useSeekDrag`, `utils/lyrics`, `utils/time`, `utils/transpose`
**Used by:** `results/ResultsScreen`
**Notes:** design.md's [Chords and lyrics](../conventions/design.md#chords-and-lyrics): the current chord — *—* before the first chord, in a gap or in a
no-chord (`N`) segment — plus the next three (skipping `N`, the later two each a ramp step dimmer)
and the time. The strip spans the whole track: segments take `flex: <duration>`, with spacers for
any gap before the first or after the last so the playhead's `--p` lines up. An `N` segment has no
label, and **a segment narrower than its label shows none** (7 px per character plus 8 px, from the
measured width) — clipped text reads as another chord. The strip is an `aria-hidden` pointer
shortcut for seeking; the transport's slider is the accessible seek. It draws no loop markers. The
lyric row's four states: looking, synced (the current line, or the first line dimmed before it
starts), plain (*Open lyric sheet*), none (*Add lyrics manually*); it renders for instrumentals too,
and `instrumental` (any stem `silent`) adds the instrumental hint under it — here so all three views
show it.
**The synced line is plain text** — nothing opens a synced track's lyrics in the sheet or replaces
them. Any failed chords fetch shows *No chord analysis for this track.* Takes `getTime`, not a time:
four `useClockValue`s — the ended-segment count and the active index (binary searches,
`endedCount` and `activeSegment`), the `m:ss` readout and the lyric line index — so the bar renders
on a chord boundary, a lyric line or a second, and the strip's playhead moves through `usePlayhead`.
A clock value is a frame behind new segments or lyrics, so the current chord and the lyric line are
read with a fallback and a clamp. In a gap between chords the upcoming list starts after the
segments already ended.
**See:** [../features/chords-and-key.md](../features/chords-and-key.md)

### `results/Transport.tsx` — playback controls (228 lines)
**Exports:** `Transport`
**Imports from:** `components/icons`, `design/copy`, `hooks/useClockValue`, `hooks/usePlayhead`,
`hooks/usePopover`, `hooks/useSeekDrag`, `utils/time`, `results/types`
**Used by:** `results/ResultsScreen`
**Notes:** `.ch-transport` — play, both times, seek, speed, loop and metronome — closing the results,
its chrome background overridden to transparent so only its top hairline sets it off; the page never
scrolls, so it is always on screen. `compact` renders `.ch-m-bar` instead (also transparent): play, seek and *Click*
only, so phones have no speed or loop control. The 4px `.ch-seek` sits in a transparent full-height
wrapper that takes the pointer; the slider keeps the keyboard (±5 s, Shift ±30 s, PageUp/PageDown
±30 s, Home/End). The speed chip opens a popover of `SPEED_OPTIONS` (0.5–1.25×) and is disabled with
an explanation when `onSpeedChange` is absent (no AudioWorklet). The loop chip cycles *Loop off* →
*Loop A m:ss* → *Loop m:ss–m:ss* → off, and reads as pressed only once B is set. The metronome chip
is disabled, not hidden, without a tempo, so the layout doesn't shift. A disabled chip gets
Nocturne's 45% opacity inline, since `.ch-chip` has no disabled style. Takes `getTime`, not a time.
The elapsed readout is its own internal `ElapsedTime` component, so the transport doesn't render
every second; `SeekSlider` writes `--p` through `usePlayhead`, takes `aria-valuenow` and
`aria-valuetext` from `useClockValue` (whole seconds), and reads `getTime()` on each keydown.
**See:** [../features/speed-and-loop.md](../features/speed-and-loop.md)

### `results/MixerView.tsx` — the default view (36 lines)
**Exports:** `MixerView`
**Imports from:** `design/copy`, `results/StemRow`, `results/types`
**Used by:** `results/ResultsScreen`
**Notes:** column labels over fixed 96 / 150 / 92px columns and the waveform, one `StemRow` per
stem (the instrumental hint lives in `ChordBar`). `flex-1`: the rows fill any spare height in the
view panel. `progress` (a `() => number`) is passed through to every row's waveform; nothing here
reads it. Phones get the same rows,
stacked by `chord-theme.css`; the labels hide below 720px through `max-[720px]:hidden`, one of the
places `PHONE_QUERY`'s comment lists.
**See:** [../features/results-views.md](../features/results-views.md)

### `results/StemRow.tsx` — one Mixer row (51 lines)
**Exports:** `StemRow`
**Imports from:** `controls/Fader`, `controls/RoutingToggles`, `controls/StemWaveform`,
`design/copy`, `design/player`, `results/types`
**Used by:** `results/MixerView`
**Notes:** `.ch-stemrow` ([Controls](../conventions/design.md#controls)) in the stem's `--stem` hue: dot and name, a thin
level fader with its `fmtDb` value, MUTE/SOLO, and the waveform, dimmed while the stem isn't
`audible`, and passes `progress` on to it. On the web it is `flex-1`, so the rows share any spare height evenly but never shrink
below their content (`FitToPanel` scales the view instead). Below
720px the stylesheet stacks it and holds MUTE/SOLO at a 44px hit height, and `max-[720px]:flex-none`
keeps each stacked row its natural height (the view panel scrolls there).

### `results/ConsoleView.tsx` — strips and metering (78 lines)
**Exports:** `ConsoleView`
**Imports from:** `audio/meters`, `audio/playbackEngine`, `design/player`, `hooks/useAnimationFrame`,
`utils/levels`, `results/ConsoleStrip`, `results/MasterStrip`, `results/types`
**Used by:** `results/ResultsScreen`
**Notes:** a `.ch-striprow` of `ConsoleStrip`s, a divider, and the `MasterStrip`, filling any spare
height in the view panel (`flex-1`), with no hairline of its own — the transport's closes it. Strips
keep their 112px floor; `FitToPanel` guarantees the width for it. **Meters bypass
React**: every frame, playing or not, it fills one `MeterReadings` through `readMeters` and writes
`--l` onto each `[data-meter]` element (collected in a layout effect whenever the stem count
changes), each with its own `LevelFollower` (24 dB/s release) and mapped through `STEM_METER_SCALE`,
or `MASTER_METER_SCALE` for `data-meter="master"`. The strips' JSX keeps `--l: 0` constant, so
re-renders never touch the imperatively written value. The master *Peak* is the true peak with a
1.5 s hold, written into `MasterStrip`'s `peakRef` at 8 Hz.
**See:** [../features/metering.md](../features/metering.md)

### `results/ConsoleStrip.tsx` — one Console stem strip (90 lines)
**Exports:** `ConsoleStrip`
**Imports from:** `controls/Fader`, `controls/RoutingToggles`, `design/copy`, `design/player`,
`utils/levels`, `results/types`
**Used by:** `results/ConsoleView`
**Notes:** `.ch-panel.ch-strip` ([Controls](../conventions/design.md#controls)): name and state label, a `VerticalFader`, a
stereo `.ch-meter` (`data-meter` = the stem key, `data-channel` 0 and 1) beside the
`0 / −12 / −24 / −∞` `TICKS` that `db()` and `STEM_METER_SCALE` are spaced for, then Level and Pan
readouts and MUTE/SOLO. The label reads *Soloed*, *Muted*, *Silent* (a muted instrumental vocals),
*Held* (another stem is soloed) or *Playing*. **It shows solo first, not the audio**: a
soloed strip reads *Soloed* and lifts (`.is-active`) even when it is also muted, though mute wins in
the engine and in `audible()`; a muted one dims (`.is-off`). The fader column is `flex-1` with a
170px minimum, so the fader grows with spare height and never collapses.

### `results/MasterStrip.tsx` — the Console's master strip (73 lines)
**Exports:** `MasterStrip`, `MASTER_METER`
**Imports from:** `controls/Fader`, `design/copy`, `design/player`, `utils/levels`
**Used by:** `results/ConsoleView`
**Notes:** a 190px raised panel: a `VerticalFader`, a stereo meter in the accent (`data-meter` =
`MASTER_METER`, `"master"`), the `0 / −6 / −18 / −∞` `TICKS` that `masterDb()` and
`MASTER_METER_SCALE` follow, then *Output*, *Peak* and *Metronome* readouts and *Export stems*.
*Peak* starts at *−∞* and is rewritten by `ConsoleView` through `peakRef`.

### `results/AnalogView.tsx` — needle meters and knob modules (126 lines)
**Exports:** `AnalogView`
**Imports from:** `audio/meters`, `audio/playbackEngine`, `design/copy`, `hooks/useAnimationFrame`,
`utils/levels`, `results/AnalogModule`, `results/OutputDial`, `results/types`
**Used by:** `results/ResultsScreen`
**Notes:** five `OutputDial`s in a `repeat(5, minmax(180px, 1fr))` grid — the floor that keeps the
in-SVG type at 9px, which `FitToPanel` never lays the view out below — under the *Output level*
label, set off by the section's hairline rather than a panel, above a `.ch-striprow` of
`AnalogModule`s in a section that fills any spare height (`flex-1`) and draws no hairline, since the
transport's closes it. Both are always shown; a window too small for them scales the view instead of
hiding or cropping anything. Output L/R (peak, 20 dB/s release), true peak (1.5 s hold),
momentary loudness (300 ms smoothing, *−∞* in silence) and correlation (300 ms smoothing); needles
are rotated with `setAttribute` every frame and readouts rewritten at 8 Hz, both bypassing React.
**In silence — paused included — correlation reads *—* and its needle eases back to 0**, since the
value means nothing there.
**See:** [../features/metering.md](../features/metering.md)

### `results/AnalogModule.tsx` — one stem's knob module (92 lines)
**Exports:** `AnalogModule`
**Imports from:** `controls/Knob`, `controls/RoutingToggles`, `design/copy`, `design/player`,
`utils/levels`, `results/types`
**Used by:** `results/AnalogView`
**Notes:** `.ch-panel.ch-module`: dot and name, a Level knob in the stem hue with its dB value, Tone
and Pan knobs in `--color-neutral-700` ([Controls](../conventions/design.md#controls): only Level carries the hue), each
with its value under its label ([Ground rules](../conventions/design.md#ground-rules); the template's
harness drew them with a label only), and MUTE/SOLO. Like the Console strip it shows solo first: a soloed module lifts
(`.is-active`) even when muted; a muted one dims.

### `results/OutputDial.tsx` — one needle meter (116 lines)
**Exports:** `OutputDial`, `DialScale`, `OUTPUT_DIALS`, `NEEDLE_SWEEP_DEGREES`, `NEEDLE_MID_DEGREES`
**Imports from:** `design/copy`
**Used by:** `results/AnalogView`
**Notes:** the SVG the template's harness drew, on a `0 0 200 140` viewBox, the needle pivoting at `(100, 108)` over
±70°. Each scale is three anchors — left end, the mid label at −10°, right end — so the spacing is
non-linear, like a VU face. The accent arcs, as the harness drew them, start at +56° on L/R and
true peak (about −2.1 dB and −1.6 dB), +40° on loudness (about −14 LUFS) and +30° on correlation
(+0.5). Colors go through `style` so SVG strokes can take tokens. The needle and readout elements
are handed back through `needleRef` and `valueRef` for `AnalogView` to write.

### `results/ExportDialog.tsx` — downloads (97 lines)
**Exports:** `ExportDialog`
**Imports from:** `api/client`, `components/Dialog`, `design/copy`, `utils/download`, `results/types`
**Used by:** `results/ResultsScreen`
**Notes:** the template drew no export dialog, so this composes Nocturne's dialog with `.ch-stemrow`
rows: one per stem on the mixer, plus *Download all (.zip)*. Files are named
`"<title> - <stem key>.wav"` (fetched from `stemDownloadUrl`, which the server converts from the
stored FLAC) and `"<title>_stems.zip"`, with `.mp3`/`.flac` stripped from an
upload's title. Each download shows its own in-flight label; a failed one shows a one-line note
instead of being swallowed.
**See:** [../features/downloads.md](../features/downloads.md)

### `results/LyricsDialog.tsx` — lyric sheet and manual lyrics (104 lines)
**Exports:** `LyricsDialog`, `LyricsDialogMode`
**Imports from:** `api/client`, `components/Dialog`, `design/copy`
**Used by:** `results/ResultsScreen`
**Notes:** the template drew neither dialog. `sheet` — opened by the plain row's *Open lyric sheet*
— shows `lyrics.plain` with its line breaks in a 560px dialog that scrolls past 60vh, with *Close*
only: it never shows synced lines and cannot replace the lyrics. `edit` — opened by *Add lyrics
manually* — is a textarea whose save goes through `saveLyrics` and replaces the lyrics state;
pasted LRC timestamps make the result synced, and a failed save shows a `.ch-alert`.
**See:** [../features/lyrics.md](../features/lyrics.md)
