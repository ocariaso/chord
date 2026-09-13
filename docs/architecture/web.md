# Web architecture

React 19 + TypeScript + Vite 8 SPA in [`web/`](../../web/), styled with Tailwind CSS 4 (via
`@tailwindcss/vite`, not PostCSS). Built to static files and served by nginx.

Dependencies are deliberately few: `react`, `react-dom`, `wavesurfer.js`. No router, no state
library, no data-fetching library, no component library, no icon package — every icon in the
app is a hand-written inline SVG.

## Screen flow

[`App.tsx`](../../web/src/App.tsx) is the entire router: a `useState<"upload" | "processing" | "results">`.

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
  "upload"  ──createJob/createJobFromUrl──►  "processing"  ──job.status === "done"──►  "results"
      ▲                                          │                                       │
      └──────────────── handleBack ──────────────┴───────────────────────────────────────┘
```

`App` owns exactly four pieces of state — `screen`, `activeJobId`, `isSubmitting`,
`uploadError` — and derives everything else from `useJobEvents(activeJobId)`.

The upload → processing transition is optimistic: the POST returns a `JobResponse`, `App`
stores its `id`, and the screen switches immediately. The processing → results transition is
driven by the effect watching `job.status === "done"`, which also seeds
`localStorage["chord:viewMode"] = "simple"` so that a *new* song always opens in the Simple
view regardless of what the user last used. (`StemMixer` then reads that key back for its
initial state.)

`handleBack` clears `activeJobId`, which unmounts the mixer and triggers `useJobEvents`'
cleanup — which fires the discard beacon. Going "back to upload" therefore *deletes* the job.
See [job-lifecycle.md](job-lifecycle.md#discarding).

## Data access

[`web/src/api/client.ts`](../../web/src/api/client.ts) is the only module that knows the API
exists. Everything above it imports typed functions and URL builders from here.

Two shapes of export, by necessity:

- **`async` fetch wrappers** — `createJob`, `createJobFromUrl`, `getJob`, `cancelJob`,
  `getChords`, `getLyrics`. Each checks `res.ok`, and prefers the server's
  `{"detail": "..."}` message over a generic `"(status)"` string when throwing.
- **URL builders** — `jobEventsUrl`, `cancelJobUrl`, `discardJobUrl`, `stemUrl`,
  `thumbnailUrl`, `downloadAllUrl`. These exist because their consumers aren't `fetch`:
  `EventSource`, `navigator.sendBeacon`, `<img src>`, WaveSurfer's `url` option, and
  `downloadFile`'s blob fetch all need a plain string.

`getLyrics` is the one function that treats a 404 as data rather than failure — it returns
`null`, because "this song has no lyrics" is a normal outcome.

`API_BASE` is the literal `"/api"`. There is no environment variable and no absolute host; the
app always talks to its own origin, and something in front of it does the routing (nginx in
production, the Vite dev proxy locally).

## State ownership

The rule: **state lives at the lowest component that still sees everyone who needs it**, and
there are only two such components.

### `App` — job identity

`activeJobId` and the screen. Nothing about playback.

### `StemMixer` — everything about playback

[`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) (~510 lines) is the hub. It owns:

| State | Purpose |
| --- | --- |
| `engineRef` | the `PlaybackEngine` instance (a ref, not state — never re-renders) |
| `waveSurfersRef` | `Map<stemName, WaveSurfer>`, registered by children on mount |
| `rafRef` | the animation-frame handle for the clock loop |
| `loading`, `loadError` | stem fetch/decode status |
| `isPlaying`, `currentTime` | mirrored *from* the engine for rendering |
| `channelStates` | `Record<stemName, {muted, volume}>` |
| `soloedStems` | `Set<stemName>` |
| `masterVolume`, `metronomeEnabled` | |
| `chordSegments` | fetched once per job |
| `hasVocals` | computed from the decoded vocals buffer |
| `viewMode`, `isSwitchingView` | Simple/Studio and its fade |
| `transpose` | semitone offset, −11…+11 |
| `marqueeTextWidth` | measured, for the scrolling title |

Plus `useLyrics(job.id)` and `useDominantColors(...)` as hooks.

Both views are built as local variables (`simpleView`, `studioView`) in the same render and one
is chosen at the end. The Studio view gets its ~30 props bundled through `StudioMixer`; the
Simple view distributes the same state across `ChordTimeline`, `TransportBar` and one
`StemChannel` per stem. **Neither view holds playback state of its own** — that is what makes
switching views mid-playback seamless: the engine never stops, only the chrome unmounts.

`changeViewMode` deliberately staggers the swap: fade out (150ms) → swap `viewMode` → wait
200ms for the new tree to mount → fade in. A `viewTransitionTokenRef` counter invalidates a
transition if another one starts, so rapid toggling can't leave the UI stuck invisible.

### Why no context or store

Every consumer of playback state is a descendant of `StemMixer`, and the tree is at most four
levels deep. Prop threading is verbose — `StudioMixer`'s props interface is 40 lines — but it
keeps the data flow completely explicit and means no component can mutate playback except
through the callbacks it was handed.

## The render clock

One `requestAnimationFrame` loop in `StemMixer`, started once on mount:

