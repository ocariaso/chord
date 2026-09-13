# TypeScript and React conventions

Observed in [`web/`](../../web/). React 19, TypeScript, 2-space indent, double quotes,
semicolons, ~120 column lines.

(`main.tsx` and `vite.config.ts` still carry the Vite scaffold's single quotes and no
semicolons. Everything hand-written since uses double quotes and semicolons.)

## Components

Named function declarations with a named exported `Props` interface directly above:

```tsx
interface StemChannelProps {
  name: string;
  buffer: AudioBuffer;
  muted: boolean;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
}

export function StemChannel({ name, buffer, muted, onToggleMute, onVolumeChange }: StemChannelProps) {
```

- **`function`, not `const X = () =>`**, and no `React.FC`.
- **Props destructured in the signature**, with defaults there too (`controlsOnly = false`).
- **Named exports** everywhere except `App.tsx`, which is the Vite scaffold's default export.
- Small presentational pieces (icons, `GainRing`) live as unexported functions in the file that
  uses them; only genuinely shared ones move to `DecorativeIcons.tsx` or `studio/icons.tsx`.

## Props naming

| Pattern | Use |
| --- | --- |
| `onX` | a callback prop (`onSeek`, `onToggleMute`, `onWaveSurferReady`) |
| `handleX` | the implementation inside a component (`handlePlayPause`, `handleDownloadAll`) |
| `isX` / `hasX` | booleans (`isPlaying`, `isDownloading`, `hasVocals`) |
| an optional `onX` | **a capability toggle** |

That last one is a real pattern, not an accident. `onToggleMetronome?: () => void` being
`undefined` is how the metronome button is hidden:

```tsx
onToggleMetronome={job.tempo_bpm != null ? toggleMetronome : undefined}
// …and in the child:
const metronomeButton = onToggleMetronome && ( <button …/> );
```

Prefer this over a separate `showMetronome` boolean — the callback's absence *is* the condition.

## State placement

