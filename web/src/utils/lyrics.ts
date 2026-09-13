import type { LyricsLine } from "../api/client";

/** Index of the synced line playing at `currentTime`, or −1 before the first one. Relies on sorted times. */
export function currentLineIndex(lines: LyricsLine[], currentTime: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) index = i;
    else break;
  }
  return index;
}
