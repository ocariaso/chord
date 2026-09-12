# Audio playback

The mixer's defining constraint: six separate WAV files must play as one piece of music, with
sample-accurate alignment, while the user mutes, solos and re-levels them live.

## Why not `<audio>` elements

Six `<audio>` elements cannot be kept in sync. Each has its own clock, its own buffering
behavior and its own `play()` latency; drift is audible within seconds, and seeking six
elements to the same position is inherently racy.

The Web Audio API solves this: `AudioContext` has **one** clock, and
`AudioBufferSourceNode.start(when, offset)` schedules against it. Six sources started at the
same `when` with the same `offset` are sample-locked by construction — there is nothing left to
drift.

The cost is that every stem must be fully downloaded and decoded into an `AudioBuffer` before
playback can start. That's the "Loading stems…" screen.

## `PlaybackEngine`

[`web/src/audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) — a plain class, no
React. It owns the `AudioContext` and is the single source of truth for audio state.

### Graph

```
          AudioBufferSourceNode (per stem, recreated on every play)
                     │
                  GainNode  ──── per-stem gain: volume, mute, solo
                     │
                 masterGain  ──── master volume
                     │
              destination ◄──── metronomeGain ◄── OscillatorNode + envelope GainNode
                                  (one pair per scheduled click)
```

The metronome bypasses `masterGain` and connects straight to `destination`, so the master
volume fader does not attenuate the click. Whether that's desirable is a design choice, but
it's deliberate: the click is a practice aid, not part of the mix.

### Transport

State is three fields:

```ts
private offsetSeconds = 0;          // track position at the moment playback last started
private startedAtContextTime = 0;   // audioContext.currentTime at that moment
private playing = false;
```

and the clock is derived, never stored:

```ts
getCurrentTime() {
  if (!this.playing) return this.offsetSeconds;
  return this.offsetSeconds + (this.audioContext.currentTime - this.startedAtContextTime);
}
```

- **`play()`** resumes the context if suspended (browsers start it suspended until a user
  gesture), then creates a *fresh* `AudioBufferSourceNode` per stem and starts each at the same
  `startTime` with the same `offsetSeconds`. Source nodes are single-use by spec — this is why
  they're recreated rather than reused.
- **`pause()`** captures `getCurrentTime()` into `offsetSeconds`, stops all sources, clears the
  metronome schedule.
- **`seek(s)`** stops everything, sets `offsetSeconds` clamped to `[0, duration]`, and replays
  if it was playing. There is no partial-seek path.

`duration` is the **max** of all buffer durations, not the first — stems can differ by a frame
or two.

### Mute, solo and volume

All three funnel into one method, which recomputes every gain from scratch:

```ts
private applyGains() {
  for (const [name, gainNode] of this.gainNodes) {
    const isAudible = this.soloed.size > 0
      ? this.soloed.has(name) && !this.muted.has(name)
      : !this.muted.has(name);
    gainNode.gain.value = isAudible ? (this.volumes.get(name) ?? 1) : 0;
  }
}
```

Semantics that fall out of this:

- **Solo is additive** — a `Set`, so multiple stems can be soloed at once.
- **Any solo silences all non-soloed stems.**
- **Mute beats solo** — a stem that is both soloed and muted is silent.
- Gains are set directly (`gain.value = …`), not ramped, so toggles are instantaneous. At
  these amplitudes the click is inaudible in practice.

Volume state is duplicated: the engine keeps `volumes`/`muted`/`soloed` as its own truth, and
`StemMixer` keeps `channelStates`/`soloedStems` for rendering. Every handler writes both. The
engine's `getStemState()` exists for reading back but is not currently called — React state is
what renders.

### Metronome

Enabled only when `job.tempo_bpm` is non-null (`StemMixer` passes `onToggleMetronome` as
`undefined` otherwise, and the button simply doesn't render).

`scheduleMetronomeClicks(startTime, offsetSeconds)` schedules **every remaining beat in the
track at once** — no look-ahead window, no scheduler loop:

```ts
const beatInterval = 60 / this.tempoBpm;
let beatIndex = Math.ceil(offsetSeconds / beatInterval);
let trackTime = beatIndex * beatInterval;
while (trackTime < this.duration) {
  this.scheduleClick(startTime + (trackTime - offsetSeconds));
  beatIndex++; trackTime = beatIndex * beatInterval;
}
```

Each click is a 1000 Hz `OscillatorNode` with a 50 ms exponential decay envelope. A four-minute
song at 120 BPM is ~480 oscillators created up front. That's acceptable for a one-shot
schedule, and every oscillator is tracked in `metronomeOscillators` so
`clearMetronomeSchedule()` can stop them on pause, seek or disable.

Beat one is aligned to *time zero of the track*, not to a detected downbeat — librosa's
`beat_track` gives a tempo, and CHORD doesn't use the beat positions. So the click is
rhythmically correct but not necessarily phase-aligned to the music.

### Lifecycle and disposal

`load()` fetches and decodes all stems in parallel via `Promise.all`. Each task checks
`this.disposed` after its `await` and bails out, because in React `StrictMode` the mount effect
runs twice in development — the first engine is disposed while its fetches are still in flight,
and without the guard those would populate a dead engine's buffer map.

`dispose()` sets `disposed`, stops all sources and clicks, and closes the `AudioContext`.
Browsers limit how many contexts a page may have open, so failing to close one leaks a real
resource. `StemMixer`'s effect cleanup calls it on unmount and on any `job.id` change.

## The split with WaveSurfer

WaveSurfer.js is used **only to draw**. It never plays audio.

Each waveform is created with:

```ts
WaveSurfer.create({
  container, height, waveColor, progressColor,
  cursorColor, cursorWidth,
  interact: false,              // clicks do not seek — useSeekDrag handles that
  url: downloadHref,            // a real media element, for a genuine duration
  peaks: [buffer.getChannelData(0)],   // reuse the already-decoded samples
  duration: buffer.duration,
})
```

Three of those options are load-bearing:

- **`interact: false`** — if WaveSurfer handled clicks it would try to seek its own media
  element, which is not what the user hears. Seeking is instead attached as pointer handlers
  from `useSeekDrag` on the container, which computes a fraction of element width and calls the
  engine.
- **`peaks`** — passing the already-decoded channel data means WaveSurfer does not re-decode
  the WAV to draw it. The decode already happened in `PlaybackEngine.load()`; doing it twice
  would double both time and peak memory.
- **`url`** *and* **`duration`** — supplying `peaks` alone leaves WaveSurfer without a real
  duration to position its cursor against, so a media element is still loaded from the same URL.
  This is why the browser fetches each stem twice (once as an `ArrayBuffer` for the engine, once
  as a media element for WaveSurfer). Both hit the same URL, so the second is usually served
  from cache.

Instances register themselves with `StemMixer` through `onWaveSurferReady(name, instance)`,
which stores them in `waveSurfersRef`. The animation-frame loop then pushes `setTime(time)` into
each one. Every instance is destroyed in its creating effect's cleanup.

Two components create waveforms, with the same options and different colors:
[`StemChannel`](../../web/src/components/StemChannel.tsx) inline for the Simple view, and
[`useStemWaveform`](../../web/src/components/studio/useStemWaveform.ts) for the Studio amps.
`StemChannel` additionally re-applies `progressColor` in a separate effect, because the accent
color arrives asynchronously (after the thumbnail loads and is sampled) and would otherwise be
frozen at whatever it was when the instance was created.

Both waveform effects intentionally depend on `[buffer]` alone, with the exhaustive-deps lint
rule disabled — re-creating a WaveSurfer instance on a color or callback change would flicker
the waveform for no reason.

## Silence detection

[`utils/hasVocals.ts`](../../web/src/utils/hasVocals.ts) computes RMS over every 8th sample of
the decoded vocals buffer and compares against `0.01`. Instrumental tracks separate into a
vocals stem that is near-silent rather than absent, and `hasVocals` gates the lyrics UI so an
instrumental doesn't display a "No lyrics found" line or a stale lyric.

The stride of 8 is a ~8× speedup on a full-length buffer with no meaningful accuracy cost for a
binary loud-or-silent decision.
