const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function transposeNote(root: string, semitones: number): string {
  const index = NOTE_NAMES.indexOf(root);
  if (index === -1) return root;
  const shifted = ((index - semitones) % 12 + 12) % 12;
  return NOTE_NAMES[shifted];
}

/** A capo on fret N means the shapes you play read N semitones below the actual chord. */
export function transposeChord(chord: string, capo: number): string {
  if (capo === 0) return chord;
  const match = chord.match(/^([A-G]#?)(.*)$/);
  if (!match) return chord; // e.g. "N" for silence
  const [, root, suffix] = match;
  return `${transposeNote(root, capo)}${suffix}`;
}

/** keyLabel is formatted like "A major" or "C# minor". */
export function transposeKeyLabel(keyLabel: string, capo: number): string {
  if (capo === 0) return keyLabel;
  const [root, ...rest] = keyLabel.split(" ");
  return [transposeNote(root, capo), ...rest].join(" ");
}
