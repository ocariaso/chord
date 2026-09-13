# Map: `web/`

React 19 + TypeScript + Vite SPA, served by nginx. Dependencies: `react`, `react-dom`,
`wavesurfer.js`. Every icon is hand-written inline SVG.

```
web/
├── Dockerfile  nginx.conf  index.html
├── package.json  vite.config.ts  tsconfig*.json  .oxlintrc.json
├── public/      favicon.svg  icons.svg
└── src/
    ├── main.tsx  App.tsx  index.css  vite-env.d.ts
    ├── api/          client.ts
    ├── audio/        playbackEngine.ts
    ├── hooks/        useJobEvents  useLyrics  useDominantColor  useMediaQuery  useClickTooltip
    ├── utils/        time  transpose  lyrics  hasVocals  download
    ├── assets/       hero.png  react.svg  vite.svg
    └── components/
        ├── UploadPanel  ProcessingScreen  StemMixer
        ├── ChordTimeline  TransportBar  StemChannel  Footer  DecorativeIcons
        └── studio/   StudioCabinet  StudioMixer  MasterUnit  MasterCloseup  AmpCloseup
                      ZoomOverlay  ScaleToFit  Knob  ScallopedKnob  LevelRing  DownloadLed
                      icons  types  constants  ampComponents
                      useKnobDrag  useSeekDrag  useStemWaveform  useDownload
                      amps/  VocalsAmp  GuitarAmp  BassAmp  DrumsAmp  PianoAmp  OtherAmp
```

---

## Build and serve

### `Dockerfile` — multi-stage build
**Notes:** `node:20-alpine` runs `npm ci` (before the source copy, so a code change doesn't
reinstall deps) then `npm run build`; `nginx:1.27-alpine` receives `dist/` and `nginx.conf`.
Because the build is `tsc -b && vite build`, **a type error fails the image build**.

