# Tempo and metronome

## Detection

[`tempo.py`](../../server/app/pipeline/tempo.py) takes samples, not a file:

```python
def detect_tempo(samples: np.ndarray, sample_rate: int) -> float:
    onset_envelope = _onset_envelope(samples, sample_rate)
    if not onset_envelope.any():
        return 0.0
    tempo = librosa.feature.tempo(
        tg=_mean_tempogram(onset_envelope, sample_rate),
        sr=sample_rate, hop_length=_HOP_LENGTH, start_bpm=_START_BPM, aggregate=None,
    )
    return round(float(np.atleast_1d(tempo)[0]), 1)
```

The result is **the tempo `librosa.beat.beat_track` reports**, and it is reached the way
`beat_track` reaches it — an onset envelope, a tempogram of autocorrelations over it, the tempo
whose lag scores best under a prior centred on 120 BPM — but `beat_track` itself is never called:

- librosa builds the whole track's spectrogram, and then one eight-second autocorrelation window
  for every frame of the envelope, all at once. For a 6:20 track that peaked at 1,122 MiB above
  what the process already held, and it grows with the track's length — about 2 GiB at twelve
  minutes — while separation runs beside it and needs the memory. In a 4 GiB Docker VM it pushed the
  whole job into swap.
- `_onset_envelope` is `librosa.onset.onset_strength(aggregate=np.median)`, what `beat_track`
  measures tempo from, with the mel spectrogram under it built 2048 frames at a time
  (`_SPECTROGRAM_BLOCK_FRAMES`). `_window` cuts each block's samples, scales integer PCM to float
  by its dtype's maximum, and pads the ends with the zeros a centred STFT would. Each frame is the
  one librosa computes, so the envelope is the same to the bit.
- `_mean_tempogram` is the mean over time of `librosa.feature.tempogram`, summed 512 frames at a
  time (`_TEMPOGRAM_BLOCK_FRAMES`); only the last bits of the mean can differ from librosa's.
  `librosa.feature.tempo` then picks the BPM from it, as it does inside `beat_track`.
- For that 6:20 track: 154 MiB at the peak and 1.2 s, where `beat_track` took 3.3 s. The BPM is the
  same, as it was on every case tried: whole tracks and excerpts, a third of a second, one sample,
  silence, noise, a click train.

The rest is as it was:

- `samples` is the job's one decode of the original — mono, 44.1 kHz, from
  [`decode.decode_mono`](../../server/app/pipeline/decode.py) — which chord and key detection read
  too. madmom's decoder gives integer PCM.
- **It runs at that 44.1 kHz**, not librosa's usual 22 050 Hz. At half the rate the onset
  envelope has half the frames and the estimate coarsens enough to make the metronome drift: a
  120 BPM click read 117.5.
- Mono — tempo is a global property; no reason to analyze channels separately.
- **No beat positions exist.** `beat_track` goes on from the tempo to place the beats, and CHORD
  never read them; now the tracker that would place them doesn't run. This is the direct cause of
  the phase-alignment limitation below.
- `np.atleast_1d(tempo)[0]` normalizes across librosa versions — newer releases return a
  1-element array where older ones returned a scalar.
- Rounded to one decimal (e.g. `123.0`, `89.1`).
- A track with no onsets at all — silence — comes back as `0.0`, as it does from `beat_track`.
  `run_job` stores that as null (`tempo_future.result() or None`), so the API reports no tempo
  rather than 0 BPM.

The constants at the top of the file — the STFT's 2048 and 512, the eight seconds, the 120 BPM —
are librosa's own defaults, spelled out because the estimate is assembled here. Changing one changes
the answer away from librosa's.

