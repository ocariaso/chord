# Chords and key detection

Produces the chord timeline and the key readout. Runs beside separation, shows as
`status=analyzing` only if it is still running once the stems are written, and is the one stage that
can be switched off entirely (`ENABLE_CHORD_DETECTION=false`).

## Pipeline

[`chords.py`](../../server/app/pipeline/chords.py) `analyze_audio(signal)` returns
`(list[ChordSegment], KeyEstimate)` using three madmom processors:

```
decoded Signal ──► CNNChordFeatureProcessor ──► features ──► CRFChordRecognitionProcessor
                                                                  │
                                                        (start, end, "C#:min") triples
                                                                  │
                                                        label normalization → ChordSegment[]

decoded Signal ──► CNNKeyRecognitionProcessor ──► prediction vector
                                                    │
                                        key_prediction_to_label → "Db major"
                                                    │
                                        flat→sharp, then relative-key disambiguation
```

Chords are a two-stage model by design: a CNN produces frame-level chord features, then a CRF
decodes them into temporally smoothed segments. Running the CNN alone would give noisy
per-frame labels rather than the clean segment boundaries the timeline needs.

All three processors are lazily constructed module-level singletons, the same pattern as the
Demucs separator — construction loads model data and is not cheap. `load_models()` builds them in
the worker's warm-up, before the first job.

The `Signal` is the job's one decode of the original mix, from
[`decode.decode_mono`](../../server/app/pipeline/decode.py): mono at 44.1 kHz, the shape both models
read, so their `SignalProcessor` passes it through untouched and the file is decoded once for chords,
key and tempo instead of three times. Measured against the old path-based calls, the chord features,
key prediction and segments are byte-identical.

Analysis runs on the job's analysis thread, started with separation, right after tempo detection
and on the same decode. If it is still running once the stems are written, `run_job` writes
`status=analyzing`, progress `0.9` and *Detecting chords and key* while it waits; if it finished
during separation, the job never reports `analyzing` at all. `chords.json` and `key.json` are
written by `run_job` on the worker thread once the result is collected, so a cancelled run's
analysis writes nothing — though it can't be stopped, and finishes unread.

## Label normalization

madmom's two models disagree with each other *and* with the rest of the app, so both are
normalized on the way in. Everything downstream of this module deals only in sharps.

**Chord labels** (`_madmom_label_to_chord`): madmom emits `root:quality`.

| madmom | CHORD |
| --- | --- |
| `C:maj` | `C` |
| `C:min` | `Cm` |
| `N` | `N` (no chord — the UI renders it as `—`) |
| anything else, e.g. `C:7` | `C7` (root + quality appended verbatim) |

**Key labels**: the key model names some keys with flats (`Db major`). `_FLAT_TO_SHARP` maps all
seven flat spellings to enharmonic sharps:

```python
{"Cb": "B", "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
```

The visible cost: musicians reading `A# minor` where they'd write `Bb minor`. The benefit is that
one 12-name array (`NOTE_NAMES`) indexes everything, on both sides of the wire — client-side
transposition in [`transpose.ts`](../../web/src/utils/transpose.ts) duplicates the same array.

## Relative-key disambiguation

A CNN key classifier confuses a major key with its relative minor constantly — they share a
pitch-class set, so the audio evidence is nearly identical. `_resolve_relative_ambiguity`
breaks the tie with harmonic evidence the key model never saw: **which tonic chord actually
dominates the song**.

```python
root_index = NOTE_NAMES.index(key_estimate.key)
if key_estimate.mode == "major":
    relative_index, relative_mode = (root_index - 3) % 12, "minor"   # A minor for C major
else:
    relative_index, relative_mode = (root_index + 3) % 12, "major"   # C major for A minor

def total_duration(note):    # summed seconds of every segment whose root is `note`
    return sum(s.end - s.start for s in segments if _chord_root(s.chord) == note)

if total_duration(NOTE_NAMES[relative_index]) > total_duration(NOTE_NAMES[root_index]):
    return KeyEstimate(key=..., mode=relative_mode, confidence=key_estimate.confidence)
```

Note that `total_duration` matches on **root only**, via `_ROOT_RE` — so `C`, `Cm`, `C7` and
`Cmaj7` all count toward `C`. The comparison is about which tonal center is played longest, not
which exact chord.

`confidence` is carried over unchanged even when the key is flipped, so the number does not
reflect the swap. That now shows: the analysis bar prints it next to the key as *NN% confident*,
and after a flip that percentage is the model's confidence in the key it originally chose.