### `nginx.conf` — static serving + API proxy (22 lines)
**Notes:** three jobs. (1) `try_files $uri $uri/ /index.html` — SPA fallback. (2)
`proxy_pass http://server:8000/` — **the trailing slash strips the `/api` prefix**, which is why
server routes are mounted at `/jobs`. (3) SSE survival: `proxy_buffering off`,
`proxy_set_header Connection ""`, `proxy_http_version 1.1`, `proxy_read_timeout 1h` — all four
required, or progress arrives in one lump or times out. `client_max_body_size` is **not set**,
so nginx's 1 MB default rejects real uploads.
**See:** [../operations/docker.md](../operations/docker.md#nginx)

### `index.html` — the shell
**Notes:** `#root` div, module script, `/favicon.svg`, and a Google Fonts stylesheet loading
**Dancing Script, Orbitron, Oswald, Rock Salt, Share Tech Mono** with `preconnect` hints. The
Studio view depends on these heavily; offline they fall back to system sans.

### `package.json`
**Notes:** `version` is injected into the app as `__APP_VERSION__` and rendered in the footer.
Scripts: `dev`, `build` (`tsc -b && vite build`), `lint` (oxlint), `preview`.

### `vite.config.ts`
**Notes:** `react()` + `tailwindcss()` (Tailwind 4 as a Vite plugin, **not** PostCSS).
`define.__APP_VERSION__` from `package.json`. Dev proxy `/api` → `http://localhost:8787` with
`rewrite` stripping `/api`, mirroring nginx. **The target port 8787 disagrees with the server's
documented 8000** — see
[../operations/local-development.md](../operations/local-development.md#the-vite-proxy-port-mismatch).

### `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json`
**Notes:** project references. `tsconfig.app.json` covers `src` with `verbatimModuleSyntax`
(type imports must be marked `type`), `noUnusedLocals` and `noUnusedParameters` — **an unused
variable fails the build**, and the build runs inside Docker.

### `.oxlintrc.json`
**Notes:** plugins `react`, `typescript`, `oxc`; only two rules configured —
`react/rules-of-hooks` (error) and `react/only-export-components` (warn).

### `.gitignore` (web-local), `README.md` (the unmodified Vite/React template readme),
`public/favicon.svg`, `public/icons.svg`, `src/assets/*` (`hero.png` plus the unused Vite/React
scaffold logos).

---

## Entry points

### `src/main.tsx` — mounts `<App/>` in `StrictMode`, imports `index.css`. Vite scaffold style
(single quotes, no semicolons).

### `src/index.css` — global styles (38 lines)
**Notes:** `@import "tailwindcss"`. Full-height `html/body/#root`, zero body margin, button
cursor rules, and the two keyframe animations the app uses: **`marquee-loop`** (driven by a
`--marquee-distance` custom property set per element) and **`eq-bounce`**.

### `src/vite-env.d.ts` — `vite/client` types and the `__APP_VERSION__` declaration.

### `src/App.tsx` — screen router and job identity (84 lines)
**Exports:** `App` (default)
**Imports from:** `api/client`, `components/Footer`, `components/ProcessingScreen`,
`components/StemMixer`, `components/UploadPanel`, `hooks/useJobEvents`
**Used by:** `main.tsx`
**Notes:** the entire router — `useState<"upload" | "processing" | "results">`. Owns only
`screen`, `activeJobId`, `isSubmitting`, `uploadError`; everything else derives from
`useJobEvents(activeJobId)`. The effect watching `job.status === "done"` seeds
`localStorage["chord:viewMode"] = "simple"` so a new song always opens Simple. **`handleBack`
deletes the job** — clearing `activeJobId` unmounts the mixer, whose cleanup fires the discard
beacon.
**See:** [../architecture/web.md](../architecture/web.md#screen-flow)

---

## `src/api/`

### `src/api/client.ts` — the only module that knows the API exists (116 lines)
**Exports:** types `JobStatus`, `Job`, `ChordSegment`, `LyricsLine`, `Lyrics`; functions
`createJob`, `createJobFromUrl`, `getJob`, `cancelJob`, `getChords`, `getLyrics`; URL builders
`jobEventsUrl`, `cancelJobUrl`, `discardJobUrl`, `stemUrl`, `thumbnailUrl`, `downloadAllUrl`
**Imports from:** —
**Used by:** `App`, `StemMixer`, `ProcessingScreen`, `ChordTimeline` (type only),
`useJobEvents`, `useLyrics`, `studio/StudioMixer` + `studio/MasterUnit` (type only)
**Notes:** `API_BASE` is the literal `"/api"` — no configurable host. Two export shapes on
purpose: `async` wrappers that check `res.ok` and prefer the server's `detail` message, and URL
builders returning plain strings for consumers that aren't `fetch` (`EventSource`,
`sendBeacon`, `<img src>`, WaveSurfer's `url`, `downloadFile`). **`getLyrics` maps 404 → `null`**
rather than throwing, because "no lyrics" is a normal outcome. Every interface here is
hand-mirrored from `server/app/models/schemas.py`.
**See:** [../api/contract-sync.md](../api/contract-sync.md)

---

## `src/audio/`

### `src/audio/playbackEngine.ts` — the audio truth (231 lines)
**Exports:** `StemInput`, `StemState`, `PlaybackEngine`
**Imports from:** —
**Used by:** `StemMixer`
**Notes:** a plain class, no React. Owns one `AudioContext`; six `AudioBufferSourceNode`s
started at the same `when` with the same `offset` are **sample-locked by construction**. Graph:
source → per-stem `GainNode` → `masterGain` → destination, with `metronomeGain` wired
**directly to destination** so master volume doesn't attenuate the click. Position is derived,
never stored (`offsetSeconds + (currentTime - startedAtContextTime)`); `duration` is the **max**
of all buffers. `applyGains()` recomputes every gain from scratch — **solo is additive, any solo
silences non-soloed stems, and mute beats solo**. `load()` checks `this.disposed` after each
`await` because `StrictMode` double-invokes the mount effect. The metronome schedules **every
remaining beat at once** (~480 oscillators for a 4-min song at 120 BPM), tracked so they can be
stopped; beat one is anchored to track time zero, not a detected downbeat. `dispose()` must be
called — browsers limit open `AudioContext`s.
**See:** [../architecture/audio-playback.md](../architecture/audio-playback.md)

---

## `src/hooks/`

### `src/hooks/useJobEvents.ts` — one job's live status (70 lines)
**Exports:** `useJobEvents`
**Imports from:** `api/client`
**Used by:** `App`
**Notes:** the most side-effect-heavy hook. `getJob()` once immediately (so first paint has
data), then an `EventSource`, closed on a terminal status. **`onerror` closes and does not
reconnect** — a blip freezes the UI while the job continues. Registers a `pagehide` listener
firing `navigator.sendBeacon(discardJobUrl(...))`, and calls the same function from the effect
cleanup — which is why leaving the mixer deletes the job, and why `StrictMode`'s double-invoke
can spuriously cancel a job in development. `TERMINAL_STATUSES` here must match the server's set.

### `src/hooks/useLyrics.ts` — fetch lyrics once (24 lines)
**Exports:** `useLyrics`
**Imports from:** `api/client`
**Used by:** `StemMixer`
**Notes:** returns `Lyrics | null | undefined` — **`undefined` = loading, `null` = confirmed
none**, documented in a doc comment. Standard `cancelled` guard; a rejection maps to `null`.

### `src/hooks/useDominantColor.ts` — accent colors from artwork (160 lines)
**Exports:** `AccentColor`, `AccentColors`, `DEFAULT_ACCENT_COLORS`, `useDominantColors`
**Imports from:** —
**Used by:** `StemMixer`, `ProcessingScreen`
**Notes:** draws the image to a **32×32** canvas (the downsample is what makes this cheap enough
to run synchronously in `onload`), then a hand-rolled 2-means: seed the second centroid at the
pixel furthest from the first, six Lloyd iterations, return the larger cluster as `primary`.
`toAccentColor` keeps the hue, clamps saturation to `[0.5, 0.85]`, and **pins lightness to 42** —
so any artwork yields a fill that carries white text. A tainted canvas (cross-origin without
CORS) is caught and ignored. Returns `null` on no URL or load error; callers coalesce to
`DEFAULT_ACCENT_COLORS`. **Resolves after first paint**, which is why WaveSurfer needs an
explicit color-sync effect.
**See:** [../features/theming.md](../features/theming.md)

### `src/hooks/useMediaQuery.ts` — live `matchMedia` boolean (16 lines)
**Exports:** `useMediaQuery`
**Used by:** `StemMixer`, `studio/StudioMixer` — both with `"(max-width: 639px)"` (Tailwind's
`sm`), so the two views agree on one definition of "mobile".

### `src/hooks/useClickTooltip.ts` — tap-toggled tooltip (25 lines)
**Exports:** `useClickTooltip<T>`
**Used by:** `ChordTimeline`, `studio/MasterUnit`
**Notes:** returns `{open, setOpen, containerRef}`. Click/tap rather than hover so it works on
touch; closes on outside `pointerdown` or Escape, with listeners attached only while open.

---

## `src/utils/`

Pure functions, one subject per file.

### `src/utils/time.ts` — `formatTime(seconds)` → `"3:51"`, `"0:00"` for non-finite.
**Used by:** `TransportBar`, `studio/MasterUnit`

### `src/utils/transpose.ts` — `transposeChord`, `transposeKeyLabel` (24 lines)
**Used by:** `ChordTimeline`, `studio/MasterUnit`
**Notes:** `NOTE_NAMES` here **duplicates** the array in `server/app/pipeline/chords.py` — both
must stay sharps-only. `transposeChord` returns `"-"` for `"N"` **regardless of the offset**,
which is how the no-chord marker is displayed, and is why it's called even at `transpose === 0`.
The `((i + n) % 12 + 12) % 12` double modulo is required because JS `%` keeps the sign. Suffixes
are opaque, so any chord quality works.
**See:** [../features/transpose.md](../features/transpose.md)

### `src/utils/lyrics.ts` — `lyricsDisplayLine`, `currentLyricLine` (24 lines)
**Imports from:** `api/client` (types)
**Used by:** `StemMixer`
**Notes:** two entry points for the same scan. `lyricsDisplayLine` always returns a string,
including status text (`"Looking for lyrics…"`, `"No lyrics found"`,
`"Lyrics found (not synced)"`, `"♪ ♪"`) — used by the Studio vocals amp. `currentLyricLine`
returns the line or `null` with no status text — used by the Simple timeline. Linear scan
relying on sorted order with an early `break`, run every animation frame.

### `src/utils/hasVocals.ts` — `detectHasVocals(buffer)` (14 lines)
**Used by:** `StemMixer`
**Notes:** RMS over every 8th sample (`SAMPLE_STRIDE`) against `SILENCE_RMS_THRESHOLD = 0.01`.
Instrumentals separate into a **near-silent** vocals stem rather than an absent one; this gates
the whole lyrics UI.

### `src/utils/download.ts` — `downloadFile(url, filename)` (14 lines)
**Used by:** `StemChannel`, `StemMixer`, `studio/useDownload`
**Notes:** fetch → blob → object URL → synthetic `<a download>` → revoke. Chosen over a plain
link so the client can **rename the file** (the server suggests the raw job id), **detect
failure** (a non-ok response throws), and **show a spinner**. Buffers the whole file in memory.

---

## `src/components/` — screens and Simple view

### `src/components/UploadPanel.tsx` — the upload screen (106 lines)
**Imports from:** `components/DecorativeIcons`
**Used by:** `App`
**Notes:** URL form + drag-and-drop zone with a hidden
`<input accept=".mp3,.flac,audio/mpeg,audio/flac">`. Only `files[0]` is used. Hardcodes the
brand accent `#307E9F` / `hsl(198,54%,58%)` because there's no job yet and therefore no artwork
to sample.

### `src/components/ProcessingScreen.tsx` — live progress (205 lines)
**Imports from:** `api/client`, `components/DecorativeIcons`, `hooks/useDominantColor`
**Used by:** `App`, **and `StemMixer`** (reused as its stem-loading screen)
**Notes:** four early-return states — connection error, no job, `error`, `cancelled` — then the
progress layout: a pulsing accent ring around the thumbnail, a marquee title, a progress bar,
`stage_message` (falling back to `STAGE_LABELS`), and Cancel. The optional **`onCancel` prop
overrides the default `cancelJob` call**, which is what lets `StemMixer` reuse it for a
client-side load where there's no server job to cancel. Samples the thumbnail itself, so the
theme is live during processing.

### `src/components/StemMixer.tsx` — the state hub (510 lines)
**Imports from:** `api/client`, `audio/playbackEngine`, `hooks/useDominantColor`,
`hooks/useLyrics`, `hooks/useMediaQuery`, `utils/download`, `utils/hasVocals`, `utils/lyrics`,
`components/ChordTimeline`, `components/ProcessingScreen`, `components/StemChannel`,
`components/TransportBar`, `studio/icons`, `studio/StudioCabinet`, `studio/StudioMixer`
**Used by:** `App`
**Notes:** owns **all** playback state — `engineRef`, `waveSurfersRef`, `rafRef`,
`channelStates`, `soloedStems`, `masterVolume`, `metronomeEnabled`, `chordSegments`, `hasVocals`,
`viewMode`, `transpose`, `currentTime`, `isPlaying` — and threads it into both views as props.
**The single `requestAnimationFrame` loop here drives every playhead in the app**, calling
`setCurrentTime` and `ws.setTime(time)` on each registered WaveSurfer, unconditionally (even when
paused). Both views are built as local variables in the same render and one is chosen at the
end, so **neither holds playback state** and switching mid-song is seamless. `changeViewMode`
staggers fade-out → swap → 200 ms mount delay → fade-in, guarded by `viewTransitionTokenRef` so
rapid toggling can't stick. Derives `cardBg`/`cardBorder` via `color-mix`. `SIMPLE_STEM_ORDER`
differs from the Studio view's order. **Known bug:** `handleDownloadAll` strips only
`/\.mp3$/i`, so a FLAC upload downloads as `song.flac_stems.zip`.
**See:** [../architecture/web.md](../architecture/web.md#state-ownership), [../features/simple-view.md](../features/simple-view.md)

### `src/components/ChordTimeline.tsx` — chord readout + global controls (246 lines)
**Imports from:** `api/client` (type), `hooks/useClickTooltip`, `utils/transpose`,
`studio/useSeekDrag`
**Used by:** `StemMixer`
**Notes:** **returns `null` when `segments.length === 0`**, so a job without chord detection has
no timeline. Composes named fragments (`chordGroup`, `keySpan`, `transposeGroup`, `volumeGroup`,
`metronomeButton`) and arranges them **twice** — once for mobile, once for desktop — because the
groupings genuinely differ. Active chord large, next five stepped through `UPCOMING_OPACITY`.
Segment bar widths are `(end - start) / duration`; `useSeekDrag` makes it seekable. Declares its
own `MIN_TRANSPOSE`/`MAX_TRANSPOSE` and `formatTranspose`, **duplicated** in `studio/MasterUnit`.

### `src/components/StemChannel.tsx` — one stem row (153 lines)
**Imports from:** `studio/useSeekDrag`, `utils/download`
**Used by:** `StemMixer`
**Notes:** name + M/S buttons, a 56 px WaveSurfer, a volume range (`style={{ accentColor }}`
themes the native slider), and a download button. Creates its WaveSurfer inline with
`interact: false` and an effect keyed on `[buffer]` (exhaustive-deps disabled). **Carries the
`progressColor` sync effect** for the asynchronously-resolved accent color — the canonical
example of that pattern. Has a local `DownloadIcon` rather than importing one.

### `src/components/TransportBar.tsx` — play/pause, times, scrubber (53 lines)
**Imports from:** `utils/time`
**Used by:** `StemMixer`
**Notes:** local `PlayIcon`/`PauseIcon`. Native range input clamped with
`Math.min(currentTime, duration)`.

### `src/components/Footer.tsx` — fixed footer (49 lines)
**Notes:** GitHub, bug-report `mailto:`, and Ko-fi links with inline SVG icons, plus
`© <year> Ormin Cariaso · v{__APP_VERSION__}`. Hardcodes the author's URLs and email. **Leaf.**

### `src/components/DecorativeIcons.tsx` — shared animated icons (30 lines)
**Exports:** `EqualizerBars` (staggered `eq-bounce` bars), `MusicNoteIcon`
**Used by:** `UploadPanel`, `ProcessingScreen`

---

## `src/components/studio/`

### `studio/constants.ts` — the view's geometry (30 lines)
**Exports:** `AMP_WIDTH` (480), `AMP_MOBILE_WIDTH` (340), `GRID_GAP` (24), `MASTER_WIDTH`,
`MASTER_MOBILE_WIDTH` (340), the `CABINET_*` dimensions, `CABINET_INTERIOR_COLOR/IMAGE`
**Notes:** derived rather than restated — `MASTER_WIDTH = AMP_WIDTH * 2 + GRID_GAP` (984), and
`CABINET_WIDTH` is computed from every piece of chrome, so changing a post width keeps the
cabinet wrapping the grid exactly. Mobile variants exist because the desktop chrome would
consume most of a phone's width. Every constant carries a comment explaining why it exists.

### `studio/types.ts` — `AmpProps` (24 lines)
**Notes:** the contract all six amps share. **`controlsOnly`** skips the decorative shell;
**`isMobile`** selects the narrower design width — deliberately independent, because the closeup
passes `controlsOnly` but wants full desktop width (it does its own scaling). **`lyricLine`** is
only ever passed to the vocals amp. All three are documented in doc comments on the interface.

### `studio/ampComponents.ts` — the stem→component registry (18 lines)
**Exports:** `AMP_COMPONENTS`, `STEM_ORDER`
**Notes:** `AMP_COMPONENTS[name] ?? OtherAmp` means an unknown stem still renders. `STEM_ORDER`
differs from the Simple view's `SIMPLE_STEM_ORDER` (drums/piano swapped).

### `studio/StudioCabinet.tsx` — the walnut rack shell (94 lines)
**Imports from:** `studio/constants`
**Used by:** `StemMixer`
**Notes:** pure decoration — `WALNUT`/`BRASS`/`LEATHER`/`RIVET` gradients, two brass rails with a
"CHORD Rig Cabinet" plate in Oswald, leather posts with rivets, velvet interior. Takes only
`children` and `isMobile`; knows nothing about audio.

### `studio/StudioMixer.tsx` — layout and closeup state (216 lines)
**Imports from:** `api/client` (type), `hooks/useMediaQuery`, `studio/AmpCloseup`,
`studio/ampComponents`, `studio/amps/OtherAmp`, `studio/MasterCloseup`, `studio/MasterUnit`,
`studio/ScaleToFit`, `studio/constants`
**Used by:** `StemMixer`
**Notes:** ~40-line props interface, all pass-through. Assembles `masterProps` **once** and
spreads it into both `MasterUnit` and `MasterCloseup` so they can't drift. `MasterUnit` renders
sticky on a cabinet-interior background so it occludes cleanly; amps go in a 2-column grid
(1 column on mobile). Both click handlers check `target.closest("button, .touch-none")` and bail,
so dragging a knob or scrubbing doesn't open a closeup. Passes `controlsOnly={isMobile}`.

### `studio/MasterUnit.tsx` — the Studio control surface (483 lines)
**Imports from:** `api/client` (type), `hooks/useClickTooltip`, `utils/transpose`, `utils/time`,
`studio/icons`, `studio/LevelRing`, `studio/useKnobDrag`, `studio/useSeekDrag`,
`studio/constants`
**Used by:** `studio/StudioMixer`, `studio/MasterCloseup`
**Exports:** `MasterUnit`, `MasterUnitProps`, `ViewMode`
**Notes:** the Studio counterpart to `ChordTimeline` + `TransportBar` combined. Simulated LCD
(Orbitron, `#4ade80` with a text-shadow glow, upcoming chords through a hardcoded
`UPCOMING_COLORS` ramp), thumbnail title plate with marquee, transport with `useSeekDrag`, a
local `GainRing` (knob + `LevelRing`) for master volume, transpose, metronome, download-all,
upload-another, and two view-mode LED buttons. Re-declares `MIN_TRANSPOSE`/`MAX_TRANSPOSE`,
`formatTranspose` and `activeSegmentIndex` — all **duplicated** from `ChordTimeline`.

### `studio/MasterCloseup.tsx` (16 lines) — `ZoomOverlay` + a second `MasterUnit` from the same
`masterProps`. **Leaf.**

### `studio/AmpCloseup.tsx` — magnified amp (30 lines)
**Imports from:** `studio/ampComponents`, `studio/amps/OtherAmp`, `studio/types`,
`studio/ZoomOverlay`
**Used by:** `studio/StudioMixer`
**Notes:** renders **the same amp component** with `controlsOnly`, so the zoomed controls are
real and live. Its WaveSurfer is **not** registered in `waveSurfersRef`, so it can't be driven by
the shared tick loop — instead an effect pushes `setTime(currentTime)` from the prop.

### `studio/ZoomOverlay.tsx` — the zoom-from-origin transition (95 lines)
**Used by:** `studio/AmpCloseup`, `studio/MasterCloseup`
**Notes:** FLIP-style, entirely imperative style writes. `useLayoutEffect` measures the card's
natural rect, computes the rest scale as
`min(maxZoomScale, innerWidth*0.9/w, innerHeight*0.9/h)`, sets the starting transform mapping
the card onto `originRect`, **forces a reflow** (`void getBoundingClientRect()`) so the browser
commits it, then animates in a `requestAnimationFrame`. Without the reflow the two style writes
coalesce and there's nothing to animate from. 280 ms both ways; closing reverses and calls
`onClose` after the transition.

### `studio/ScaleToFit.tsx` — shrink-to-fit wrapper (52 lines)
**Used by:** `studio/StudioMixer`
**Notes:** measures the child's natural `offsetWidth` (unaffected by transforms), computes
`min(1, available / natural)`, applies a CSS `transform: scale()`, and sizes the wrapper to the
scaled box so surrounding layout stays correct. **Never scales above 1**, so desktop is a no-op.
`ResizeObserver` on both outer and inner elements.

### `studio/Knob.tsx` — the general knob (81 lines)
**Imports from:** `studio/LevelRing`, `studio/useKnobDrag`
**Used by:** all six amps
**Notes:** SVG in a `56×56` viewBox centered at `(28,28)`. Configurable `stops` (chrome tone),
`pointerColor`, `ribbed` (recessed dashed socket), `ring`, `label`, `disabled`. `useId` for
gradient ids so multiple instances don't collide.

### `studio/ScallopedKnob.tsx` — Bass's knob only (64 lines)
**Notes:** a two-layer scalloped chrome knob, kept separate **so Bass's identity isn't reused
elsewhere** — stated in its own doc comment. Same `56×56` convention.

### `studio/LevelRing.tsx` — green→amber→red arc (34 lines)
**Exports:** `RING_RADIUS`, `LevelRing`
**Used by:** `Knob`, `ScallopedKnob`, `MasterUnit`'s `GainRing`
**Notes:** expects to be drawn inside a `56×56` viewBox at `(28,28)`. The arc is a
`strokeDasharray` of `value * RING_SWEEP` (270/360 of the circumference), rotated `126°` so the
gap sits at the bottom.

### `studio/DownloadLed.tsx` — save indicator lamp (28 lines)
**Used by:** all six amps
**Notes:** lit in the amp's own `idleColor` at rest, switching to a shared busy amber
(`#f97316`) while downloading.

### `studio/icons.tsx` — `DownloadTrayIcon`, `UploadTrayIcon`
**Used by:** `StemMixer`, `studio/MasterUnit`

### `studio/useKnobDrag.ts` — vertical drag → 0…1 (32 lines)
**Exports:** `useKnobDrag`, `valueToRotation`
**Used by:** `Knob`, `ScallopedKnob`, `MasterUnit`
**Notes:** `setPointerCapture` so the drag keeps tracking after the pointer leaves the small
SVG — essential for a 26 px target. `sensitivity = 200` px for the full range; drag up
increases. `valueToRotation` → `-135 + value * 270`, the sweep a real potentiometer travels.

### `studio/useSeekDrag.ts` — click-or-drag seeking (34 lines)
**Used by:** `ChordTimeline`, `StemChannel`, `MasterUnit`, all six amps
**Notes:** the element it's attached to defines 0–100%. `preventDefault()` on pointerdown to
stop text selection, pointer capture for the drag, and a `duration <= 0` guard.

### `studio/useStemWaveform.ts` — one themed WaveSurfer (38 lines)
**Used by:** all six amps
**Notes:** the Studio equivalent of `StemChannel`'s inline creation. `interact: false`, `peaks`
from the already-decoded buffer (no re-decode), plus `url` **and** `duration` so WaveSurfer has a
real media element for cursor math. Effect depends on `[buffer]` alone with exhaustive-deps
disabled and a comment; `destroy()` in cleanup.

### `studio/useDownload.ts` — `{isDownloading, download}` (19 lines)
**Imports from:** `utils/download`
**Used by:** all six amps
**Notes:** packages the pattern `StemChannel` and `StemMixer` hand-roll. Empty `catch` with the
standard comment.

### `studio/amps/` — six bespoke amp components

`VocalsAmp` (169), `BassAmp` (174), `GuitarAmp` (144), `DrumsAmp` (115), `PianoAmp` (114),
`OtherAmp` (102).

**Each imports:** `studio/DownloadLed`, `studio/Knob` (Bass also `ScallopedKnob`),
`studio/types`, `studio/useDownload`, `studio/useSeekDrag`, `studio/useStemWaveform`,
`studio/constants`
**Used by:** `studio/ampComponents`, `studio/StudioMixer`, `studio/AmpCloseup`

**Notes:** all six share the same six lines of logic — a container ref, `useDownload`,
`useSeekDrag`, and `useStemWaveform` with per-amp wave/progress colors and height — followed by
a large amount of purely presentational JSX (cabinet texture, hardware, local icon components).
**The duplication is deliberate**; a shared shell would collapse the visual identities that are
the point of the view. `OtherAmp` doubles as the fallback for unrecognized stems.
`VocalsAmp` is the only one that renders `lyricLine`.
**Skip these on a first read** — ~800 lines of SVG over one small interface.
**See:** [../features/studio-view.md](../features/studio-view.md#why-six-bespoke-amps)
