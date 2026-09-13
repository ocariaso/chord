# Design decisions

Why the code is shaped the way it is. Each entry names the constraint, the choice, and what the
choice costs — so that a future change can weigh the same tradeoff rather than rediscover it.

## Web Audio instead of `<audio>` elements

**Constraint:** six stems must play as one piece of music, sample-aligned, while being muted and
re-leveled live.

**Choice:** one `AudioContext`, one `AudioBufferSourceNode` per stem, all started at the same
`when` with the same `offset`. See [audio-playback.md](audio-playback.md).

**Cost:** every stem must be fully downloaded and decoded before playback can begin — the
"Loading stems…" wait, and a full song's six uncompressed buffers resident in memory. There is no
streaming path and no progressive start.

## WaveSurfer draws; it never plays

**Constraint:** we need six waveform displays, but audio truth already lives in `PlaybackEngine`.

**Choice:** create each instance with `interact: false` and push `setTime()` from the shared
animation-frame loop. Seeking is a separate pointer-handler hook (`useSeekDrag`) that talks to
the engine.

**Cost:** each stem URL is fetched twice — once as an `ArrayBuffer` for decoding, once as a media
element so WaveSurfer has a real duration for cursor math. Usually the second is a cache hit.
Passing `peaks` at least avoids a second *decode*.

## A single serial worker thread, not a task queue

**Constraint:** Demucs wants the whole GPU; two concurrent separations are slower than two
sequential ones and can exhaust VRAM.

**Choice:** one `queue.Queue` and one daemon thread in-process
([`worker.py`](../../server/app/pipeline/worker.py)).

**Cost:** the queue is memory-only. A restart silently orphans every queued and in-progress job
— their rows sit in a non-terminal status forever, and nothing reaps them. Multiple uvicorn
workers would break the model outright (one queue per process). Replacing this with Celery/RQ +
Redis is the obvious upgrade path and the reason the pipeline modules take no database handles.

## The database row is the only progress channel

**Constraint:** the worker thread and the HTTP request handlers are different threads; the UI
needs sub-second progress.

**Choice:** stages `UPDATE` the row; the SSE endpoint re-reads the row every 0.5 s and yields on
change. No queues, no pub/sub, no shared memory between the two.

**Cost:** up to 500 ms of latency, one SELECT per subscriber per tick, and a blocking SQLite read
from inside the async event loop. Trivially correct and trivially debuggable (`sqlite3` the file
and you can see exactly what the UI will show), which is worth more here than the efficiency.

## Cooperative cancellation

**Constraint:** you cannot safely interrupt a torch forward pass or a yt-dlp download mid-flight.

**Choice:** cancel writes `status=cancelled`; the worker re-reads the row between stages and
returns early.