It runs on the **original mix**, not on the drums stem, on the job's analysis thread, which starts
with separation. The status stays `separating` either way. If tempo detection is still running once
the stems are written, `run_job` sets `progress` 0.85 and *Detecting tempo* while it waits; if it
finished during separation, that stage is never current and the processing screen shows it done.
There is no `TEMPO` status; the processing screen lists *Detecting tempo* as its own stage because
[`processingStage`](../../web/src/design/stages.ts) tells it apart from separation by that stage
message. A failure to decode the original surfaces here too, reported as a tempo failure. The result
lands in the row as `tempo_bpm` in the same final `UPDATE` that sets `status=done`.

librosa imports its submodules the first time each is used, and numba compiles their vectorized
helpers then, so `tempo.warm_up()` estimates the tempo of two seconds of seeded noise — 16-bit, at
44.1 kHz, like a real decode — from the worker's warm-up before the first job. Noise rather than
silence, because silence has no onsets and stops short of the tempogram. numba keeps what it
compiles in `~/.cache/numba`, and [`server/Dockerfile`](../../server/Dockerfile) runs the same
`warm_up()` as its last build step, so that cache is in the image: without it every new container
compiled again, which with the beat tracker's own compile was most of a 29–40 s warm-up. It is now
about 6 s. numba keys the cache on the CPU it compiled for, so an image started on a different
processor compiles once more there.

The analysis bar shows it as *Tempo* — an integer, or one decimal when there is one, through
`formatBpm` in [`utils/tempo.ts`](../../web/src/utils/tempo.ts) — and `—` for a null or zero tempo,
at every width.

Common failure mode: the classic doubling/halving error, where a track is reported at 2× or
½× its felt tempo. Nothing corrects for it, and there is no manual override.

## The metronome

Client-side, in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts). No audio file is
involved — every click is synthesized.

### Gating

`ResultsScreen` passes the toggle to the transport only when the job has a tempo:

```tsx
onToggleMetronome={job.tempo_bpm ? handleToggleMetronome : undefined}
```

The check is truthiness rather than `!= null`, so a zero tempo disables the chip just as null does,
and the engine's scheduler, which returns early without a tempo, agrees. Without the toggle,
[`Transport`](../../web/src/screens/results/Transport.tsx) still renders the chip —
*Metronome off* on desktop, *Click* below 720 px — but **disabled**, at 45% opacity, titled *No
tempo was detected for this track*. The Console master strip reports the state as *Metronome On*
or *Off*. The engine is told the tempo once, when it is created, with `setTempoBpm`.

### Scheduling

A **lookahead scheduler**. `startMetronome()` stops any previous schedule, resets the
scheduled-until mark to the transport anchor, schedules at once, and then again every 25 ms on a
`window.setInterval`. Each tick
covers the stretch of audio-context time from where the last one stopped to 120 ms from now:

```ts
const beat = 60 / this.tempoBpm;
const from = Math.max(this.clicksScheduledUntil, now);
const to = now + METRONOME_LOOKAHEAD_SECONDS;           // 0.12
for (const piece of this.trackPieces(from, to)) {
  for (let k = Math.ceil(piece.trackStart / beat); k * beat < piece.trackEnd; k++) {
    this.scheduleClick(piece.contextStart + (k * beat - piece.trackStart) / this.rate);
  }
}
this.clicksScheduledUntil = to;
```

`trackPieces(from, to)` turns the window of context time into the stretches of track time it will
play. Track time advances at `rate` from the transport anchor; a piece starts at the (loop-wrapped)
track position and runs until the window ends or the boundary arrives — the loop end, or the end of
the track without a loop — and after a loop wrap the next piece starts again at the loop start. A
window is split into at most 64 pieces, and past the end of an unlooped track there are none.

What that buys:

- **Clicks follow speed.** A beat lasts `beat / rate` seconds of context time, so the click stays
  with [stretched](speed-and-loop.md) audio.
- **Clicks follow loops.** Each lap is its own piece, so the schedule never has to be rebuilt at a
  wrap.
- **Timing is sample-accurate.** Each click starts at an exact context time; the timer only decides
  how far ahead to schedule, so ordinary timer jitter doesn't move a click.
- **Nothing is scheduled twice**, because each window starts where the previous one ended.

