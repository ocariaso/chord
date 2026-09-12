const SILENCE_RMS_THRESHOLD = 0.01;
const SAMPLE_STRIDE = 8;

/** True if the vocals buffer carries real signal rather than near-silence. */
export function detectHasVocals(buffer: AudioBuffer): boolean {
  const data = buffer.getChannelData(0);
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += SAMPLE_STRIDE) {
    sumSquares += data[i] * data[i];
    count++;
  }
  return Math.sqrt(sumSquares / count) > SILENCE_RMS_THRESHOLD;
}
