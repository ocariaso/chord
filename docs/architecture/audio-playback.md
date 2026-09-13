# Audio playback

The mixer's defining constraint: six separate WAV files must play as one piece of music, with
sample-accurate alignment, while the user mutes, solos, re-levels, pans and tilts them live —
and loops a region, or changes speed without changing pitch.

## Why not `<audio>` elements

Six `<audio>` elements cannot be kept in sync. Each has its own clock, its own buffering
behavior and its own `play()` latency; drift is audible within seconds, and seeking six
elements to the same position is inherently racy.

The Web Audio API solves this: `AudioContext` has **one** clock, and
`AudioBufferSourceNode.start(when, offset)` schedules against it. Six sources started at the
same `when` with the same `offset` are sample-locked by construction — there is nothing left to
drift.

The cost is that every stem must be fully downloaded and decoded into an `AudioBuffer` before
playback can start. That's the *Loading stems…* screen, which holds at 100% with *Decoding six
stems in your browser* until the last stem has arrived and decoded.

## `PlaybackEngine`

[`web/src/audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) (~635 lines) — a
plain class, no React. It owns the `AudioContext` and is the single source of truth for audio
state. The DSP helpers behind its meters live in
[`audio/meters.ts`](../../web/src/audio/meters.ts); the time-stretch runs on the audio thread in
[`audio/stretchProcessor.js`](../../web/src/audio/stretchProcessor.js).

### Graph

```text
  AudioBufferSourceNode             chord-stretch AudioWorkletNode
  at 1×: one per stem,        or    at any other rate: one node,
  recreated on every play           one stereo output per stem
               └────────────────┬────────────────┘
                                ▼                                   ── per stem ──
                     lowshelf → highshelf       Tone: tilt around the stem's pivot
                                ▼
                            GainNode            fader gain, or 0 when muted / not soloed
                                ▼
                        StereoPannerNode        Pan
                                ├──► splitter ─► 2 × Analyser (1024)      stem meter
                                ▼                                   ── shared ──
                           masterGain           master fader
                                ├──► splitter ─► 2 × Analyser (4096)      peak, true peak, correlation
                                ├──► IIR shelf ─► IIR high-pass ─► splitter ─► 2 × Analyser (32768)
                                │    (K-weighting)                        momentary loudness
                                ▼
                           destination ◄──── metronomeGain ◄── Oscillator + envelope Gain
                                                                 (one pair per click)
```

Each stem's chain is built in `addStem` as its buffer decodes and outlives every play; only the
sources in front of it are replaced.

- **Tone** is a tilt. `setTone(name, shelfDb)` sets the high shelf to `+shelfDb` and the low
  shelf to `−shelfDb`, both at the stem's pivot (`TONE_PIVOT_HZ` in
  [`design/stems.ts`](../../web/src/design/stems.ts): bass 250 Hz, piano and other 1 kHz, guitar
  1.2 kHz, vocals 1.5 kHz, drums 2 kHz). The knob's ends are ±6 dB.
- **Pan** is a `StereoPannerNode`; the knob's 0…1 becomes −1…1.
- **Analysers are dead ends** — nothing is connected after them — and every tap sits after the
  fader and panner, so every meter is post-fader. The two IIR filters exist only for the loudness
  tap: BS.1770 K-weighting, with coefficients derived for the context's sample rate by
  `kWeightingFilters`, because the standard tabulates them only at 48 kHz.

The metronome bypasses `masterGain` and connects straight to `destination`, so the master fader
does not attenuate the click and no meter sees it. Whether that's desirable is a design choice,
but it's deliberate: the click is a practice aid, not part of the mix.

### Transport

State is a handful of fields:

```ts
private anchorTrackTime = 0;     // track position at the anchor
private anchorContextTime = 0;   // audioContext.currentTime at which that position is heard
private rate = 1;
private loop: LoopRegion | null = null;
private playing = false;
private transportToken = 0;      // bumped whenever output stops
```

and the clock is derived, never stored:

```ts
getCurrentTime(): number {
  if (!this.playing) return this.anchorTrackTime;
  const elapsed = Math.max(0, this.audioContext.currentTime - this.anchorContextTime) * this.rate;
  return Math.min(this.wrap(this.anchorTrackTime + elapsed), this.duration);
}
```

`wrap` folds any position past `loop.end` back into `[loop.start, loop.end)`. The `max(0, …)`
holds the position still during the short delay between scheduling a stretched start and
hearing it.

- **`play()`** takes a new transport token and resumes the context if it is suspended (browsers
  start it suspended until a user gesture). If a pause, seek or rate change bumped the token
  while it awaited, it abandons the start. Playing from the end restarts at the loop start, or
  zero. At 1× it creates a *fresh* `AudioBufferSourceNode` per stem and starts every one at the
  same `currentTime` with the same offset — source nodes are single-use by spec, which is why
  they're recreated rather than reused. At any other rate it starts the stretch processor
  instead; if the worklet can't be loaded, playback falls back to 1×.
- **`pause()`** captures `getCurrentTime()` into the anchor and stops output. With a start still
  pending, it only bumps the token, which abandons that start.
- **`seek(s)`** stops output, sets the anchor clamped to `[0, duration]`, and replays if it was
  playing. There is no partial-seek path: a seek is a restart.
- **`hasEnded`** turns true once playback without a loop reaches `duration`. The engine doesn't
  stop itself; `ResultsScreen`'s frame loop sees the flag and pauses.

`duration` is the **max** of all buffer durations, not the first — stems can differ by a frame
or two. Decoding resamples to the context's rate and can leave a stem a frame short of its written
length — a 36-second track decodes to 35.99998 s at 44.1 kHz — so
[`formatTime`](../../web/src/utils/time.ts) adds 5 ms before flooring, or the readouts would call
it `0:35`.

### Loops

`setLoop({start, end})` stores the region and seeks to `start`. At 1× the buffer sources loop
natively (`loop`, `loopStart`, `loopEnd`), so each cycle wraps sample-accurately with no work on
the main thread; the stretch processor wraps its read position with the same arithmetic as
`wrap`.

`clearLoop()` at 1× during playback sets `loop = false` on the running sources and re-anchors at
the current position: the sources carry on from wherever they are, so leaving a loop is
seamless. While stretching, it seeks instead, which restarts output.

The A–B press cycle, and ending a loop by seeking outside it, belong to `ResultsScreen`; the engine
only ever sees a complete region. See [../features/speed-and-loop.md](../features/speed-and-loop.md).

### Speed: the stretch worklet

`setPlaybackRate(rate)` stops output, stores the rate, re-anchors at the current position, and
replays if it was playing. At 1× the buffer sources play as above. At any other rate one
`AudioWorkletNode` running the `chord-stretch` processor produces every stem's audio — one
stereo output per stem, connected to that stem's low shelf — so the rest of the graph, meters
included, is unchanged.

The processor is WSOLA (waveform-similarity overlap-add):

- Output advances in 30 ms hops. Each hop overlap-adds the tail of the previous 60 ms
  Hann-windowed frame with the head of a new one. The new frame's nominal input position
  advances by `hop × rate`, and a ±15 ms search around it (every fourth offset, then refined
  sample by sample) picks the position whose head best continues the previous frame. Speed comes
  from how far the input advances per hop; pitch is untouched because every frame plays at its
  original rate.
- Similarity is judged once per hop, on a mix of the stems weighted by their current gain —
  muted and unsoloed stems weigh nothing — and **every stem is cut at the same input
  positions**, so the stems stay sample-aligned with each other at any speed, as the buffer
  sources do at 1×. `applyGains` posts new weights whenever a gain, mute or solo changes.
- The processor holds no song. It posts `need` messages for one-second blocks around where it
  will read, looking 3 s ahead and asking again after a second without an answer; the engine
  slices those seconds out of each decoded buffer and transfers them. It keeps about a dozen
  blocks and plays silence over any block that hasn't arrived.
- The start message carries `when`, 80 ms after `currentTime`, so it reaches the audio thread in
  time and output begins at a known sample. The blocks around the start position are sent
  ahead of it, so that first output isn't silence. The engine anchors at the same `when`.

`supportsTimeStretch` is false when `AudioWorkletNode` or `audioContext.audioWorklet` is
missing — browsers expose both only to secure origins, HTTPS or `localhost` — and once the
module has failed to load. The module is added on the first play at a rate other than 1×.
`ResultsScreen` withholds the speed handler while it is false, so the web transport renders the
speed chip disabled, titled *"Speed control needs HTTPS or localhost"*. The phone transport has no
speed chip at all.

The costs — a restart with an 80 ms gap for every rate change and every seek while stretched,
silence when the main thread can't answer in time, and artifacts on transients — are weighed in
[decisions.md](decisions.md#pitch-preserving-speed-in-an-audioworklet).

### Mute, solo and volume

All three funnel into one method, which recomputes every gain from scratch:

```ts
private applyGains(): void {
  for (const [name, chain] of this.chains) {
    this.setParam(chain.gain.gain, this.isAudible(name) ? (this.volumes.get(name) ?? 1) : 0);
  }
  this.stretchNode?.port.postMessage({ type: "weights", weights: this.stretchWeights() });
}

private isAudible(name: string): boolean {
  return this.soloed.size > 0 ? this.soloed.has(name) && !this.muted.has(name) : !this.muted.has(name);
}
```

Semantics that fall out of this:

- **Solo is additive** — a `Set`, so multiple stems can be soloed at once.
- **Any solo silences all non-soloed stems.**
- **Mute beats solo** — a stem that is both soloed and muted is silent. The Console and Analog
  views don't show it that way: they follow the solo-first order the template's harness drew, which
  shows a soloed stem as *Soloed* and lifted even when it is also muted. That one combination is where a strip and the
  audio disagree.
- **Changes are smoothed, not stepped.** `setParam` calls `setTargetAtTime` with a 15 ms time
  constant: long enough that toggling a gain doesn't click, short enough to follow a fader drag.
  Pan, tone and the master fader go through the same helper.

The engine takes linear gain; the fader law lives with the UI, in
[`design/player.ts`](../../web/src/design/player.ts) under the template's own names. `db()` maps a
stem fader's position linearly onto −36…0 dB, with position 0 silent, and `ResultsScreen` converts
with `dbToGain` from [`utils/levels.ts`](../../web/src/utils/levels.ts) before calling `setVolume`.
The master fader follows its own tick marks instead: `masterDb` passes the position through −36,
−18, −6 and 0 dB at each third of the travel, the bottom again silent, and `dbToGain` turns the
result into what `setMasterVolume` takes. See
[decisions.md](decisions.md#the-fader-law-is-db-linear-over-36-db).

Volume state is duplicated: the engine keeps `volumes`/`muted`/`soloed` as its own truth, and
`ResultsScreen` keeps the template's `StemState`s — control positions, not gains — for rendering.
Every handler writes both. The engine's `getStemState()` exists for reading back but is not called
anywhere; React state is what renders.

### Metering

`readMeters(target, now)` reads every analyser into scratch arrays allocated once, and fills a
`MeterReadings` object the caller owns:

| Reading | From | Computed as |
| --- | --- | --- |
| `stems[name]` | the stem's analysers, 1024 samples | sample peak per channel |
| `master` | the master analysers, 4096 samples | sample peak per channel |
| `truePeak` | the newest 2048 of those samples | peak including the 4× oversampled positions, from 12-tap Hann-windowed sinc kernels |
| `correlation` | all 4096 master samples | ΣLR / √(ΣL²·ΣR²); `null` when the output is too quiet to judge |
| `loudness` | the loudness analysers, newest 400 ms — the whole 32768-sample buffer above 81.9 kHz, where 400 ms no longer fits | BS.1770 momentary loudness in LUFS, recomputed at most every 100 ms |

Each read is a snapshot of an analyser's newest samples, not a stream. At 60 fps the stem
window (about 21 ms at 48 kHz) covers every sample between two frames; below roughly 45 fps it no
longer does, and a short peak that falls between reads is never seen. Only `ConsoleView` and
`AnalogView` call `readMeters`, once per animation frame, so the Mixer view costs nothing here.

Ballistics belong to the views, not the engine: `LevelFollower` (instant attack, linear release
in dB per second, optional hold) and `Smoother` (exponential), both in `meters.ts`. See
[../features/metering.md](../features/metering.md) and
[decisions.md](decisions.md#metering-from-analysernodes-on-the-main-thread).

### Metronome

Enabled only when the job has a tempo: `ResultsScreen` passes `onToggleMetronome` only for a truthy
`job.tempo_bpm`, and otherwise the chip renders disabled, titled *"No tempo was detected for this
track"*. The server stores null rather than 0 when librosa finds no beat, and the scheduler skips a
zero tempo as well.

Clicks come from a **lookahead scheduler**. While playing with the metronome on, a 25 ms
`setInterval` schedules every click that falls in the next 120 ms of context time, and remembers
how far it got:

```ts
const beat = 60 / this.tempoBpm;
const from = Math.max(this.clicksScheduledUntil, now);
const to = now + METRONOME_LOOKAHEAD_SECONDS;
for (const piece of this.trackPieces(from, to)) {
  for (let k = Math.ceil(piece.trackStart / beat); k * beat < piece.trackEnd; k++) {
    this.scheduleClick(piece.contextStart + (k * beat - piece.trackStart) / this.rate);
  }
}
this.clicksScheduledUntil = to;
```

`trackPieces` splits the window into the stretches of track time it will play — cut where a loop
wraps, stopped at the end of the track — using the same anchor and rate as `getCurrentTime`. A
beat is a track position, converted to context time through the current transport, which is what
lets the click follow loops and speed. Play, seek, rate changes and loop changes all restart the
scheduler from the new anchor, and pause stops every oscillator already scheduled.

Each click is a 1000 Hz `OscillatorNode` with a 50 ms exponential decay envelope. Only the clicks
inside the current window exist at any moment, and each one removes itself when it ends.

The window starts at `now` whenever the timer fires late, so a main-thread stall longer than the
120 ms lookahead **drops** the clicks it spanned rather than playing them late.

Beat one is aligned to *time zero of the track*, not to a detected downbeat — librosa's
`beat_track` gives a tempo, and CHORD doesn't use the beat positions. So the click is
rhythmically correct but not necessarily phase-aligned to the music, and a loop whose start isn't
on a multiple of the beat hears clicks offset from its own start. See
[../features/tempo-and-metronome.md](../features/tempo-and-metronome.md).

### Lifecycle and disposal

`load(stems)` fetches and decodes all stems in parallel via `Promise.all`. Each response is read
whole with `arrayBuffer()` and handed to `decodeAudioData`; a non-2xx response fails that stem with
its status and the server's `detail`, as in `404 Stem not ready`. There is no progress callback —
the loading screen shows the template's fixed 100% state instead. `load` **never rejects**: it
resolves with a `{name, url, message}` for each stem that failed, having added every stem that
succeeded — its filter chain and analyser tap included — to the graph. Calling it again with the
failures is the retry, which is what *Retry download* on the *Stems failed to load* panel does.

Each task checks `this.disposed` after every `await` and bails out, because in React `StrictMode`
the mount effect runs twice in development — the first engine is disposed while its fetches are
still in flight, and without the guard those would populate a dead engine.

`dispose()` sets `disposed`, stops output and clicks, closes the stretch processor's port, and
closes the `AudioContext`. Browsers limit how many contexts a page may have open, so failing to
close one leaks a real resource. `ResultsScreen`'s effect cleanup calls it on unmount and whenever
`job.id` changes or the template stems in `job.stem_names` do — compared as a joined string, because
every job update carries a new `stem_names` array even when it lists the same stems.

## Waveforms

There is no waveform library. Once a stem is decoded,
[`waveformPolygon`](../../web/src/utils/peaks.ts) walks the buffer in 160 bins, takes the peak of
every 8th sample across all channels in each bin, lifts it with a square root so quiet passages
still read as a shape, floors it at 2% so silence stays visible, and returns a CSS `polygon()` —
the top edge left to right, then the bottom edge back.
[`StemWaveform`](../../web/src/components/controls/StemWaveform.tsx) sets that as the
`clip-path` of a `.ch-wave` element, whose background is a repeating bar pattern in the stem's
`--stem` hue, so the bars show only inside the stem's real envelope.

Consequences:

- **One fetch per stem.** The envelope comes from the buffer the engine already decoded; nothing
  downloads or decodes a second time to draw.
- **The shape is computed when a load finishes**, in `ResultsScreen`'s `applyLoad` on the main
  thread, for every stem that loaded — again after a retry — and doesn't change with the mix. A
  stem that isn't heard is dimmed (`.is-off`), not redrawn.
- **160 bins, whatever the length**, so detail per bin shrinks as tracks get longer: a
  twelve-minute track is 4.5 s per bin. The bars inside are decoration, not samples.
- **A playhead on every row, but no seeking.** Each waveform carries a `.ch-playhead` at `--p`, in a
  wrapper so the envelope's `clip-path` doesn't cut it away. The chord strip and the transport's
  seek slider are the two places to seek; a waveform is `aria-hidden`.
- **Phones draw them too.** Below 720px the stylesheet stacks each Mixer row and gives the
  waveform a full-width line of its own, last.

## Silence detection

[`utils/hasVocals.ts`](../../web/src/utils/hasVocals.ts) computes RMS over every 8th sample of the
decoded vocals buffer's first channel and compares it against `0.01`. Instrumental tracks
separate into a vocals stem that is near-silent rather than absent. When it is, `ResultsScreen`
mutes the vocals stem on load and marks it — a hint under the lyric row, shown in all three views, and *Silent* as the
Console strip's state label while the stem stays muted and unsoloed. Nothing else changes: the
lyric row still renders, so an instrumental shows whatever the lyrics lookup found.

The stride of 8 is a ~8× speedup on a full-length buffer with no meaningful accuracy cost for a
binary loud-or-silent decision.

If the vocals stem itself failed to load and the user chose *Open anyway*, there is no buffer to
test. A stem that didn't arrive says nothing about the song, so `hasVocals` stays true.
