# Design decisions

Why the code is shaped the way it is. Each entry names the constraint, the choice, and what the
choice costs — so that a future change can weigh the same tradeoff rather than rediscover it.

## Web Audio instead of `<audio>` elements

**Constraint:** six stems must play as one piece of music, sample-aligned, while being muted,
re-leveled, looped and re-timed live.

**Choice:** one `AudioContext`, one clock. At 1×, one `AudioBufferSourceNode` per stem, all
started at the same `when` with the same `offset`; at any other speed, one worklet producing all
six. See [audio-playback.md](audio-playback.md).

**Cost:** every stem must be fully downloaded and decoded before playback can begin — the
*Loading stems…* wait — and a song's six decoded buffers stay resident while the results are
open. Decoded audio is 32-bit float at the context's sample rate: about 23 MB per stereo stem per
minute at 48 kHz, so roughly 1.7 GB for a twelve-minute track. There is no streaming path and no
progressive start, and that number is why the
[duration limit](#a-duration-limit-checked-before-separation) exists.

## Waveforms are CSS clip-path envelopes

**Constraint:** every stem row shows a waveform, audio truth already lives in `PlaybackEngine`,
and the design draws a waveform as a `.ch-wave` bar pattern.

**Choice:** no waveform library. [`waveformPolygon`](../../web/src/utils/peaks.ts) reduces each
decoded buffer to a 160-bin peak envelope expressed as a CSS `polygon()` — what the design template asked
for in place of its placeholder shapes — and
[`StemWaveform`](../../web/src/components/controls/StemWaveform.tsx) sets it as the element's
`clip-path`. This replaced WaveSurfer, which needed every stem fetched twice — an `ArrayBuffer` for
the engine, a media element for its cursor.

**Cost:** no per-row playhead, and a waveform isn't a seek target; position is shown and set on the
chord strip and the transport. The envelope is coarse and fixed — 160 bins whatever the length, so
4.5 s per bin on a twelve-minute track — and it is computed on the main thread while the stems load.
In exchange: one fetch per stem, and one dependency fewer.

## Pitch-preserving speed in an AudioWorklet

**Constraint:** practicing along means slowing a song down without changing its key, across six
stems that must stay aligned. `AudioBufferSourceNode.playbackRate` changes pitch with speed (the
`preservesPitch` switch exists only on media elements, ruled out above), and rendering stretched
copies ahead of time would mean producing — and holding — six more full-length buffers on every
rate change.

**Choice:** a WSOLA time-stretch in an `AudioWorklet`
([`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js)): one node produces every stem's
output, and all stems are cut at the same input positions, chosen by similarity on a
gain-weighted mix. The processor holds no audio; the main thread feeds it one-second blocks on
request. At 1× the buffer sources are used as before. The speed menu runs from 0.5× to 1.25×.

**Cost:**

- **A secure origin.** Browsers expose AudioWorklet only to HTTPS and `localhost`, so CHORD
  opened over plain HTTP from another machine plays at 1× only, with the speed chip disabled.
- **Main-thread block feeding.** Blocks are requested 3 s ahead and copied out of the decoded
  buffers on the main thread. A main thread busy long enough to leave a block unanswered is heard
  as silence.
- **WSOLA artifacts.** Output is assembled from 60 ms frames overlap-added at the best-matching
  offsets, and transients — drum hits especially — smear or double at the joins, most audibly
  when speeding up.
- Every rate change, and every seek while stretched, is a restart with an 80 ms gap, and the
  processor is plain JavaScript that `tsc -b` doesn't check.

## Metering from AnalyserNodes on the main thread

**Constraint:** the Console and Analog views need post-fader stem meters, master peak, true peak,
correlation and momentary loudness, moving every frame, on whatever origin CHORD is served from.

**Choice:** tap the graph with `AnalyserNode`s — after each stem's panner, after `masterGain`,
and after two K-weighting `IIRFilterNode`s — and compute every reading in `readMeters` on the
main thread, once per animation frame, only while a metering view is mounted. The views apply
ballistics and write the results straight to the DOM through `useAnimationFrame`, bypassing React
state. See [audio-playback.md](audio-playback.md#metering).

**Cost:** an AudioWorklet meter would see every sample; analysers give snapshots.

- **Per-frame reads.** Every frame copies twelve stem windows and two master windows, and the
  true-peak interpolation alone is about 150,000 multiply-adds.
- **Coverage depends on frame rate.** Below roughly 45 fps the 1024-sample stem windows stop
  covering the time between frames, and a short peak in the gap is never seen.
- **Approximate true peak.** A 12-tap kernel over the newest 2048 samples only — close enough for
  a display, not a compliance measurement. Loudness is momentary only: no short-term, integrated
  or gated value.

In exchange it works on any origin, needs no second worklet, and the Mixer view pays nothing.

## A single serial worker thread, not a task queue

**Constraint:** Demucs wants the whole GPU; two concurrent separations are slower than two
sequential ones and can exhaust VRAM.

**Choice:** one `queue.Queue` and one daemon thread in-process
([`worker.py`](../../server/app/pipeline/worker.py)).

**Cost:** the queue is memory-only. A restart silently orphans every queued and in-progress job
— their rows sit in a non-terminal status forever and nothing reaps them; a page still showing
such a job can revive it by cancelling and then resuming, and nothing else can. Nothing
de-duplicates entries either — a job id can sit in the queue twice — so `run_job` starts only on a
`queued` row, and the copy that reaches the worker after the job has run returns without doing
anything (see [job-lifecycle.md](job-lifecycle.md#resuming)). Multiple uvicorn workers would
break the model outright (one queue per process). Replacing this with Celery/RQ + Redis is the
obvious upgrade path and the reason the pipeline modules take no database handles.

## The database row is the only progress channel

**Constraint:** the worker thread and the HTTP request handlers are different threads; the UI
needs sub-second progress, and a cancel or resume has to reach a running job.

**Choice:** stages `UPDATE` the row; the SSE endpoint re-reads the row every 0.5 s and yields on
change. Control travels the same way in reverse: cancel and resume are row writes, and the worker
discovers them by re-reading the row. No queues, no pub/sub, no shared memory between the two.

**Cost:** up to 500 ms of latency, one SELECT per subscriber per tick, and a blocking SQLite read
from inside the async event loop. Measured separation progress adds up to 40 writes per job, one
per 1%, and the worker re-reads the row every 2 s during separation to notice a cancel. Trivially
correct and trivially debuggable (`sqlite3` the file and you can see exactly what the UI will
show), which is worth more here than the efficiency.

## Cooperative cancellation

**Constraint:** you cannot safely interrupt a torch forward pass, a yt-dlp download or a
librosa/madmom analysis mid-flight.

**Choice:** cancel writes `status=cancelled`; the worker re-reads the row between stages and
returns early. Separation, the longest stage, checks as well: Demucs calls CHORD's progress
callback as each chunk starts, and that callback re-reads the row at most every 2 s and raises to
abandon the pass. Nothing half-written survives, because stems go to `stems.partial/` and are
renamed into place only once all six exist.

**Cost:** a cancel during a download, tempo detection or chord detection still burns that whole
stage. During separation it takes effect at the first chunk start at least 2 s after the previous
check — up to that interval plus one chunk of work. The UI reports *Cancelled* immediately, which
slightly overstates what happened. See [job-lifecycle.md](job-lifecycle.md#cancelling).

## An attempt counter makes resume safe

**Constraint:** a cancelled job should resume without redoing finished work — but its cancelled
run may still be inside a stage when the user resumes, and resume flips the row back to `queued`,
which a status check alone would read as "carry on".

**Choice:** an internal `attempt` column, incremented by `POST /jobs/{id}/resume`. `run_job`
reads it once at the start; every write it makes is `UPDATE … WHERE id = ? AND attempt = ? AND
status != 'cancelled'`, and every checkpoint asks `_is_superseded` — row gone, `cancelled`, or a
different attempt. The resumed run reuses what the cancelled one finished: `original.mp3` for a
URL job, and `stems/` when all six WAVs are present, which the rename-into-place makes
trustworthy.

**Cost:** a superseded write is dropped silently — `_update_job` never checks how many rows it
matched — so anything a later attempt needs and can't produce again has to opt out of the guard.
The title and uploader a download finds are that case: the resumed run skips the download, so
`_record_track_identity` writes them by id alone, and they survive a cancel that lands mid-download.
Any new write of that kind needs the same deliberate exception. `attempt` isn't in `JobResponse`,
so only `sqlite3` shows it. Resume accepts only `cancelled` — not `error` — and re-runs tempo and
chord detection even when the cancelled attempt had finished them. And it enqueues without knowing
whether the job is still waiting in the queue, so a job can be queued twice; `run_job` starting only
on a `queued` row is what turns the extra entry into a no-op. See
[job-lifecycle.md](job-lifecycle.md#resuming).

## A user-facing message and a separate log

**Constraint:** a failed job must tell the user something they can act on, but the `str()` of an
arbitrary library exception reads as internal — and whoever debugs the failure still needs that
text.

**Choice:** two columns. A [`UserFacingError`](../../server/app/pipeline/errors.py) — which
`SourceDownloadError` and `TrackTooLongError` subclass — is written for a person: its text becomes
`error_message` verbatim, and the exception it was raised `from` becomes `error_log`. Any other
exception gets a fixed sentence for the stage that failed as the message, and `"TypeName: text"`
as the log. The failure panel shows the message as its body and the log in a monospace block, and
*Copy log* copies the log — or the message, when there is no log.

**Cost:** the log is one line of text, not a traceback — the traceback still goes only to stderr.
A new failure reaches users in its own words only if its exception type opts in by subclassing
`UserFacingError`. The stage is coarse (downloading, reading, separating, tempo, analyzing), and it
never reaches the panel's title: every job error is titled *Separation failed*, the template's title,
so a failed download or an unreadable file says what happened only in its body.

## A duration limit, checked before separation

**Constraint:** six decoded stems of a long track outgrow what a browser tab can hold (see
[Web Audio](#web-audio-instead-of-audio-elements) above), and separating a track nobody can play
wastes the only worker.

**Choice:** `MAX_DURATION_SECONDS`, 720 by default, `0` to disable. A URL job is refused from
yt-dlp's metadata through a `match_filter`, before any audio downloads; every job is checked again
with `soundfile` once its audio is on disk, before separation. Both raise `TrackTooLongError`,
whose message names the limit and the track's length, rounded up to the second so that a track a
moment over a whole-minute limit never reads as exactly the limit.

**Cost:** long material — DJ mixes, live sets, long classical movements — can't be processed at
all, and the limit is a proxy for browser memory, not a measurement of it. The landing page's
*"up to 12 minutes"* is hardcoded in [`design/copy.ts`](../../web/src/design/copy.ts), so changing
the setting makes that copy wrong. An upload is refused only after it has been uploaded and queued,
and so is a link whose metadata carries no duration.

## Lyrics are fetched by the API, not the pipeline

**Constraint:** lyrics come from a third-party service (lrclib.net), are frequently absent, and
are irrelevant to an instrumental.

**Choice:** `GET /jobs/{id}/lyrics` does the lookup on first request and caches the result — the
JSON *or* a literal `null` — to `analysis/lyrics.json`. `PUT` on the same path overwrites that
cache with lyrics the user pasted, a cached `null` included.

**Cost:** the one place where an API handler does real work and makes an outbound network call,
breaking the otherwise-strict layering. The lookup is synchronous, so the handler is a plain `def`
that FastAPI runs in its threadpool — a first lookup holds a pool thread for its seconds instead of
stalling the event loop. In exchange, a lrclib outage
can never fail or delay a job, and songs nobody asks about are never looked up. Caching the `null`
matters: it's what stops a miss from re-querying on every mount. Pasted timing is kept exactly as
pasted, without the offset correction a lookup's synced lyrics get.

## Discard-on-leave

**Constraint:** no accounts, no sessions, no storage budget. Uncompressed stems are hundreds of
MB per song.

**Choice:** the browser fires `navigator.sendBeacon` at the discard endpoint on `pagehide` and on
effect cleanup; the server deletes the row and the directory for a finished job.

**Cost:** **there is no history.** Clicking *New track* destroys the job you were looking at,
and a cancelled job can be resumed only while its page stays open. A hard tab crash skips the
beacon and leaks the directory forever. `GET /jobs` still exists and lists everything, so the
data model could support a library — the client never asks for one.

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
material. When it switches to the relative key it keeps the classifier's confidence for the key
it overruled, so the *"N% confident"* beside the key can describe a key other than the one shown.
The transpose control can't repair a relative-key mistake either: it moves the root and keeps the
mode.

## Transposition is client-side and display-only

**Constraint:** a detected key is often a semitone off, or the player wants a capo position.

**Choice:** `transpose` is part of the design's `PlayerState`, clamped to ±11 by
[`playerReducer`](../../web/src/screens/results/playerReducer.ts) with `MIN_TRANSPOSE` and
`MAX_TRANSPOSE`, which are declared once, in [`design/player.ts`](../../web/src/design/player.ts) —
twelve semitones is the same pitch class as zero. `transposeChord` / `transposeKeyLabel` rewrite
labels at render time: the key, the current and upcoming chords, and every segment of the chord
strip.

**Cost:** nothing is re-analyzed and no audio is pitch-shifted — the chords you read no longer
match the chords you hear. That is the intended behavior (the control's hint says *"chords
follow"*; it's for a player following along with a capo), but it is a real semantic gap, and it
is not persisted anywhere: every visit starts at 0.

## The fader law is dB-linear over 36 dB

**Constraint:** a fader position has to read as a level, and each console strip's tick column is
evenly spaced — 0 / −12 / −24 / −∞ beside a stem, 0 / −6 / −18 / −∞ beside the master — columns
the template's demo mapping, 0…1 onto −12…0 dB, couldn't fill.

**Choice:** keep the template's `db()` — its instructions said to change only its body when the
audio graph's taper differs — and give it a 36 dB span. In [`design/player.ts`](../../web/src/design/player.ts)
a stem fader's position maps linearly onto −36…0 dB, with position 0 silent. The stem meter scale,
`STEM_METER_SCALE`, is linear over the same 36 dB, so a fader cap sits level with its tick. Level
faders and knobs share that law. The master fader follows its own ticks instead: `masterDb` runs
position through `MASTER_TICKS` — −36, −18, −6 and 0 dB at each third of the travel, the bottom
silent — and `MASTER_METER_SCALE` is derived from the same anchors, so the master cap, its meter
and its tick labels agree. The engine only ever receives linear gain, through `dbToGain`.

**Cost:** there is no boost — the top of every fader is unity, so a stem can't be raised above
its separated level. The bottom of the travel is a cliff, from −36 dB straight to silence. A
keyboard step is fixed in position, so one arrow press is 0.36 dB anywhere on a stem fader but
anything from 0.18 dB near the top of the master to 0.54 dB near its bottom. And the two laws
disagree about the same position: halfway up is −18 dB on a stem and −12 dB on the master.

## The UI was built from a design template

**Constraint:** the design arrived as a template in a `web/template/` folder, not as components:
written rules (`INSTRUCTIONS.md` and `README.md`), vendored stylesheets, a markup harness
(`CHORD Template.dc.html`) and a static Mockups board (`CHORD Mockups.dc.html`). The four didn't
always agree with each other, and the app had grown behavior none of them drew. The originals can
still be read from git, as `git show 2a9783e:web/template/template/INSTRUCTIONS.md` and
`git show "2a9783e:web/template/CHORD Template.dc.html"`.

**Choice:** build to the template and, where it disagreed with itself, take the written rules
first, then the stylesheets, then the harness markup, then the Mockups board. Once the UI was
built, the template's binding rules moved into [../conventions/design.md](../conventions/design.md),
which is now the design standard, with the screens in [`web/src/screens/`](../../web/src/screens/)
as its reference implementation, and the folder was removed. The screens' copy lives in
[`design/copy.ts`](../../web/src/design/copy.ts), verbatim from the harness unless marked
app-authored, and the template's state model in [`design/player.ts`](../../web/src/design/player.ts).
The calls that took a decision:

- **Phones follow the written rules, not the harness's phone frame.** The template's responsive
  rules locked a phone to the Mixer and let the stylesheet stack `.ch-stemrow` with 44 px
  MUTE/SOLO. The harness's phone frame drew a different screen — stem cards, a compact header with
  key and tempo, an *Export* chip, two upcoming chords — which the app used to follow. The rules
  outranked the markup, so a phone now gets the desktop screen reflowed
  ([what that costs](#narrow-screens-get-the-mixer-view-only)).
- **Two template lines are reworded, because they promise behavior the app doesn't have.** The
  cancelled panel's *"The upload is still in your queue for 24 hours"* reads *"The upload is kept
  until you leave this page"*, since [leaving discards the job](#discard-on-leave); the connection
  panel's *Work offline* names a mode that doesn't exist, so it reads *New track*. Both are marked
  where they live in `copy.ts`.
- **The footer stays**, though the template had none; its strings are app-authored in `copy.ts`.
- **Four things the app had and the template didn't draw were removed:** the sticky transport,
  the upload progress bar, the loop A/B markers on the chord strip, and the speed chip on phones.
- **Solo shows before mute.** The written rules gave `.is-active` to a soloed strip and `.is-off` to
  a muted one without saying which wins; the harness picked solo, so a soloed Console strip or Analog
  module reads *Soloed* and lifts even when it is also muted. The audio is unchanged —
  [mute still beats solo](audio-playback.md#mute-solo-and-volume).
- **Every control shows its value, the Analog Tone and Pan knobs included.** The template's ground
  rules asked for a visible label and value on every control; the harness drew those two knobs with
  a label only, so the written rule won.
- **Loading stems is the template's `processing-loading` state:** the processing screen at 100%,
  *Loading stems…*, *Decoding six stems in your browser*. `PlaybackEngine.load` no longer reports
  progress.

**Cost:**

- A soloed, muted stem's strip and its audio disagree: it reads *Soloed* and lifts, and is silent.
- Waiting has no measure. An upload reads *Submitting…* and stem loading sits at 100% under a hint
  about decoding, however long either takes and whichever part is slow.
- A set loop shows only in the loop chip's label, and a Console panel taller than the window
  scrolls the transport out of view.
- Every job error is titled *Separation failed*, the template's title, a failed download or an
  unreadable file included, so the body has to carry the specifics.
- A stem the design has no name or hue for isn't loaded at all; a Demucs model with a different
  stem set needs `STEM_KEYS` changed with it.
- With the template gone, nothing outside the code shows a screen as designed: a UI change is
  checked by hand against design.md and the existing screens
  ([Checking a UI change](../conventions/design.md#checking-a-ui-change)), and `npm run lint` checks
  tokens, classes and colours against the stylesheets, not copy or layout.

## A fixed Nocturne palette instead of per-song accents

**Constraint:** the design defines CHORD's look as a token system — six low-chroma stem hues,
two status hues, the Nocturne neutral and accent ramps — and its contrast floors hold only for
those values.

**Choice:** one fixed palette, from [`nocturne.css`](../../web/src/styles/nocturne.css) and
[`chord-theme.css`](../../web/src/styles/chord-theme.css). Nothing is derived from the cover art;
the artwork appears only inside its own tile, blended over an accent gradient through Nocturne's
`.lighten`. This replaced `useDominantColors`, which clustered the thumbnail into two accent
colors at runtime.

**Cost:** every song looks the same. A new color means a new token in a vendored stylesheet —
the design's rule is a token in Nocturne, never a hex in a component, and `npm run lint` rejects
a hex colour or colour function in app code, a shadow's black apart — and with the template
removed, no upstream copy shows what a stylesheet edited here was. What went away with the per-song accent: a color that
resolved after first paint, the effects that re-applied it, and a canvas-taint fallback for
cross-origin art.

## Vendored stylesheets, driven by custom properties

**Constraint:** the design arrived as a stylesheet plus markup to diff against (the template, since
removed), not as components, and many controls change continuously — fader drags,
meters at frame rate.

**Choice:** vendor `chord-theme.css` unmodified and `nocturne.css` with only its font `@import`
removed, import both before Tailwind, reproduce the template's markup element for element, and pass
runtime state as custom properties — `--v`, `--l`, `--p`, `--stem` — that the classes map onto
geometry and color. App CSS defines no classes of its own. See [web.md](web.md#styling).

**Cost:** the class contract is stringly typed, and every custom property needs an
`as React.CSSProperties` cast. The design check in `npm run lint` catches a `ch-`, `is-`, `btn` or
`dialog` class the stylesheets don't define, and a custom property outside the four, but only when
someone runs it. The 720px breakpoint lives in the stylesheet and is repeated by hand in
`PHONE_QUERY` and in Tailwind `max-[720px]:` utilities. Because the check also rejects a class
defined in app CSS, a departure from the design can't be a local override: it has to be a
composition of the vendored classes plus inline layout, or nothing. Both sheets are global and
unscoped. In exchange, a control update is one property write.

## Prop threading instead of context or a store

**Constraint:** all playback state has exactly one owner (`ResultsScreen`) and all consumers are
its descendants, at most three levels below it.

**Choice:** pass props. Per-stem state goes down as one `stems: StemDisplay[]` array, each entry
carrying the design's `StemState`, and the per-stem callbacks as one `controls: StemControls`
object, both rebuilt every render; the metering views receive a single `readMeters` callback rather
than the engine. `PlayerState` itself changes only through one reducer.

**Cost:** verbosity — `Transport` alone takes twelve props — and every new piece of state
touches several signatures. Because `stems` and `controls` are new objects on every render,
memoizing a view would gain nothing, and the whole results tree re-renders on every clock tick
during playback. In exchange the data flow is completely explicit, and no descendant can mutate
playback except through a callback it was handed.

## Three result views over one state

**Constraint:** the design presents the same mix three ways — Mixer (rows with waveforms),
Console (vertical faders and meters), Analog (knobs and needle dials) — and switching between
them must not interrupt playback.

**Choice:** `ResultsScreen` renders exactly one view into a panel, from the same `stems` and
`controls`; the topbar, analysis bar, chord bar and transport sit outside the panel and stay
mounted. No view holds playback state. See [../features/results-views.md](../features/results-views.md).

**Cost:** each view has its own per-stem component — `StemRow`, `ConsoleStrip`, `AnalogModule` —
because each followed the template harness's markup rather than a shared strip, and the copies can
drift. `ConsoleStrip` and `AnalogModule` both pick `is-active` / `is-off` solo first, as the harness
did,
and nothing but review keeps the two in step. The views don't expose the same controls either: Pan
and Tone can be changed only on the Analog knobs, and the Console shows pan as text. A switch
unmounts the old view, so its meter ballistics start over, and the choice isn't remembered —
results always open on Mixer. The payoff is that switching mid-song is immediate and seamless: the
engine never stops.

## Narrow screens get the Mixer view only

**Constraint:** Console strips need 112 px each, Analog modules 120 px and its dials 180 px, or
their controls collapse; a phone is about 360 px wide.

**Choice:** a single breakpoint at 720px and, below it, the template's responsive rules, now
[Responsive](../conventions/design.md#responsive): lock to the Mixer and
render no view tabs. The same screen reflows rather than switching to a separate phone layout — the
stylesheet stacks each `.ch-stemrow` into name, fader with its readout, MUTE/SOLO at 44 px and
waveform; `MixerView` hides the column labels whose columns are gone, and `AnalysisBar` the
dividers between its wrapped groups; the analysis bar and the full chord bar stay; and only the
transport changes markup, to `.ch-m-bar` with play,
seek and a *Click* metronome chip. Above the breakpoint, strip rows scroll horizontally at their
floors rather than shrink. This replaced `ScaleToFit`, which kept fixed-width layouts intact by
transform-scaling them, text included, and later a phone layout built from the harness's phone
frame, which the template's written rules outranked ([why](#the-ui-was-built-from-a-design-template)).

**Cost:** on a narrow screen Pan, Tone, every meter, speed and A–B looping are unreachable — the
`.ch-m-bar` has no speed or loop chip, and no time readouts. A speed or loop set before the window
narrowed stays in force with no control to change it. The stacked rows make a long page: six stems,
four lines each, under the analysis and chord bars. Resizing across the breakpoint switches the
view to Mixer and back under the user.

## SQLite, no ORM, hand-rolled additive migrations

**Constraint:** single-node app, one writer, tiny schema.

**Choice:** raw `sqlite3` with `row_factory = sqlite3.Row`, a new connection per `db_cursor()`
block, and `init_db()` diffing `PRAGMA table_info` against a hardcoded `MIGRATED_COLUMNS` list.

**Cost:** additive changes only — no rename, no drop, no down-migration, no version table. Adding
a column means editing `SCHEMA` *and* `MIGRATED_COLUMNS`, as `error_log`, `audio_format` and
`attempt` were; a `NOT NULL` column such as `attempt` can be added only because it has a non-null
default, which SQLite requires for `ADD COLUMN`. A per-call connection is wasteful but completely
sidesteps SQLite's cross-thread rules between the worker and request handlers.

## The API contract is duplicated by hand

**Constraint:** Pydantic models on one side, TypeScript on the other.

**Choice:** hand-mirror them. `JobResponse` ↔ `Job`, `ChordSegment` ↔ `ChordSegment`,
`LyricsResponse` ↔ `Lyrics`, `JobStatus` ↔ a string union; `SaveLyricsRequest` has no named twin,
since `saveLyrics` builds `{ text }` inline. Part of the contract is values no type describes: the
stage messages, which [`design/copy.ts`](../../web/src/design/copy.ts) mirrors verbatim as
`processingCopy.stages` and [`design/stages.ts`](../../web/src/design/stages.ts) matches against
`stage_message`, and the separation span, which
[`ProcessingScreen`](../../web/src/screens/processing/ProcessingScreen.tsx) copies as
`SEPARATION_PROGRESS_END = 0.5` from `_SEPARATION_PROGRESS` in `pipeline.py`.

**Cost:** nothing enforces agreement; a server field rename — or a reworded stage message — is a
silent client break. FastAPI already publishes an OpenAPI schema at `/openapi.json`, so generating
the types is available whenever the duplication starts to hurt, though it wouldn't cover those
values. See [../api/contract-sync.md](../api/contract-sync.md).

## madmom is patched in place

**Constraint:** madmom is the best available open chord/key detector and has been unmaintained
since 2018. It does not install on a modern Python/numpy.

**Choice:** keep it out of `requirements.txt`, install it with `--no-build-isolation`, then
`sed` the installed package in site-packages
([`patch_madmom.sh`](../../server/scripts/patch_madmom.sh)).

**Cost:** the ugliest part of the build, and the reason the server is pinned to Python 3.10. The
patches are two known breakages (`collections.MutableSequence`, removed `np.*` aliases); a third
would mean extending the script. `enable_chord_detection=False` exists as the escape hatch.
