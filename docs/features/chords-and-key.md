# Chords and key detection

Produces the chord timeline and the key readout. Runs under `status=analyzing`, and is the one
stage that can be switched off entirely (`ENABLE_CHORD_DETECTION=false`).

## Pipeline

[`chords.py`](../../server/app/pipeline/chords.py) `analyze_audio(path)` returns
`(list[ChordSegment], KeyEstimate)` using three madmom processors:

```
audio file ──► CNNChordFeatureProcessor ──► features ──► CRFChordRecognitionProcessor
                                                              │
                                                    (start, end, "C#:min") triples
                                                              │
                                                    label normalization → ChordSegment[]

audio file ──► CNNKeyRecognitionProcessor ──► prediction vector
                                                    │
                                        key_prediction_to_label → "Db major"
                                                    │
                                        flat→sharp, then relative-key disambiguation
```

Chords are a two-stage model by design: a CNN produces frame-level chord features, then a CRF
decodes them into temporally smoothed segments. Running the CNN alone would give noisy
per-frame labels rather than the clean segment boundaries the timeline needs.

All three processors are lazily constructed module-level singletons, the same pattern as the
Demucs separator — construction loads model data and is not cheap.

## Label normalization

madmom's two models disagree with each other *and* with the rest of the app, so both are
normalized on the way in. Everything downstream of this module deals only in sharps.

**Chord labels** (`_madmom_label_to_chord`): madmom emits `root:quality`.

| madmom | CHORD |
| --- | --- |
| `C:maj` | `C` |
| `C:min` | `Cm` |
| `N` | `N` (no chord — the UI renders it as `-`) |
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
reflect the swap.

This is a heuristic and can be wrong on modal or chromatic material. The UI's answer to that is
the manual [transpose](transpose.md) control, whose tooltip says so explicitly: *"Adjust the key
if detected wrong. This will transpose the chords accordingly."*

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
likelihood isn't extracted. Nothing in the UI reads it.

## Turning it off

`ENABLE_CHORD_DETECTION=false` makes `run_job` skip the whole block: no `analyzing` status, no
`analysis/` directory, no `key_estimate`. Jobs still complete with stems and tempo. On the
client, `getChords` then 404s, the `.catch` leaves `chordSegments` empty, and `ChordTimeline`
returns `null` early (`if (segments.length === 0) return null`) — so the Simple view simply has
no timeline and the Studio LCD shows `—`. Nothing errors.

This is also the escape hatch if madmom's install breaks; see
[madmom is patched in place](../architecture/decisions.md#madmom-is-patched-in-place).

## Client rendering

Fetched once per job in `StemMixer` and passed to both views.

- **Simple** — [`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx): the active
  chord large, the next five progressively dimmed (`UPCOMING_OPACITY`), plus a proportional
  segment bar where each segment's width is `(end - start) / duration` and the active one takes
  the accent color. A white playhead is positioned by percentage, and `useSeekDrag` on the bar
  makes it click-and-drag seekable.
- **Studio** — [`MasterUnit.tsx`](../../web/src/components/studio/MasterUnit.tsx): the same data
  on a simulated LCD, in Orbitron with a green text-shadow glow, upcoming chords fading through
  a hardcoded green ramp (`UPCOMING_COLORS`).

Both find the active chord with the same linear scan:

```ts
segments.findIndex((s) => currentTime >= s.start && currentTime < s.end)
```

Run every animation frame, on a few hundred segments. Fine in practice; the first thing to
optimize if the timeline ever gets long.
