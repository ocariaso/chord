/** "120" for a whole tempo, "119.7" otherwise. */
export function formatBpm(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}
