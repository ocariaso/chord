import type { ChordSegment, Lyrics } from "../../api/client";
import { resultsCopy } from "../../design/copy";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useSeekDrag } from "../../hooks/useSeekDrag";
import { currentLineIndex } from "../../utils/lyrics";
import { formatTime } from "../../utils/time";
import { transposeChord } from "../../utils/transpose";

interface ChordBarProps {
  /** undefined while loading, null when the job has no chord analysis. */
  segments: ChordSegment[] | null | undefined;
  time: number;
  duration: number;
  transpose: number;
  onSeek: (seconds: number) => void;
  /** undefined while loading, null when none were found. */
  lyrics: Lyrics | null | undefined;
  onOpenLyricSheet: () => void;
  onAddLyrics: () => void;
}

const NO_CHORD = "N";
const UPCOMING_CHORDS = 3;
// The design dims the second and third upcoming chords one and two ramp steps below the first.
const UPCOMING_COLORS = [undefined, "var(--color-neutral-600)", "var(--color-neutral-700)"];
// A segment too narrow for its label shows none: clipped text would read as a different chord.
const LABEL_PX_PER_CHARACTER = 7;
const LABEL_PADDING_PX = 8;

function LyricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--space-4)" }}>
      <span className="ch-label">{label}</span>
      {children}
    </div>
  );
}

/** The chords and lyric section (design.md#chords-and-lyrics): the chord now and the next three, the strip, and the lyric row. */
export function ChordBar({ segments, time, duration, transpose, onSeek, lyrics, onOpenLyricSheet, onAddLyrics }: ChordBarProps) {
  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();
  const seekDrag = useSeekDrag(duration, onSeek);

  const list = segments ?? [];
  const activeIndex = list.findIndex((segment) => time >= segment.start && time < segment.end);
  // Before the first chord, in a gap, and in a no-chord segment alike, there is no chord to name.
  const current = activeIndex >= 0 ? list[activeIndex].chord : NO_CHORD;
  const nowChord = current === NO_CHORD ? resultsCopy.noValue : transposeChord(current, transpose);
  const upcoming = list
    .slice(activeIndex + 1)
    .filter((segment) => segment.chord !== NO_CHORD)
    .slice(0, UPCOMING_CHORDS);

  // The strip spans the whole track, so gaps before the first chord or after the last keep their share.
  const trackLength = Math.max(duration, list.at(-1)?.end ?? 0);
  const leadingGap = list[0]?.start ?? 0;
  const trailingGap = trackLength - (list.at(-1)?.end ?? 0);
  const playhead = trackLength > 0 ? Math.min(1, time / trackLength) : 0;

  let lyricRow: React.ReactNode;
  if (lyrics === undefined) {
    lyricRow = (
      <LyricRow label={resultsCopy.lyrics}>
        <span className="ch-hint">{resultsCopy.lookingForLyrics}</span>
      </LyricRow>
    );
  } else if (lyrics?.synced?.length) {
    const lineIndex = currentLineIndex(lyrics.synced, time);
    lyricRow = (
      <LyricRow label={resultsCopy.lyric}>
        {/* Before the first line starts, that line shows dimmed as what's coming. */}
        <span className={lineIndex >= 0 ? "ch-lyric" : "ch-lyric-next"}>{lyrics.synced[Math.max(0, lineIndex)].text}</span>
      </LyricRow>
    );
  } else if (lyrics?.plain) {
    lyricRow = (
      <LyricRow label={resultsCopy.lyrics}>
        <span className="ch-hint">{resultsCopy.lyricsPlain}</span>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={onOpenLyricSheet}>
          {resultsCopy.openLyricSheet}
        </button>
      </LyricRow>
    );
  } else {
    lyricRow = (
      <LyricRow label={resultsCopy.lyrics}>
        <span className="ch-hint">{resultsCopy.lyricsNone}</span>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={onAddLyrics}>
          {resultsCopy.addLyrics}
        </button>
      </LyricRow>
    );
  }

  return (
    <div className="ch-section flex flex-col" style={{ gap: 14 }}>
      <div className="flex flex-wrap items-baseline" style={{ gap: 14 }}>
        <span className="ch-label">{resultsCopy.chords}</span>
        <span className="ch-chord-now" style={{ color: "var(--color-text)" }}>
          {nowChord}
        </span>
        {upcoming.map((segment, index) => (
          <span key={segment.start} className="ch-chord-next" style={{ color: UPCOMING_COLORS[index] }}>
            {transposeChord(segment.chord, transpose)}
          </span>
        ))}
        <span className="ch-value-sm" style={{ marginLeft: "auto" }}>
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>
      {segments === null ? (
        <span className="ch-hint">{resultsCopy.noChords}</span>
      ) : (
        // The transport's seek slider is the accessible way to seek; the strip is a pointer shortcut to it.
        <div ref={stripRef} className="ch-chordstrip" aria-hidden="true" {...seekDrag}>
          {leadingGap > 0 && <span style={{ flex: leadingGap }} />}
          {list.map((segment, index) => {
            const label = transposeChord(segment.chord, transpose);
            const widthPx = trackLength > 0 ? ((segment.end - segment.start) / trackLength) * stripWidth : 0;
            const showLabel =
              segment.chord !== NO_CHORD && widthPx >= label.length * LABEL_PX_PER_CHARACTER + LABEL_PADDING_PX;
            const isPast = activeIndex >= 0 ? index < activeIndex : segment.end <= time;
            const className = index === activeIndex ? "ch-chord is-current" : isPast ? "ch-chord is-past" : "ch-chord";
            return (
              <span key={segment.start} className={className} style={{ flex: segment.end - segment.start }}>
                {showLabel ? label : null}
              </span>
            );
          })}
          {trailingGap > 0 && <span style={{ flex: trailingGap }} />}
          <span className="ch-playhead" style={{ "--p": playhead } as React.CSSProperties} />
        </div>
      )}
      {lyricRow}
    </div>
  );
}
