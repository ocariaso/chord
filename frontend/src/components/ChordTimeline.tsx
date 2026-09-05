import { useState } from "react";
import type { ChordSegment } from "../api/client";
import { transposeChord, transposeKeyLabel } from "../utils/transpose";

interface ChordTimelineProps {
  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  keyLabel: string | null;
  onSeek: (seconds: number) => void;
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
const UPCOMING_OPACITY = ["text-neutral-500", "text-neutral-600", "text-neutral-700"];

export function ChordTimeline({ segments, currentTime, duration, keyLabel, onSeek }: ChordTimelineProps) {
  const [transpose, setTranspose] = useState(0);

  if (segments.length === 0) return null;

  const activeIndex = activeSegmentIndex(segments, currentTime);
  const activeChord = activeIndex >= 0 ? transposeChord(segments[activeIndex].chord, transpose) : "—";
  const playheadPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const upcomingStart = activeIndex >= 0 ? activeIndex + 1 : 0;
  const upcomingChords = segments
    .slice(upcomingStart, upcomingStart + 3)
    .map((s) => transposeChord(s.chord, transpose));

  return (
    <div className="flex flex-col gap-3 rounded-md bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums text-neutral-100">{activeChord}</span>
          {upcomingChords.length > 0 && (
            <div className="flex items-baseline gap-2.5">
              {upcomingChords.map((chord, i) => (
                <span key={i} className={`text-lg font-medium tabular-nums ${UPCOMING_OPACITY[i]}`}>
                  {chord}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {keyLabel && (
            <span className="text-sm text-neutral-500">Key: {transposeKeyLabel(keyLabel, transpose)}</span>
          )}
          <div className="flex items-center gap-1.5 text-sm text-neutral-400">
            <span>Transpose</span>
            <button
              onClick={() => setTranspose((t) => Math.max(MIN_TRANSPOSE, t - 1))}
              disabled={transpose === MIN_TRANSPOSE}
              className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 font-semibold hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="w-6 text-center tabular-nums text-neutral-200">{formatTranspose(transpose)}</span>
            <button
              onClick={() => setTranspose((t) => Math.min(MAX_TRANSPOSE, t + 1))}
              disabled={transpose === MAX_TRANSPOSE}
              className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 font-semibold hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div
        className="relative flex h-8 cursor-pointer overflow-hidden rounded"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientX - rect.left) / rect.width;
          onSeek(Math.max(0, Math.min(fraction * duration, duration)));
        }}
      >
        {segments.map((segment, i) => (
          <div
            key={i}
            title={transposeChord(segment.chord, transpose)}
            style={{ width: `${((segment.end - segment.start) / duration) * 100}%` }}
            className={`flex shrink-0 items-center justify-center overflow-hidden border-r border-neutral-950 text-xs font-medium ${
              i === activeIndex ? "bg-purple-600 text-white" : "bg-neutral-800 text-neutral-400"
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
