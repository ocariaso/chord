# Transpose

A semitone offset applied to every displayed chord and to the key label. Entirely client-side
and display-only.

## Why it exists

Two reasons, both practical:

1. **Detection is imperfect.** The key model confuses relative keys, and although
   [`_resolve_relative_ambiguity`](chords-and-key.md#relative-key-disambiguation) corrects the
   common case, it's a heuristic. The transpose control is the manual escape hatch, and the
   key tooltip says so: *"Adjust the key if detected wrong. This will transpose the chords
   accordingly."*
2. **Players need a different position.** A capo on the 2nd fret, a singer needing the song
   three semitones down, a horn player reading in a different concert pitch.

## State and range

`transpose` is `useState(0)` in [`StemMixer`](../../web/src/components/StemMixer.tsx), threaded
into both views. The setter is passed down as the raw
`React.Dispatch<React.SetStateAction<number>>`, so the +/− buttons can use the functional form
and clamp locally:

```tsx
onClick={() => onTransposeChange((t) => Math.max(MIN_TRANSPOSE, t - 1))}
onClick={() => onTransposeChange((t) => Math.min(MAX_TRANSPOSE, t + 1))}
```

`MIN_TRANSPOSE = -11`, `MAX_TRANSPOSE = 11` — declared **twice**, once in
[`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx) and once in
[`MasterUnit.tsx`](../../web/src/components/studio/MasterUnit.tsx), along with a duplicate
`formatTranspose` helper. ±11 rather than ±12 because 12 semitones is the same pitch class and
would display identically to 0.

The value is **not persisted** — no `localStorage`, nothing in the job row. Switching views
keeps it (the state lives above both), but leaving the job loses it.

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

`transposeChord(chord, semitones)` handles three cases in order:

1. `chord === "N"` → returns `"-"`. This runs **regardless of the offset**, which is how the
   "no chord detected" marker from madmom becomes a plain dash in the UI — the only reason this
   function is called even when `transpose === 0`.
2. `semitones === 0` → returns the chord unchanged (the fast path).
3. Otherwise match `/^([A-G]#?)(.*)$/` and rebuild: shift the root, keep the suffix verbatim.
   So `C#m7` → root `C#`, suffix `m7`. A label that doesn't match is returned as-is.

Because the suffix is opaque, this works for any quality madmom emits without enumerating them.

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
memoized:

| Location | Applied to |
| --- | --- |
| `ChordTimeline` | active chord, the five upcoming, every segment's text and `title` |
| `MasterUnit` | the LCD's active chord and upcoming five |
| both | the key label, via `transposeKeyLabel` |

The offset is displayed by `formatTranspose`, which prefixes a `+` for positive values
(`+3`, `0`, `-2`).

## What it does not do

**No audio changes.** There is no pitch shifting, resampling or playback-rate change — the
`PlaybackEngine` never sees `transpose`. After transposing, the chord symbols you read no longer
match the pitches you hear.

That is intended: the use case is a player with a capo, or someone transcribing into another
key, who wants the labels to match their instrument rather than the recording. But it is a real
semantic gap, and nothing in the UI signals it beyond the tooltip.

Implementing true pitch shift would mean an `AudioWorklet` or an offline render per stem —
substantially more machinery, and not the problem this control solves.