```ts
function tick() {
  const engine = engineRef.current;
  if (engine) {
    const time = engine.getCurrentTime();
    setCurrentTime(time);                                  // re-renders the React tree
    for (const ws of waveSurfersRef.current.values()) ws.setTime(time);  // moves each playhead
  }
  rafRef.current = requestAnimationFrame(tick);
}
```

This is the only thing that moves the UI forward. It runs unconditionally — even when paused —
which keeps the code branchless at the cost of a `setState` per frame. Every playhead in the
app (chord timeline, transport bar, all six waveforms, the Master seek bar) reads from the same
`currentTime`, so they cannot drift apart.

`AmpCloseup` is the exception: its WaveSurfer instance isn't registered in `waveSurfersRef`, so
it drives its own playhead from the `currentTime` **prop** via an effect. See
[../features/studio-view.md](../features/studio-view.md).

## Hooks

| Hook | Responsibility |
| --- | --- |
| [`useJobEvents`](../../web/src/hooks/useJobEvents.ts) | one job's live status over SSE, plus discard-on-leave |
| [`useLyrics`](../../web/src/hooks/useLyrics.ts) | fetch lyrics once; `undefined` = loading, `null` = none |
| [`useDominantColors`](../../web/src/hooks/useDominantColor.ts) | sample the thumbnail into two accent colors |
| [`useMediaQuery`](../../web/src/hooks/useMediaQuery.ts) | live `matchMedia` boolean |
| [`useClickTooltip`](../../web/src/hooks/useClickTooltip.ts) | tap-toggled tooltip, closes on outside click or Escape |
| [`useKnobDrag`](../../web/src/components/studio/useKnobDrag.ts) | vertical drag → 0…1, and `valueToRotation` |
| [`useSeekDrag`](../../web/src/components/studio/useSeekDrag.ts) | click/drag across an element → seek |
| [`useStemWaveform`](../../web/src/components/studio/useStemWaveform.ts) | create + tear down one themed WaveSurfer |
| [`useDownload`](../../web/src/components/studio/useDownload.ts) | `{isDownloading, download}` for one file |

The three-state `undefined | null | value` convention in `useLyrics` is used because the UI
shows three different strings for those cases; see
[`utils/lyrics.ts`](../../web/src/utils/lyrics.ts).

Every async hook uses the same `let cancelled = false` + cleanup guard so a late resolve can't
write into an unmounted tree — worth preserving, because `StrictMode` double-invokes effects in
development and will surface any hook that skips it.

## Subscription and cleanup

`useJobEvents` is the most side-effect-heavy hook in the app:

1. Immediately `getJob()` once, so the UI has data before the first SSE tick.
2. Open an `EventSource` on `/api/jobs/{id}/events`; on each message `setJob`, and close the
   stream when the status is terminal.
3. `onerror` just closes — **there is no reconnect**. A dropped connection leaves the last-known
   job state frozen on screen.
4. Register a `pagehide` listener that `navigator.sendBeacon`s the discard endpoint, and call
   the same function from the effect's cleanup.

`sendBeacon` is used rather than `fetch` because the browser guarantees delivery of a beacon
during page teardown, where an in-flight `fetch` would be cancelled.

## Styling

- Tailwind utility classes for layout and typography.
- **Inline `style` for anything color-derived**, because accent colors are computed at runtime
  from the thumbnail and Tailwind can't generate classes for values it never sees. The pattern
  throughout is `className` for structure + `style={{ backgroundColor: accentColor }}` for skin.
- `boxShadow: "inset 0 0 0 1px ..."` is used instead of `border` in many places so borders
  don't affect layout size.
- `color-mix(in srgb, ...)` composes the themed card surfaces in `StemMixer`.
- Two keyframe animations live in [`index.css`](../../web/src/index.css): `marquee-loop` (driven
  by a `--marquee-distance` custom property set per element) and `eq-bounce`.
- Display fonts (Oswald, Orbitron, Share Tech Mono, Rock Salt, Dancing Script) are loaded from
  Google Fonts in [`index.html`](../../web/index.html) and referenced as
  `font-['Oswald']` / inline `fontFamily`. The Studio view depends on them heavily for its look.

`__APP_VERSION__` is injected by [`vite.config.ts`](../../web/vite.config.ts) from
`package.json`'s `version` and rendered in the footer; it's declared in
[`vite-env.d.ts`](../../web/src/vite-env.d.ts).

## Build and serve

```dockerfile
FROM node:20-alpine AS build      # npm ci, then npm run build (tsc -b && vite build)
FROM nginx:1.27-alpine            # copy dist/ + nginx.conf
```

[`nginx.conf`](../../web/nginx.conf) does three things:

- `try_files $uri $uri/ /index.html` — SPA fallback.
- `location /api/ { proxy_pass http://server:8000/; }` — note the trailing slash on the target,
  which **strips** the `/api` prefix. The server's routes are mounted at `/jobs`, not `/api/jobs`.
- For SSE: `proxy_buffering off`, `proxy_set_header Connection ""`, `proxy_http_version 1.1`,
  and `proxy_read_timeout 1h`. Without these, nginx would buffer the event stream and the
  progress UI would arrive in one lump at the end — or time out on a long separation.