This is a heuristic and can be wrong on modal or chromatic material. The UI's answer is the manual
[transpose](transpose.md) control beside the key, whose hint reads *semitones · chords follow* —
shifting it moves the key label and every chord together.

## Outputs, and where each one goes

Written by [`pipeline.py`](../../server/app/pipeline/pipeline.py):

| Artifact | Path | Served by |
| --- | --- | --- |
| Chord segments | `data/jobs/<id>/analysis/chords.json` | `GET /jobs/{id}/chords` |
| Key estimate | `data/jobs/<id>/analysis/key.json` | **nothing** |
| `key_estimate` | the `jobs` row, as `"A# minor"` | every `JobResponse` |
| `key_confidence` | the `jobs` row | every `JobResponse` |

`key.json` is written but never read by any endpoint — the key reaches the browser through the
job row's flattened `"<key> <mode>"` string instead. The file is effectively a debugging
artifact; it's the only place the structured `{key, mode, confidence}` survives.

`ChordSegment.confidence` is **hardcoded to `1.0`** for every segment. The field exists in the
schema and crosses the wire, but carries no information — the CRF decoder's per-segment
likelihood isn't extracted. Nothing in the UI reads it. (`key_confidence`, by contrast, is
displayed.)

## Turning it off

`ENABLE_CHORD_DETECTION=false` makes `run_job` skip the whole block: no `analyzing` status, no
`analysis/` directory, no `key_estimate`. Jobs still complete with stems and tempo. On the
client, `getChords` then 404s, `ResultsScreen`'s `.catch` stores `null`, and the chord bar replaces
the strip with *No chord analysis for this track.*; the chord readout shows `—`, and the key reads
`—` with no confidence. Nothing errors.

This is also the escape hatch if madmom's install breaks; see
[madmom is patched in place](../architecture/decisions.md#madmom-is-patched-in-place).

## Client rendering

`ResultsScreen` fetches the segments once per job and holds a three-state value: `undefined` while
the request is out, `null` when there is no analysis, otherwise the list. Everything is drawn by
[`ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx), which renders once above whichever
[view](results-views.md) is showing; the key is drawn by
[`AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx). Both look the same at every
width.

**The readout row.** The active chord in `.ch-chord-now`, then the next three chords — skipping
`N` segments — stepping down through the neutral ramp (500, 600, 700), then `m:ss / m:ss` at the end
of the row. Where no segment is active, or the active segment is `N`, the readout is `—`.

**The strip.** `.ch-chordstrip` holds one `.ch-chord` per segment, each with `flex: end − start`,
so widths are proportional to duration. Spacers before the first segment and after the last keep
those gaps at their share, since the strip spans the whole track (`max(duration, last end)`). The
active segment takes `.is-current` (an accent fill) and earlier ones `.is-past`.

A segment shows its label only when there is room: its width in pixels — from the strip's
`ResizeObserver`-measured width — must be at least `7 px × label length + 8 px`, and `N` segments
never show one. The reason is in the code: a clipped label would read as a different chord (`C#m7`
cut to `C#`). Labels are the transposed ones, and so is the length used for the room check. A
segment carries no hover `title`, so a chord too narrow for its label is a blank on the strip; the
readout row names it only once it is current or one of the next three.

On the strip sits the playhead (`--p`) and nothing else: an A–B loop isn't marked there (see
[speed and loop](speed-and-loop.md#ab-loop)). The strip seeks on press and drag through
[`useSeekDrag`](../../web/src/hooks/useSeekDrag.ts); it is `aria-hidden`, because the transport's
seek slider is the accessible way to seek.

**The key.** `transposeKeyLabel(key_estimate, transpose)` in 26 px, or `—`, followed by
`Math.round(key_confidence × 100)% confident` when a confidence exists.

The chord bar takes `getTime`, not a time, and reads the clock every animation frame through
`useClockValue`. Two binary searches over the sorted segments give what the bar shows: `endedCount`
(how many segments have ended — every one before it is `.is-past`) and `activeSegment` (the one
playing, or −1 before the first chord and in a gap). The bar renders only when one of those, the
`m:ss` readout or the lyric line changes (see [rendering cost](results-views.md#rendering-cost)), and
each render rebuilds every segment's label and width. The strip's playhead moves through
`usePlayhead`, without a render. In a gap between chords, the next-three list starts after the
segments already ended.

## Known gaps

- `ChordSegment.confidence` is a constant, and `key_confidence` isn't corrected after a relative-key
  flip.
- `key.json` is unserved.
- A segment too narrow for its label has no hover `title`, so it can't be read on the strip.
- Sharps only, in both the key and the chords.
