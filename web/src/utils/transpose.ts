const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function transposeNote(root: string, semitones: number): string {
  const index = NOTE_NAMES.indexOf(root);
  if (index === -1) return root;
  const shifted = ((index + semitones) % 12 + 12) % 12;
  return NOTE_NAMES[shifted];
}

export function transposeChord(chord: string, semitones: number): string {
  if (chord === "N") return "-"; // no chord detected (silence) — display as a plain dash, not the model's raw "N" label
  if (semitones === 0) return chord;
  const match = chord.match(/^([A-G]#?)(.*)$/);
  if (!match) return chord;
  const [, root, suffix] = match;
  return `${transposeNote(root, semitones)}${suffix}`;
}

/** keyLabel is formatted like "A major" or "C# minor". */
export function transposeKeyLabel(keyLabel: string, semitones: number): string {
  if (semitones === 0) return keyLabel;
  const [root, ...rest] = keyLabel.split(" ");
  return [transposeNote(root, semitones), ...rest].join(" ");
}