State lives at the lowest component that still sees every consumer. In practice that means two
owners: `App` (job identity, screen) and `StemMixer` (everything about playback). See
[../architecture/web.md](../architecture/web.md#state-ownership).

No context, no store, no reducer. Props are threaded explicitly, even when that means a 40-line
props interface. Bundle a large prop set once and spread it if two components need the same set:

```tsx
const masterProps = { title, author, keyLabel, /* … */ };
<MasterUnit {...masterProps} />
<MasterCloseup {...masterProps} originRect={rect} onClose={…} />
```

## `useRef` vs `useState`

Deliberate and consistent: **`useRef` for anything that must not trigger a render.**

```tsx
const engineRef = useRef<PlaybackEngine | null>(null);        // imperative object
const waveSurfersRef = useRef(new Map<string, WaveSurfer>()); // registry
const rafRef = useRef<number>(0);                             // animation frame handle
const viewTransitionTokenRef = useRef(0);                     // invalidation token
const [currentTime, setCurrentTime] = useState(0);            // rendered → state
```

The `viewTransitionTokenRef` pattern is worth reusing: increment a counter when starting an
async sequence, and have each continuation bail if the counter moved.

```tsx
const token = ++viewTransitionTokenRef.current;
window.setTimeout(() => {
  if (viewTransitionTokenRef.current !== token) return;   // superseded
  …
}, VIEW_TRANSITION_MS);
```

## Async effects

Every async effect uses the same cancellation guard. This is non-negotiable — `StrictMode`
double-invokes effects in development and will expose any hook that skips it:

```tsx
useEffect(() => {
  let cancelled = false;
  getChords(job.id)
    .then((segments) => { if (!cancelled) setChordSegments(segments); })
    .catch(() => {
      // Chord analysis may not be available for this job; leave the timeline hidden.
    });
  return () => { cancelled = true; };
}, [job.id]);
```

Classes get the same treatment internally — `PlaybackEngine.load()` checks `this.disposed`
after each `await` so a disposed engine's in-flight fetches don't populate it.

## Imperative libraries

WaveSurfer is the only one, and the rules around it are specific:

- Create in an effect, `destroy()` in its cleanup.
- **Depend on `[buffer]` alone**, with `// eslint-disable-next-line react-hooks/exhaustive-deps`
  and a comment. Recreating an instance because a color or callback changed would flicker the
  waveform.
- Push later changes in with a **separate** effect rather than recreating:

```tsx
// The accent color resolves asynchronously (sampled from the thumbnail after it loads), so keep
// the already-created instance's progress color in sync instead of only setting it at creation.
useEffect(() => {
  waveSurferRef.current?.setOptions({ progressColor: accentColor });
}, [accentColor]);
```

- Register upward via a callback prop (`onWaveSurferReady(name, instance)`) so the owner can
  drive it.

## Three-state values

Where the UI has three distinct displays, model three states rather than pairing a boolean with
a value:

```ts
/** undefined = still loading, null = confirmed no lyrics found, otherwise the fetched result. */
export function useLyrics(jobId: string): Lyrics | null | undefined
```

Always document which is which in a doc comment — the distinction is invisible at the call site
otherwise.

## `localStorage`

Always wrapped, always with a comment naming the fallback. It throws in private browsing:

```tsx
function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === "studio" ? "studio" : "simple";
  } catch {
    return "simple";
  }
}
```

Keys are namespaced with a `chord:` prefix and declared as a constant (`VIEW_MODE_KEY`).

## Styling

**Tailwind classes for structure; inline `style` for anything color-derived.** Accent colors are
computed at runtime from the cover art, so Tailwind cannot generate classes for them:

```tsx
<button
  className="flex h-8 w-8 items-center justify-center rounded-md text-white hover:opacity-90"
  style={{ backgroundColor: accentColor }}
/>
```

Other conventions in use:

- `boxShadow: "inset 0 0 0 1px …"` instead of `border`, so borders don't affect layout size.
- `color-mix(in srgb, …)` to compose themed surfaces from an accent plus a dark base.
- Conditional classes by template literal, not a `clsx`-style helper (there is no such
  dependency).
- CSS custom properties for measured pixel values, cast where TypeScript needs it:
  ```tsx
  style={{ "--marquee-distance": `-${width}px` } as React.CSSProperties}
  ```
- Two responsive strategies, used for different things: Tailwind `sm:` prefixes for simple
  scaling, and an explicit `isMobile` branch (from `useMediaQuery("(max-width: 639px)")`) when
  the *grouping* differs, not just the direction.
- `touch-none` on drag surfaces — and note it doubles as a click-target marker, since the studio
  click handlers check `target.closest("button, .touch-none")` to avoid opening a closeup.

## API access

Only [`api/client.ts`](../../web/src/api/client.ts) knows the API exists. Two export shapes:

- **`async` fetch wrappers** that check `res.ok` and prefer the server's `detail` message:
  ```ts
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Upload failed (${res.status})`);
  }
  ```
- **URL builders** returning a plain string, for consumers that aren't `fetch` — `EventSource`,
  `sendBeacon`, `<img src>`, WaveSurfer's `url`, `downloadFile`.

Interfaces here are hand-mirrored from the Pydantic models; see
[../api/contract-sync.md](../api/contract-sync.md).

## Utilities

Pure functions in [`utils/`](../../web/src/utils/), one concern per file, each with a doc
comment stating the contract:

```ts
/** True if the vocals buffer carries real signal rather than near-silence. */
export function detectHasVocals(buffer: AudioBuffer): boolean
```

No shared "helpers" bucket — `time.ts`, `transpose.ts`, `lyrics.ts`, `download.ts`,
`hasVocals.ts` are each a single subject.

## Type-only imports

`verbatimModuleSyntax` is on in [`tsconfig.app.json`](../../web/tsconfig.app.json), so type
imports must be marked:

```ts
import type WaveSurfer from "wavesurfer.js";
import { downloadAllUrl, getChords, type ChordSegment, type Job } from "../api/client";
```

Inline `type` within a value import is the prevailing style. `noUnusedLocals` and
`noUnusedParameters` are also on — an unused variable **fails the build**, and the build runs
inside the Docker image.
