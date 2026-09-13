const ENVELOPE_BINS = 160;
// Every 8th sample is plenty for a display envelope, and ~8× faster over six full-length stems.
const SAMPLE_STRIDE = 8;
// sqrt lifts quiet passages so a soft stem still reads as a shape; the floor keeps silence visible.
const MIN_HALF_HEIGHT = 0.02;
const MAX_HALF_HEIGHT = 0.48;

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

/**
 * A CSS `polygon()` tracing a stem's peak envelope — top edge left→right, then bottom edge
 * right→left — used to clip the `.ch-wave` bar pattern into the stem's real shape.
 */
export function waveformPolygon(buffer: AudioBuffer, bins = ENVELOPE_BINS): string {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const binSize = Math.max(1, Math.floor(buffer.length / bins));
  const halfHeights: number[] = [];

  for (let bin = 0; bin < bins; bin++) {
    const end = Math.min(buffer.length, (bin + 1) * binSize);
    let peak = 0;
    for (const data of channels) {
      for (let i = bin * binSize; i < end; i += SAMPLE_STRIDE) {
        const magnitude = Math.abs(data[i]);
        if (magnitude > peak) peak = magnitude;
      }
    }
    halfHeights.push(Math.max(MIN_HALF_HEIGHT, Math.sqrt(Math.min(1, peak)) * MAX_HALF_HEIGHT));
  }

  const x = (bin: number) => percent(bin / (bins - 1));
  const top = halfHeights.map((h, bin) => `${x(bin)} ${percent(0.5 - h)}`);
  const bottom = halfHeights.map((h, bin) => `${x(bin)} ${percent(0.5 + h)}`).reverse();
  return `polygon(${[...top, ...bottom].join(",")})`;
}
