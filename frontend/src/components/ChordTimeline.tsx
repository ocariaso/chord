import type { ChordSegment } from "../api/client";
import { useClickTooltip } from "../hooks/useClickTooltip";
import { transposeChord, transposeKeyLabel } from "../utils/transpose";
import { useSeekDrag } from "./studio/useSeekDrag";

const KEY_HELP_TEXT = "Adjust the key if detected wrong. This will transpose the chords accordingly.";

interface ChordTimelineProps {
  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  keyLabel: string | null;
  onSeek: (seconds: number) => void;
  accentColor: string;
  cardBorder: string;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  isMobile: boolean;
  transpose: number;
  onTransposeChange: React.Dispatch<React.SetStateAction<number>>;
  lyricLine?: string;
}

function MetronomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M12 3l7 17H5z" strokeLinejoin="round" />
      <path d="M12 7l3 10" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0">
      <path d="M4 9v6h4l5 5V4L8 9H4z" strokeLinejoin="round" />
      <path d="M16 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
    </svg>
  );
}

const MIN_TRANSPOSE = -11;
const MAX_TRANSPOSE = 11;

function formatTranspose(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function activeSegmentIndex(segments: ChordSegment[], currentTime: number): number {
  return segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);
}

// Progressively dimmer the further away a chord is, so the queue reads as a fade-out.
const UPCOMING_OPACITY = ["text-neutral-500", "text-neutral-500", "text-neutral-600", "text-neutral-600", "text-neutral-700"];

export function ChordTimeline({
  segments,
  currentTime,
  duration,
  keyLabel,
  onSeek,
  accentColor,
  cardBorder,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
  isMobile,
  transpose,
  onTransposeChange,
  lyricLine,
}: ChordTimelineProps) {
  const keyTooltip = useClickTooltip<HTMLSpanElement>();

  if (segments.length === 0) return null;

  const activeIndex = activeSegmentIndex(segments, currentTime);
  const activeChord = activeIndex >= 0 ? transposeChord(segments[activeIndex].chord, transpose) : "—";
  const playheadPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const upcomingStart = activeIndex >= 0 ? activeIndex + 1 : 0;
  const upcomingChords = segments
    .slice(upcomingStart, upcomingStart + 5)
    .map((s) => transposeChord(s.chord, transpose));

  const segmentBg = `color-mix(in srgb, ${cardBorder} 60%, #262626)`;
  const seekDrag = useSeekDrag(duration, onSeek);

  const chordGroup = (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-neutral-100">{activeChord}</span>
        {upcomingChords.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2.5">
            {upcomingChords.map((chord, i) => (
              <span key={i} className={`text-lg font-medium tabular-nums ${UPCOMING_OPACITY[i]}`}>
                {chord}
              </span>
            ))}
          </div>
        )}
      </div>
      {lyricLine && (
        <p className="text-sm italic sm:max-w-sm" style={{ color: accentColor }}>
          {lyricLine}
        </p>
      )}
    </div>
  );

  const keySpan = keyLabel && (
    <span ref={keyTooltip.containerRef} className="relative flex items-center gap-1 text-sm text-neutral-500">
      Key: {transposeKeyLabel(keyLabel, transpose)}
      <button
        type="button"
        onClick={() => keyTooltip.setOpen((v) => !v)}
        title="Adjust the key if detected wrong. This will transpose the chords accordingly."
        style={{ borderColor: cardBorder }}
        className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border text-[10px] leading-none text-neutral-500"
      >
        i
      </button>
      {keyTooltip.open && (
        <div
          role="tooltip"
          style={{ backgroundColor: "#171717", boxShadow: `inset 0 0 0 1px ${cardBorder}` }}
          className="absolute left-0 top-full z-10 mt-2 w-56 rounded-md p-2.5 text-xs leading-snug text-neutral-300 shadow-lg"
        >
          {KEY_HELP_TEXT}
        </div>
      )}
    </span>
  );

  const transposeGroup = (
    <div className="flex shrink-0 items-center gap-1.5 text-sm text-neutral-400">
      <span>Transpose</span>
      <button
        onClick={() => onTransposeChange((t) => Math.max(MIN_TRANSPOSE, t - 1))}
        disabled={transpose === MIN_TRANSPOSE}
        style={{ boxShadow: `inset 0 0 0 1px ${cardBorder}` }}
        className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 font-semibold hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <span className="w-6 text-center tabular-nums text-neutral-200">{formatTranspose(transpose)}</span>
      <button
        onClick={() => onTransposeChange((t) => Math.min(MAX_TRANSPOSE, t + 1))}
        disabled={transpose === MAX_TRANSPOSE}
        style={{ boxShadow: `inset 0 0 0 1px ${cardBorder}` }}
        className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 font-semibold hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );

  const volumeGroup = (
    <div className="flex shrink-0 items-center gap-2 text-neutral-400" title="Master volume">
      <SpeakerIcon />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={masterVolume}
        onChange={(e) => onMasterVolumeChange(Number(e.target.value))}
        style={{ accentColor }}
        className="w-20"
      />
    </div>
  );

  const metronomeButton = onToggleMetronome && (
    <button
      onClick={onToggleMetronome}
      title="Toggle metronome"
      style={metronomeEnabled ? { backgroundColor: accentColor } : { boxShadow: `inset 0 0 0 1px ${cardBorder}` }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
        metronomeEnabled ? "text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
      }`}
    >
      <MetronomeIcon />
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {isMobile ? (
        <div className="flex flex-col gap-2">
          {chordGroup}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {keySpan}
            {metronomeButton}
          </div>
          <div className="flex items-center justify-between gap-4">
            {transposeGroup}
            {volumeGroup}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {chordGroup}
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex shrink-0 items-center gap-x-4">
              {keySpan}
              {transposeGroup}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {volumeGroup}
              {metronomeButton}
            </div>
          </div>
        </div>
      )}

      <div
        className="relative flex h-8 cursor-pointer touch-none select-none overflow-hidden rounded"
        {...seekDrag}
      >
        {segments.map((segment, i) => (
          <div
            key={i}
            title={transposeChord(segment.chord, transpose)}
            style={{
              width: `${((segment.end - segment.start) / duration) * 100}%`,
              backgroundColor: i === activeIndex ? accentColor : segmentBg,
            }}
            className={`flex shrink-0 items-center justify-center overflow-hidden border-r border-neutral-950 text-xs font-medium ${
              i === activeIndex ? "text-white" : "text-neutral-400"
            }`}
          >
            <span className="truncate px-1">{transposeChord(segment.chord, transpose)}</span>
          </div>
        ))}
        <div
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>
    </div>
  );
}