**Cost:** a cancel during separation still burns the full separation. The UI reports "Cancelled"
immediately, which slightly overstates what happened. See
[job-lifecycle.md](job-lifecycle.md#cancelling).

## Lyrics are fetched by the API, not the pipeline

**Constraint:** lyrics come from a third-party service (lrclib.net), are frequently absent, and
are irrelevant to an instrumental.

**Choice:** `GET /jobs/{id}/lyrics` does the lookup on first request and caches the result — the
JSON *or* a literal `null` — to `analysis/lyrics.json`.

**Cost:** the one place where an API handler does real work and makes an outbound network call,
breaking the otherwise-strict layering. In exchange, a lrclib outage can never fail or delay a
job, and songs nobody asks about are never looked up. Caching the `null` matters: it's what stops
a miss from re-querying on every mount.

## Discard-on-leave

**Constraint:** no accounts, no sessions, no storage budget. Uncompressed stems are hundreds of
MB per song.

**Choice:** the browser fires `navigator.sendBeacon` at the discard endpoint on `pagehide` and on
effect cleanup; the server deletes the row and the directory for a finished job.

**Cost:** **there is no history.** Clicking "Upload another song" destroys the job you were just
looking at. A hard tab crash skips the beacon and leaks the directory forever. `GET /jobs` still
exists and lists everything, so the data model could support a library — the client simply never
asks for one.

## Sharps everywhere, normalized at the boundary

**Constraint:** madmom's key model emits flat spellings (`Db major`); the chord model emits
`C#:min`-style labels; the UI wants one convention.

**Choice:** normalize on the way in, inside
[`chords.py`](../../server/app/pipeline/chords.py) — `_FLAT_TO_SHARP` maps the seven flat names
to enharmonic sharps, and `_madmom_label_to_chord` rewrites `X:maj` → `X`, `X:min` → `Xm`.
Everything downstream (JSON, database, UI, transposition) deals only in sharps.

**Cost:** keys that musicians would write in flats display in sharps (`A# minor`, not
`Bb minor`). The 12-name `NOTE_NAMES` array is duplicated in
[`transpose.ts`](../../web/src/utils/transpose.ts) — client-side transposition needs it and there
is no shared module.

## Relative-key disambiguation by chord duration

**Constraint:** a CNN key classifier confuses a major key with its relative minor constantly —
they share a pitch-class set.

**Choice:** `_resolve_relative_ambiguity` totals the played duration of the tonic chord for each
candidate and picks the heavier one.

**Cost:** a heuristic, not a theory-complete answer; it can be wrong on modal or chromatic
material. Mitigated in the UI by exposing a manual transpose control, whose tooltip says exactly
that: *"Adjust the key if detected wrong."*

## Transposition is client-side and display-only

**Constraint:** a detected key is often a semitone off, or the player wants a capo position.

**Choice:** `transpose` is React state in `StemMixer`; `transposeChord` / `transposeKeyLabel`
rewrite labels at render time.

**Cost:** nothing is re-analyzed and no audio is pitch-shifted — the chords you read no longer
match the chords you hear. That is the intended behavior (it's for a player following along with
a capo), but it is a real semantic gap, and it is not persisted anywhere.

## Accent colors sampled from the cover art

**Constraint:** a mixer that looks the same for every song feels dead.

**Choice:** [`useDominantColors`](../../web/src/hooks/useDominantColor.ts) draws the thumbnail to
a 32×32 canvas, runs a six-iteration 2-means clustering over the 1024 pixels, and clamps the two
cluster centroids into a legible saturation/lightness band.

**Cost:** the accent resolves *after* first paint, so components created with a color (WaveSurfer
instances) need an explicit update effect. A cross-origin image would taint the canvas — caught
and ignored, falling back to the default blue. The 32×32 downsample is the whole reason this is
cheap enough to do synchronously in an `onload`.

## Prop threading instead of context or a store

**Constraint:** all playback state has exactly one owner (`StemMixer`) and all consumers are its
descendants, at most four levels deep.

**Choice:** pass props. `StudioMixer`'s props interface is ~40 lines; `masterProps` is assembled
once and spread into both `MasterUnit` and `MasterCloseup`.

**Cost:** verbosity, and every new piece of state touches several signatures. In exchange the
data flow is completely explicit, and no descendant can mutate playback except through a callback
it was handed.

## Two mixer views over one state

**Constraint:** the Simple view should be legible; the Studio view is the personality of the app.

**Choice:** both views are built in the same `StemMixer` render and one is chosen at the end.
Neither holds playback state.

**Cost:** the component is long. The payoff is that switching views mid-song is seamless — the
engine never stops, only the chrome unmounts — and the fade in `changeViewMode` exists purely to
hide the remount, guarded by a token so rapid toggling can't leave the UI invisible.

## Amps are bespoke, not configured

**Constraint:** each stem should feel like a different piece of gear.

**Choice:** six separate components in
[`web/src/components/studio/amps/`](../../web/src/components/studio/amps/), sharing only
`AmpProps`, the knob/waveform/download hooks, and the width constants. `ScallopedKnob` exists
solely so Bass's two-layer chrome knob isn't reused elsewhere — that's stated in its own doc
comment.

**Cost:** deliberate duplication. `AMP_COMPONENTS` maps stem name → component with `OtherAmp` as
the fallback, so an unknown stem still renders. A shared "amp shell" abstraction would collapse
the duplication and the point of the feature with it.

## `ScaleToFit` transforms; it does not reflow

**Constraint:** the Studio view is drawn at fixed pixel widths (`AMP_WIDTH = 480`,
`MASTER_WIDTH = 984`) because its whole aesthetic depends on precise geometry. Phones are 360 px.

**Choice:** [`ScaleToFit`](../../web/src/components/studio/ScaleToFit.tsx) measures the child's
natural `offsetWidth`, computes `min(1, available / natural)` and applies a CSS `transform:
scale()`. Never scales above 1, so desktop is a no-op.

**Cost:** text shrinks with everything else and can become small. Mitigated by narrower mobile
design widths (`AMP_MOBILE_WIDTH`, `MASTER_MOBILE_WIDTH` = 340) that reflow *before* scaling
kicks in, and by the tap-to-zoom closeup overlays.

## SQLite, no ORM, hand-rolled additive migrations

**Constraint:** single-node app, one writer, tiny schema.

**Choice:** raw `sqlite3` with `row_factory = sqlite3.Row`, a new connection per `db_cursor()`
block, and `init_db()` diffing `PRAGMA table_info` against a hardcoded `MIGRATED_COLUMNS` list.

**Cost:** additive changes only — no rename, no drop, no down-migration, no version table. Adding
a column means editing `SCHEMA` *and* `MIGRATED_COLUMNS`. A per-call connection is wasteful but
completely sidesteps SQLite's cross-thread rules between the worker and request handlers.

## The API contract is duplicated by hand

**Constraint:** Pydantic models on one side, TypeScript on the other.

**Choice:** hand-mirror them. `JobResponse` ↔ `Job`, `ChordSegment` ↔ `ChordSegment`,
`LyricsResponse` ↔ `Lyrics`, `JobStatus` ↔ a string union.

**Cost:** nothing enforces agreement; a server field rename is a silent client break. FastAPI
already publishes an OpenAPI schema at `/openapi.json`, so generating the client is available
whenever the duplication starts to hurt. See
[../api/contract-sync.md](../api/contract-sync.md).

## madmom is patched in place

**Constraint:** madmom is the best available open chord/key detector and has been unmaintained
since 2018. It does not install on a modern Python/numpy.

**Choice:** keep it out of `requirements.txt`, install it with `--no-build-isolation`, then
`sed` the installed package in site-packages
([`patch_madmom.sh`](../../server/scripts/patch_madmom.sh)).

**Cost:** the ugliest part of the build, and the reason the server is pinned to Python 3.10. The
patches are two known breakages (`collections.MutableSequence`, removed `np.*` aliases); a third
would mean extending the script. `enable_chord_detection=False` exists as the escape hatch.