The cost is the reverse of that last point: a window never reaches back. If the main thread stalls
long enough that ticks are more than 120 ms apart, the clicks that fell in the gap are **skipped**,
not played late.

`Math.ceil` picks the first beat at or after the start of each piece, so seeking into the middle of
a song doesn't replay earlier clicks.

Each click is a fresh oscillator with a percussive envelope:

```ts
const oscillator = this.audioContext.createOscillator();
oscillator.frequency.value = CLICK_FREQUENCY_HZ;                   // 1000
const envelope = this.audioContext.createGain();
envelope.gain.setValueAtTime(1, when);
envelope.gain.exponentialRampToValueAtTime(0.001, when + CLICK_SECONDS);   // 0.05
oscillator.connect(envelope).connect(this.metronomeGain);
oscillator.onended = () => { this.clicks.delete(oscillator); envelope.disconnect(); };
oscillator.start(when);
oscillator.stop(when + CLICK_SECONDS);
```

At most a few oscillators exist at once, since only 120 ms is ever scheduled ahead. Each is kept in
the `clicks` set until it ends, so `stopMetronome()` can clear the interval and stop every click
still waiting to sound.

### When the schedule restarts

| Action | What happens |
| --- | --- |
| `play()` | starts output, then `startMetronome()` if enabled and a tempo is set |
| `pause()` | `stopOutput()`, which calls `stopMetronome()` |
| `seek()`, `setPlaybackRate()` | stop output and the metronome, then `play()` again if it was playing |
| `setLoop()` | through `seek(start)` |
| `clearLoop()` at 1× while playing | re-anchors the transport and calls `startMetronome()`; the audio doesn't restart |
| `clearLoop()` while stretching | through `seek(position)` |
| `setMetronomeEnabled(true)` | `startMetronome()` if playing; otherwise it starts with the next `play()` |
| `setMetronomeEnabled(false)` | `stopMetronome()` |
| `dispose()` | `stopOutput()`, which calls `stopMetronome()` |

At speeds other than 1×, `play()` anchors the transport to a start 80 ms in the future, and the first
window begins there, so the first click lines up with the delayed audio.

### Routing

`metronomeGain` connects **directly to `destination`**, bypassing `masterGain`:

```
stems ──► tone ──► per-stem gain ──► pan ──► masterGain ──┐
                                                           ├──► destination
metronome clicks ──► metronomeGain ───────────────────────┘
```

So the master level does not attenuate the click, and no [meter](metering.md) sees it. Deliberate —
the click is a practice aid, not part of the mix. Its own gain is fixed at `1` and not exposed in
the UI, so the only control is on/off.

## Phase alignment

Beat one is anchored to **time zero of the track**, not to a detected downbeat: clicks fall on
`k × beat` of track time. The server estimates a tempo and never places a beat, so the
engine only knows *how fast* the beats are, not *where* they fall.

Practically: the click is at the right tempo, but its phase relative to the music is arbitrary —
determined by whether the recording happens to start exactly on a beat. Songs with an intro,
a pickup bar, or any leading silence will have a click offset from the actual groove.

The same grid holds inside a loop. Clicks stay on the track's beat positions rather than restarting
at the loop start, so a loop that isn't a whole number of beats long has an irregular interval at
its seam — as the music does.

Fixing this means placing the beats — `librosa.beat.beat_track(onset_envelope=…, bpm=…)` on the
envelope and tempo `detect_tempo` already has, which is the tracker without the memory its own
tempo estimate needs — returning the first beat's time, storing it (a new
`beat_offset_seconds` column), and counting beats from it in `scheduleClicksAhead`
(`offset + k × beat`). The beat tracker is the part numba takes longest to compile, so it would
belong in `tempo.warm_up()` too.

## Known gaps

- Doubling and halving errors, with no manual tempo override.
- Phase is arbitrary (above).
- Every click is identical: no accent on the downbeat, and no bar or time-signature awareness.
- A main-thread stall longer than the 120 ms lookahead drops clicks.
