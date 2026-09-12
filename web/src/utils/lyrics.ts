import type { Lyrics, LyricsLine } from "../api/client";

function currentLine(lines: LyricsLine[], currentTime: number): string | null {
  let current: string | null = null;
  for (const line of lines) {
    if (line.time <= currentTime) current = line.text;
    else break;
  }
  return current;
}

/** A single display-ready line for a one-line "now playing" lyrics readout. */
export function lyricsDisplayLine(lyrics: Lyrics | null | undefined, currentTime: number): string {
  if (lyrics === undefined) return "Looking for lyrics…";
  if (lyrics === null || (!lyrics.synced && !lyrics.plain)) return "No lyrics found";
  if (!lyrics.synced) return "Lyrics found (not synced)";
  return currentLine(lyrics.synced, currentTime) ?? "♪ ♪";
}

/** Just the current lyric line, or null — no status text, for supplementary displays. */
export function currentLyricLine(lyrics: Lyrics | null | undefined, currentTime: number): string | null {
  if (!lyrics?.synced) return null;
  return currentLine(lyrics.synced, currentTime);
}
