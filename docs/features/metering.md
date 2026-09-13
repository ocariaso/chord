# Metering

Level, true-peak, loudness and correlation meters for the [Console and Analog views](results-views.md).
Everything is measured in the browser, from `AnalyserNode` taps on the playback graph in
[`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts), with the maths in
[`meters.ts`](../../web/src/audio/meters.ts). No meter data comes from the server.

## Where the taps are

```
per stem:
source ─► lowshelf ─► highshelf ─► gain ─► panner ─┬──────────────────────────► masterGain
                                                   └─► splitter ─► 2 × analyser (1024)       stem meters

master:
masterGain ─┬─► destination
            ├─► splitter ─► 2 × analyser (4096)                        peak, true peak, correlation
            └─► K shelf ─► K high-pass ─► splitter ─► 2 × analyser (32768)   momentary loudness

metronome clicks ─► metronomeGain ─► destination                        no tap
```

Where each tap sits decides what it can see:

- **Stem meters are post-tone, post-fader, post-mute/solo and post-pan.** A muted or held stem reads
  silence — a soloed stem that is also muted included, though its strip reads *Soloed* — and a stem
  panned hard left empties its right bar.
- **Master meters are post master fader**, so they measure CHORD's output level rather than the mix
  before it.
- **The metronome is invisible to every meter.** Its gain connects straight to the destination,
  bypassing `masterGain` and both master taps.

The analysers are dead ends — nothing is connected after them — so they add no audible path.

## What each meter measures

`readMeters(target, now)` fills a `MeterReadings` object the caller keeps in a ref, reading into
preallocated `Float32Array` scratch buffers, so a frame allocates nothing.

| Reading | Tap | Window | Computation | Shown as |
| --- | --- | --- | --- | --- |
| `stems[name]` | stem analysers | newest 1024 samples | sample peak per channel | Console strip bars |
| `master` | master analysers | 4096 samples | sample peak per channel | Console master bars; Analog Output left/right |
| `truePeak` | master analysers | newest 2048 of those 4096 | 4× oversampled peak, louder channel | Console *Peak* readout; Analog True peak |
| `loudness` | K-weighted analysers | newest 400 ms of 32768 samples — all of them above 81.9 kHz | BS.1770 momentary loudness, recomputed at most every 100 ms | Analog Loudness |
| `correlation` | master analysers | 4096 samples | Pearson correlation of left against right | Analog Correlation |

All values are linear amplitudes except loudness (LUFS) and correlation (−1…1).

### Peak

`peakOf` is the largest absolute sample in the window. Windows are sized against the frame rate: at
48 kHz, 1024 samples is about 21 ms and one frame at 60 Hz about 17 ms, so consecutive reads overlap
and no sample goes unread. A main thread that drops below roughly 47 frames a second starts leaving
gaps between stem reads, and a transient that falls in a gap is never shown.

### True peak

`truePeakOf` checks every sample in the span plus the three points between it and the next,
interpolated with 12-tap Hann-windowed sinc kernels (one per quarter-sample position, normalized to
unity gain at DC). The code's stated aim is a display that tracks inter-sample peaks to a fraction
of a dB. It is not the reference filter from ITU-R BS.1770, so it is not a compliance measurement.
Only the newest 2048 samples are oversampled because the whole 4096-sample window would double the
cost, and 2048 samples still covers a frame at 60 Hz with room to spare.

### Momentary loudness

The master signal passes through K-weighting before its analysers: a high shelf, then the RLB
high-pass, as two `IIRFilterNode`s. BS.1770 tabulates the coefficients only at 48 kHz, so
`kWeightingFilters(sampleRate)` derives them for the context's rate with libebur128's
bilinear-transform formulas.

`readMeters` takes the mean square of each channel over the newest `round(0.4 × sampleRate)`
samples and computes `−0.691 + 10 · log10(zL + zR)`, which is `−∞` when both are zero. Both channels
are weighted 1, and there is no gating, which momentary loudness doesn't use. There is also no
short-term or integrated figure. Because a 32768-sample read is the heaviest in the set, loudness is
recomputed at most every 100 ms and the last value is reused in between.

32768 is the largest `fftSize` an `AnalyserNode` allows, and above 81 920 Hz 400 ms is more samples
than that. The window start is clamped at 0, so such a context measures the whole buffer instead — a
window of about 370 ms at 88.2 kHz and 340 ms at 96 kHz. `new AudioContext()` is created without a
`sampleRate` and runs at the output device's rate, so a high-rate interface is all it takes.

### Correlation

`correlationOf` returns `Σ(L·R) / √(ΣL² · ΣR²)` over the 4096-sample window: +1 for mono, 0 for
unrelated channels, −1 for out-of-phase. When `ΣL² + ΣR²` is under `1e-6` the output is effectively
silent and the result is `null` ("can't judge"); when only one side is silent it is 0.

## Ballistics

Raw readings jump around too much to read, so each display runs them through one of two followers.

- **`LevelFollower(releaseDbPerSecond, holdMs)`** works in dB. A reading at or above the current
  level replaces it at once (instant attack) and restarts the hold. Otherwise, once the hold has
  run out, the level falls at the release rate — linearly in dB — but never below the new reading.
  Anything under −90 dB snaps to `−∞`.
- **`Smoother(timeConstantMs)`** approaches each new value exponentially, blending by
  `1 − e^(−Δt/τ)`. A `null` reading leaves the value where it is. A `−∞` reading sets `−∞`, and the
  next finite reading is taken as-is rather than blended up from minus infinity.

| Display | Follower | Release | Hold |
| --- | --- | --- | --- |
| Console stem and master bars | `LevelFollower` | 24 dB/s | none |
| Console *Peak* readout | `LevelFollower` on true peak | 24 dB/s | 1.5 s |
| Analog Output left / right | `LevelFollower` | 20 dB/s | none |
| Analog True peak | `LevelFollower` | 20 dB/s | 1.5 s |
| Analog Loudness | `Smoother` | τ = 300 ms | — |
| Analog Correlation | `Smoother` | τ = 300 ms | — |

The bars have **no peak-hold segment**, even though the stylesheet's meter section is commented
*post-fader, peak hold*; holds exist only on the *Peak* readout and the True peak dial. Numeric
readouts are rewritten at most every 125 ms, because digits redrawn sixty times a second can't be
read; bars and needles move every frame.

Correlation means nothing in silence. Whenever the output is effectively silent — paused included —
the reading is `null`, and `AnalogView` shows `—` in the readout and feeds the smoother 0 instead,
so the needle eases back to centre over the same 300 ms time constant. Loudness, by contrast, reads
`−∞` in silence.

## Scales

The Console scales, `STEM_METER_SCALE` and `MASTER_METER_SCALE`, are in
[`design/player.ts`](../../web/src/design/player.ts), and the dial scales in
[`OutputDial.tsx`](../../web/src/screens/results/OutputDial.tsx). Both map dB onto geometry through
`mapThroughAnchors` in [`levels.ts`](../../web/src/utils/levels.ts), a piecewise-linear map clamped
at both ends that also sends `−∞` and `NaN` to the lowest anchor.

| Meter | Anchors | Notes |
| --- | --- | --- |
| Console stem bars | −36 dB → 0, −24 → ⅓, −12 → ⅔, 0 → 1 | linear in dB over the fader's own −36…0 range, so a fader cap lines up with the tick for the same dB; the tick labeled `−∞` really stands for −36 dB and below |
| Console master bars | −36 → 0, −18 → ⅓, −6 → ⅔, 0 → 1 | more of the height near full scale, where a mix sits. `MASTER_METER_SCALE` is derived from the anchors of the master fader's own law, `masterDb()`, so here too the fader cap lines up with the tick for the same dB |
| Output left / right | −40 / −12 / 0 dBFS | accent arc over the last few dB before full scale |
| True peak | −24 / −9 / 0 dBTP | same accent arc |
| Loudness | −36 / −23 / −9 LUFS | accent arc marks louder than the −14 LUFS streaming target |
| Correlation | −1 / 0 / +1 | accent arc marks the mono-safe side above +0.5 |

On the dials, the three anchors land at −70°, −10° and +70° from vertical — the middle label sits
10° left of centre, so the needle moves faster above it than below.

## Why the meters bypass React

[`ConsoleView`](../../web/src/screens/results/ConsoleView.tsx) and
[`AnalogView`](../../web/src/screens/results/AnalogView.tsx) each run
[`useAnimationFrame`](../../web/src/hooks/useAnimationFrame.ts), which calls the latest callback
every frame without re-subscribing. Each frame reads the meters, then writes the DOM directly:

| View | Written each frame |
| --- | --- |
| Console | `style.setProperty("--l", …)` on every `<i data-meter data-channel>` in the stem strips and the master strip, found once by `querySelectorAll` and re-queried when the strip count changes; `textContent` of the master strip's *Peak* span |
| Analog | `setAttribute("transform", "rotate(<deg> 100 108)")` on each needle; `textContent` of each readout |

The JSX renders the same initial values every time — `--l: 0`, the needle's rest angle, `−∞` (or
`—` for Correlation) — so React's diff never sees a change and never overwrites what the loop wrote.

The reasons are the design source's: a custom-property write per frame is cheap and a React render
per frame is not, and the meters have to keep falling after playback pauses, when nothing else
re-renders. The saving is narrower than that suggests, though. While playing, `ResultsScreen`
already re-renders the active view every frame for the playback time (see
[rendering cost](results-views.md#rendering-cost)); the bypass keeps meter values out of those
renders and keeps the meters alive while paused, but it does not make playback render-free.

The Mixer view runs no meter loop and never calls `readMeters`. The analysers stay in the graph in
every view regardless. Switching views unmounts the outgoing view, so followers and holds start
fresh when you return.

## Known gaps

- Above 81.9 kHz the momentary loudness window is shorter than 400 ms — the whole 32768-sample
  buffer, about 340 ms at 96 kHz — so the reading there isn't strictly momentary loudness.
- Measurement stops at CHORD's output: system volume, the metronome click and anything else playing
  on the machine are not included.
- True peak is an approximation for display, and there is no short-term or integrated loudness, no
  loudness range and no gating.
- Accuracy depends on the frame rate: a busy main thread leaves unread gaps between windows.
