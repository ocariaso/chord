import { useId, useState } from "react";
import type { ChordSegment } from "../../api/client";
import { transposeChord, transposeKeyLabel } from "../../utils/transpose";
import { formatTime } from "../../utils/time";
import { LevelRing } from "./LevelRing";
import { useKnobDrag, valueToRotation } from "./useKnobDrag";
import { useSeekDrag } from "./useSeekDrag";
import { MASTER_WIDTH } from "./constants";

interface MasterUnitProps {
  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  keyLabel: string | null;
  onSeek: (seconds: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

const MIN_TRANSPOSE = -11;
const MAX_TRANSPOSE = 11;
const UPCOMING_COLORS = ["#6a6a6e", "#4a4a4e", "#3a3a3e"];

function formatTranspose(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function activeSegmentIndex(segments: ChordSegment[], currentTime: number): number {
  return segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);
}

function GainRing({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const monitorId = useId();
  const drag = useKnobDrag(value, onChange);
  const rotation = valueToRotation(value);

  return (
    <svg viewBox="0 0 56 56" width="46" height="46" className="cursor-ns-resize touch-none" {...drag}>
      <LevelRing value={value} />
      <circle cx={28} cy={28} r={19} fill={`url(#${monitorId})`} stroke="#0d0d0d" strokeWidth={1.5} />
      <line x1={28} y1={28} x2={28} y2={13} stroke="#3a3a3e" strokeWidth={2.4} strokeLinecap="round" transform={`rotate(${rotation} 28 28)`} />
      <defs>
        <radialGradient id={monitorId} cx="35%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="55%" stopColor="#d4d4d8" />
          <stop offset="100%" stopColor="#9a9a9e" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function MasterUnit({
  segments,
  currentTime,
  duration,
  keyLabel,
  onSeek,
  isPlaying,
  onPlayPause,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
}: MasterUnitProps) {
  const [transpose, setTranspose] = useState(0);

  const activeIndex = activeSegmentIndex(segments, currentTime);
  const activeChord = activeIndex >= 0 ? transposeChord(segments[activeIndex].chord, transpose) : "—";
  const playheadPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const seekPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const upcomingStart = activeIndex >= 0 ? activeIndex + 1 : 0;
  const upcomingChords = segments.slice(upcomingStart, upcomingStart + 3).map((s) => transposeChord(s.chord, transpose));

  const seekDrag = useSeekDrag(duration, onSeek);

  return (
    <div
      className="rounded-lg px-4 pt-2.5 shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
      style={{
        width: MASTER_WIDTH,
        background: "linear-gradient(100deg, #b8321f 0%, #9c281a 15%, #c43d28 30%, #9c281a 45%, #b8321f 60%, #c43d28 75%, #9c281a 90%, #b8321f 100%)",
      }}
    >
      <div className="flex items-center pb-2">
        <span className="font-['Oswald'] text-[13px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">Chord</span>
        <span className="font-['Oswald'] mx-1.5 text-[13px]" style={{ color: "#f5c2ba" }}>|</span>
        <span className="font-['Oswald'] text-[13px]" style={{ color: "#f5c2ba" }}>Master</span>
      </div>

      <div className="flex flex-col gap-3.5 rounded-t-md px-5 py-4" style={{ backgroundColor: "#161616" }}>
        <div className="flex items-center gap-5">
          <div className="flex flex-1 items-baseline gap-2.5">
            <span className="font-['Oswald'] text-[30px] font-bold tabular-nums text-white">{activeChord}</span>
            {upcomingChords.map((chord, i) => (
              <span key={i} className="text-base tabular-nums" style={{ color: UPCOMING_COLORS[i] }}>
                {chord}
              </span>
            ))}
          </div>

          {keyLabel && (
            <div className="flex items-center gap-1.5">
              <span className="font-['Oswald'] text-[10px] text-[#9a9a9e]">Key: {transposeKeyLabel(keyLabel, transpose)}</span>
              <span
                title="Adjust the key if detected wrong. This will transpose the chords accordingly."
                className="flex h-[13px] w-[13px] cursor-help items-center justify-center rounded-full border text-[9px] text-[#6a6a6e]"
                style={{ borderColor: "#6a6a6e" }}
              >
                i
              </span>
            </div>
          )}

          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTranspose((t) => Math.max(MIN_TRANSPOSE, t - 1))}
                disabled={transpose === MIN_TRANSPOSE}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-[#e5e5e5] shadow-[inset_0_0_0_1px_#4a4a4e] disabled:opacity-40"
                style={{ background: "radial-gradient(circle at 35% 30%,#3a3a3e,#0d0d0d 70%)" }}
              >
                −
              </button>
              <span className="font-['Oswald'] w-3.5 text-center text-[11px] text-[#e5e5e5]">{formatTranspose(transpose)}</span>
              <button
                onClick={() => setTranspose((t) => Math.min(MAX_TRANSPOSE, t + 1))}
                disabled={transpose === MAX_TRANSPOSE}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-[#e5e5e5] shadow-[inset_0_0_0_1px_#4a4a4e] disabled:opacity-40"
                style={{ background: "radial-gradient(circle at 35% 30%,#3a3a3e,#0d0d0d 70%)" }}
              >
                +
              </button>
            </div>
            <span className="font-['Oswald'] text-[7px] text-[#6a6a6e]">Transpose</span>
          </div>

          {onToggleMetronome && (
            <div className="flex flex-col items-center gap-0.5">
              <button
                onClick={onToggleMetronome}
                title="Toggle metronome"
                className="flex h-6.5 w-6.5 items-center justify-center rounded-full border-none"
                style={{
                  background: metronomeEnabled ? "radial-gradient(circle at 35% 30%, #ff6b52, #b8321f 70%)" : "radial-gradient(circle at 35% 30%, #4a4a4e, #1a1a1a 70%)",
                  boxShadow: metronomeEnabled ? "0 0 10px rgba(255,80,50,0.7), inset 0 0 0 2px #6b1810" : "inset 0 0 0 2px #2a2a2e",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} width="13" height="13">
                  <path d="M12 3l7 17H5z" strokeLinejoin="round" />
                  <path d="M12 7l3 10" strokeLinecap="round" />
                </svg>
              </button>
              <span className="font-['Oswald'] text-[7px] text-[#6a6a6e]">Metro</span>
            </div>
          )}
        </div>

        {segments.length > 0 && (
          <div
            className="relative flex h-6 cursor-pointer touch-none overflow-hidden rounded-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.7)]"
            {...seekDrag}
          >
            {segments.map((segment, i) => (
              <div
                key={i}
                title={transposeChord(segment.chord, transpose)}
                style={{
                  width: `${((segment.end - segment.start) / duration) * 100}%`,
                  background: i === activeIndex ? "linear-gradient(180deg,#e5533e,#b8321f)" : "#0d0d0d",
                  borderLeft: "1px solid #000",
                }}
                className="flex shrink-0 items-center justify-center overflow-hidden"
              >
                <span
                  className="font-['Oswald'] truncate px-0.5 text-[9px] font-medium"
                  style={{ color: i === activeIndex ? "#fff" : "#6a6a6e" }}
                >
                  {transposeChord(segment.chord, transpose)}
                </span>
              </div>
            ))}
            <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white shadow-[0_0_4px_#fff]" style={{ left: `${playheadPercent}%` }} />
          </div>
        )}

        <div className="flex items-center gap-4.5 pt-0.5">
          <button
            onClick={onPlayPause}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_2px_#6a6a6e,0_2px_4px_rgba(0,0,0,0.5)]"
            style={{ background: "radial-gradient(circle at 35% 28%, #f0f0f2, #9a9a9e 70%)" }}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <rect x="6" y="4" width="4.5" height="16" rx="1" fill="#161616" />
                <rect x="13.5" y="4" width="4.5" height="16" rx="1" fill="#161616" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M7 4.5v15l14-7.5z" fill="#161616" />
              </svg>
            )}
          </button>
          <span className="font-['Oswald'] w-[34px] text-[11px] text-[#9a9a9e]">{formatTime(currentTime)}</span>
          <div
            className="relative h-[5px] flex-1 cursor-pointer touch-none rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]"
            style={{ backgroundColor: "#0d0d0d" }}
            {...seekDrag}
          >
            <div className="absolute bottom-0 left-0 top-0 rounded" style={{ width: `${seekPercent}%`, backgroundColor: "#e5533e" }} />
          </div>
          <span className="font-['Oswald'] w-[34px] text-[11px] text-[#9a9a9e]">{formatTime(duration)}</span>

          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <GainRing value={masterVolume} onChange={onMasterVolumeChange} />
            <span className="font-['Oswald'] text-[7px] text-[#6a6a6e]">Master</span>
          </div>
        </div>
      </div>
    </div>
  );
}
