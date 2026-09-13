# Transpose

A semitone offset applied to every displayed chord and to the key label. Entirely client-side
and display-only.

## Why it exists

Two reasons, both practical:

1. **Detection is imperfect.** The key model confuses relative keys, and although
   [`_resolve_relative_ambiguity`](chords-and-key.md#relative-key-disambiguation) corrects the
   common case, it's a heuristic. The transpose control, placed directly beside the key, is the
   manual escape hatch; its hint reads *semitones · chords follow*.
2. **Players need a different position.** A capo on the 2nd fret, a singer needing the song
   three semitones down, a horn player reading in a different concert pitch.

## State and range

`transpose` is part of the design's `PlayerState` ([State](../conventions/design.md#state)), held in
[`ResultsScreen`](../../web/src/screens/results/ResultsScreen.tsx)'s reducer. The range is declared
**once**, in [`design/player.ts`](../../web/src/design/player.ts), and exported:

```ts
// ±11 rather than ±12: twelve semitones is the same pitch class and would read identically to 0.
export const MIN_TRANSPOSE = -11;
export const MAX_TRANSPOSE = 11;
```

The − and + buttons in [`AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx) call
`onTransposeChange(transpose - 1)` and `(transpose + 1)`, and disable themselves at the limits.
[`playerReducer`](../../web/src/screens/results/playerReducer.ts) clamps again when it stores the
value, so nothing outside the range can get in by another route:

```ts
case "transposeChanged":
  return { ...state, transpose: Math.max(MIN_TRANSPOSE, Math.min(MAX_TRANSPOSE, action.transpose)) };
```

The offset is shown between the buttons with `formatSigned(transpose, 0)` from
[`levels.ts`](../../web/src/utils/levels.ts) — `+3`, `0`, `−2`, with a real minus sign so the
readout stays on the tabular-numeral grid — inside an `aria-live` region, so a screen reader
announces each step.

The value is **not persisted** — no `localStorage`, nothing in the job row. The analysis bar and
the chord bar render once, above the view switch, so changing between Mixer, Console and Analog can
neither lose nor duplicate it; leaving the job loses it.

The analysis bar stays below 720 px, so a phone has the transpose control too.

## The transform

[`utils/transpose.ts`](../../web/src/utils/transpose.ts), 24 lines:

```ts
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function transposeNote(root: string, semitones: number): string {
  const index = NOTE_NAMES.indexOf(root);
  if (index === -1) return root;                       // unknown root passes through
  const shifted = ((index + semitones) % 12 + 12) % 12;  // JS % keeps the sign
  return NOTE_NAMES[shifted];
}
```

The double modulo is required: JavaScript's `%` returns a negative remainder for negative
operands, so `(-2) % 12 === -2` and the array index would be invalid.

`transposeChord(chord, semitones)` handles two cases:

1. `semitones === 0` → returns the chord unchanged (the fast path).
2. Otherwise match `/^([A-G]#?)(.*)$/` and rebuild: shift the root, keep the suffix verbatim.
   So `C#m7` → root `C#`, suffix `m7`. A label that doesn't match is returned as-is — madmom's `N`,
   the no-chord marker, included.

Because the suffix is opaque, this works for any quality madmom emits without enumerating them. The
`N` itself never reaches the screen: [`ChordBar`](../../web/src/screens/results/ChordBar.tsx) shows
`—` for it in the readout, as it does for a moment outside every segment, and gives an `N` segment on
the strip no label.

`transposeKeyLabel("A minor", 3)` splits on whitespace, shifts the first token, and rejoins —
`"C minor"`. It assumes the `"<root> <mode>"` format that
[`pipeline.py`](../../server/app/pipeline/pipeline.py) writes as
`f"{key_estimate.key} {key_estimate.mode}"`.

Note this module duplicates `NOTE_NAMES` from
[`chords.py`](../../server/app/pipeline/chords.py). There is no shared constants source across
the language boundary; both lists must stay in the same sharps-only convention. See
[the decision](../architecture/decisions.md#sharps-everywhere-normalized-at-the-boundary).

## Where it's applied

Every chord label passes through `transposeChord` at render time — nothing is precomputed or
memoized, and while playing that means every frame:

| Location | Applied to |
| --- | --- |
| [`ChordBar`](../../web/src/screens/results/ChordBar.tsx) | the active chord, the next three, and every strip segment's label — including the room check that decides whether a segment shows its label, which uses the transposed label's length |
| [`AnalysisBar`](../../web/src/screens/results/AnalysisBar.tsx) | the key label, via `transposeKeyLabel` |

The Mixer, Console and Analog views show no chords, so the offset never reaches them. Shifting can
change a label's length (`C` to `C#`), so a narrow segment can lose or gain its label as you
transpose.

## What it does not do

**No audio changes.** There is no pitch shifting or resampling — the `PlaybackEngine` never sees
`transpose`. After transposing, the chord symbols you read no longer match the pitches you hear.

That is intended: the use case is a player with a capo, or someone transcribing into another
key, who wants the labels to match their instrument rather than the recording. But it is a real
semantic gap, and nothing in the UI signals it beyond the hint *chords follow*. See
[the decision](../architecture/decisions.md#transposition-is-client-side-and-display-only).

The engine now does have an AudioWorklet — the time-stretch processor behind
[speed](speed-and-loop.md#speed) — but that processor exists to keep pitch fixed while tempo
changes. Shifting pitch could build on the same machinery (stretch by the interval's ratio,
`2^(n/12)`, then resample back to the original length), but none of that exists. It would also put
the worklet in the path at every transposed setting, where today 1× playback bypasses it
completely.
