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

It runs on the **original mix**, not on the drums stem, and happens *after* separation while
the status is still `separating` — only `progress` (0.5) and `stage_message`
("Detecting tempo") change. There is no `TEMPO` status. The result lands in the row as
`tempo_bpm` in the same final `UPDATE` that sets `status=done`.

Common failure mode: the classic doubling/halving error, where a track is reported at 2× or
½× its felt tempo. Nothing corrects for it, and there is no manual override.

## The metronome

Client-side, in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts). No audio file is
involved — every click is synthesized.

### Gating

`StemMixer` passes `onToggleMetronome` only when the job has a tempo:

```tsx
onToggleMetronome={job.tempo_bpm != null ? toggleMetronome : undefined}
```

Both `ChordTimeline` and `MasterUnit` render the button as
`const metronomeButton = onToggleMetronome && (...)`, so a job without a detected tempo simply
has no metronome control anywhere in the UI.

### Scheduling

`scheduleMetronomeClicks(startTime, offsetSeconds)` schedules **every remaining beat in the
track in one pass** — there is no look-ahead window and no scheduler timer:

```ts
const beatInterval = 60 / this.tempoBpm;
let beatIndex = Math.ceil(offsetSeconds / beatInterval);
let trackTime = beatIndex * beatInterval;
while (trackTime < this.duration) {
  this.scheduleClick(startTime + (trackTime - offsetSeconds));
  beatIndex++;
  trackTime = beatIndex * beatInterval;
}
```

`Math.ceil` picks the first beat at or after the current position, so seeking into the middle of
a song doesn't replay earlier clicks.

Each click is a fresh oscillator with a percussive envelope:

```ts
const oscillator = this.audioContext.createOscillator();
oscillator.frequency.value = 1000;                        // 1 kHz
const envelope = this.audioContext.createGain();
envelope.gain.setValueAtTime(1, when);
envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.05);   // 50 ms decay
oscillator.start(when);
oscillator.stop(when + 0.05);
```

A four-minute song at 120 BPM schedules ~480 oscillator/gain pairs up front. That's acceptable
for a one-shot schedule against the audio clock, and it means click timing is sample-accurate
rather than subject to `setTimeout` jitter. Every oscillator is pushed into
`metronomeOscillators` so `clearMetronomeSchedule()` can stop them all.

### Re-scheduling

The schedule is torn down and rebuilt on every transport change, because the clicks are pinned
to absolute `AudioContext` times:

| Action | What happens |
| --- | --- |
| `play()` | schedules from the current offset, if enabled |
| `pause()` | `clearMetronomeSchedule()` |
| `seek()` | clear, then re-schedule from the new offset if it was playing |
| `setMetronomeEnabled(true)` | clear, then schedule immediately if already playing |
| `setMetronomeEnabled(false)` | clear |
| `dispose()` | clear |

### Routing

`metronomeGain` connects **directly to `destination`**, bypassing `masterGain`:

```
stems ──► per-stem gain ──► masterGain ──┐
                                          ├──► destination
metronome clicks ──► metronomeGain ──────┘
```

So the master volume fader does not attenuate the click. Deliberate — the click is a practice
aid, not part of the mix. Its own gain is fixed at `1` and not exposed in the UI, so the only
control is on/off.

## Phase alignment

Beat one is anchored to **time zero of the track**, not to a detected downbeat. Since
`beat_track`'s frame positions are thrown away server-side, the engine only knows *how fast* the
beats are, not *where* they fall.

Practically: the click is at the right tempo, but its phase relative to the music is arbitrary —
determined by whether the recording happens to start exactly on a beat. Songs with an intro,
a pickup bar, or any leading silence will have a click offset from the actual groove.

Fixing this means returning the first beat's time from `detect_tempo`, storing it (a new
`beat_offset_seconds` column), and using it as the phase origin in `scheduleMetronomeClicks`.
