# Tempo and metronome

## Detection

[`tempo.py`](../../server/app/pipeline/tempo.py) is eleven lines:

```python
def detect_tempo(audio_path: Path) -> float:
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return round(float(np.atleast_1d(tempo)[0]), 1)
```

- `sr=None` preserves the file's native sample rate instead of librosa's 22050 default.
- `mono=True` — tempo is a global property; no reason to analyze channels separately.
- The second return value of `beat_track` is the **beat frame positions, and they are
  discarded**. Only the scalar BPM is kept. This is the direct cause of the phase-alignment
  limitation below.
- `np.atleast_1d(tempo)[0]` normalizes across librosa versions — newer releases return a
  1-element array where older ones returned a scalar.
- Rounded to one decimal (e.g. `123.0`, `89.1`).
- A track with no beat to find — silence, or material without a pulse — comes back as `0.0`.
  `run_job` stores that as null (`tempo.detect_tempo(original_path) or None`), so the API reports
  no tempo rather than 0 BPM.

It runs on the **original mix**, not on the drums stem, and happens *after* separation while
the status is still `separating` — only `progress` (0.5) and `stage_message`
(*Detecting tempo*) change. There is no `TEMPO` status; the processing screen still lists
*Detecting tempo* as its own stage because
[`processingStage`](../../web/src/design/stages.ts) tells it apart from separation by that stage
message. The result lands in the row as `tempo_bpm` in the same final `UPDATE` that sets
`status=done`.

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
`k × beat` of track time. Since `beat_track`'s frame positions are thrown away server-side, the
engine only knows *how fast* the beats are, not *where* they fall.

Practically: the click is at the right tempo, but its phase relative to the music is arbitrary —
determined by whether the recording happens to start exactly on a beat. Songs with an intro,
a pickup bar, or any leading silence will have a click offset from the actual groove.

The same grid holds inside a loop. Clicks stay on the track's beat positions rather than restarting
at the loop start, so a loop that isn't a whole number of beats long has an irregular interval at
its seam — as the music does.

Fixing this means returning the first beat's time from `detect_tempo`, storing it (a new
`beat_offset_seconds` column), and counting beats from it in `scheduleClicksAhead`
(`offset + k × beat`).

## Known gaps

- Doubling and halving errors, with no manual tempo override.
- Phase is arbitrary (above).
- Every click is identical: no accent on the downbeat, and no bar or time-signature awareness.
- A main-thread stall longer than the 120 ms lookahead drops clicks.
