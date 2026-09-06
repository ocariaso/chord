import { useEffect, useId, useRef, useState } from "react";
import type { ChordSegment } from "../../api/client";
import { useClickTooltip } from "../../hooks/useClickTooltip";
import { transposeChord, transposeKeyLabel } from "../../utils/transpose";
import { formatTime } from "../../utils/time";
import { DownloadTrayIcon, UploadTrayIcon } from "./icons";
import { LevelRing } from "./LevelRing";
import { useKnobDrag, valueToRotation } from "./useKnobDrag";
import { useSeekDrag } from "./useSeekDrag";
import { MASTER_MOBILE_WIDTH, MASTER_WIDTH } from "./constants";

export type ViewMode = "simple" | "studio";

export interface MasterUnitProps {
  title: string;
  author: string | null;
  keyLabel: string | null;
  bpm: number | null;
  thumbnailUrl: string | null;
  transpose: number;
  onTransposeChange: React.Dispatch<React.SetStateAction<number>>;
  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  accentColor: string;
  onDownloadAll: () => void;
  isDownloadingAll: boolean;
  onUploadAnother: () => void;
  isMobile?: boolean;
}

const MIN_TRANSPOSE = -11;
const MAX_TRANSPOSE = 11;
const UPCOMING_COLORS = ["#379e64", "#2f6b45", "#27573a", "#1f452e", "#173323"];

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
  title,
  author,
  keyLabel,
  bpm,
  thumbnailUrl,
  transpose,
  onTransposeChange,
  segments,
  currentTime,
  duration,
  onSeek,
  isPlaying,
  onPlayPause,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
  viewMode,
  onChangeViewMode,
  accentColor,
  onDownloadAll,
  isDownloadingAll,
  onUploadAnother,
  isMobile = false,
}: MasterUnitProps) {
  const subtitle = [author, keyLabel, bpm != null ? `${bpm} BPM` : null].filter(Boolean).join(" · ");

  const titleContainerRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const [marqueeTextWidth, setMarqueeTextWidth] = useState(0);
  const MARQUEE_GAP = 48;

  useEffect(() => {
    const container = titleContainerRef.current;
    const measure = titleMeasureRef.current;
    if (!container || !measure) return;
    const natural = measure.scrollWidth;
    setMarqueeTextWidth(natural > container.clientWidth ? natural : 0);
  }, [title]);

  const marqueeDuration = Math.max(4, (marqueeTextWidth + MARQUEE_GAP) / 40);

  const activeIndex = activeSegmentIndex(segments, currentTime);
  const activeChord = activeIndex >= 0 ? transposeChord(segments[activeIndex].chord, transpose) : "—";
  const playheadPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const seekPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const upcomingStart = activeIndex >= 0 ? activeIndex + 1 : 0;
  const upcomingChords = segments.slice(upcomingStart, upcomingStart + 5).map((s) => transposeChord(s.chord, transpose));

  const seekDrag = useSeekDrag(duration, onSeek);
  const keyTooltip = useClickTooltip<HTMLDivElement>();

  const titleBoxBackgroundStyle: React.CSSProperties = {
    ...(thumbnailUrl
      ? {
          backgroundImage: `linear-gradient(90deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.65) 60%, rgba(10,10,10,0.3) 100%), url(${thumbnailUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {
          backgroundColor: "#141018",
          backgroundImage:
            "radial-gradient(circle at 22% 25%, rgba(147,51,234,0.22), transparent 55%)," +
            "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1.2px)," +
            "linear-gradient(135deg, #1b1420 0%, #130f17 55%, #0c0a0e 100%)",
          backgroundSize: "auto, 7px 7px, auto",
        }),
    boxShadow: "inset 0 2px 5px rgba(0,0,0,0.75), inset 0 0 0 1px #000, 0 0 0 1px rgba(255,255,255,0.06)",
  };

  const lcdContent = (
    <>
      <span
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 800,
          fontSize: 28,
          color: "#4ade80",
          textShadow: "0 0 8px rgba(74,222,128,0.75), 0 0 2px rgba(74,222,128,0.9)",
        }}
        className="tabular-nums"
      >
        {activeChord}
      </span>
      {upcomingChords.map((chord, i) => (
        <span
          key={i}
          style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 600, fontSize: 14, color: UPCOMING_COLORS[i] }}
          className="tabular-nums"
        >
          {chord}
        </span>
      ))}
    </>
  );

  const titleAndSubtitle = (
    <div ref={titleContainerRef} className="relative min-w-0 flex-1 overflow-hidden">
      <span ref={titleMeasureRef} aria-hidden="true" className="invisible absolute whitespace-nowrap text-[13px] font-semibold">
        {title}
      </span>
      {marqueeTextWidth > 0 ? (
        <h1
          className="flex whitespace-nowrap text-[13px] font-semibold text-neutral-100"
          style={
            {
              "--marquee-distance": `-${marqueeTextWidth + MARQUEE_GAP}px`,
              animation: `marquee-loop ${marqueeDuration}s linear infinite`,
            } as React.CSSProperties
          }
        >
          <span style={{ paddingRight: MARQUEE_GAP }}>{title}</span>
          <span style={{ paddingRight: MARQUEE_GAP }} aria-hidden="true">
            {title}
          </span>
        </h1>
      ) : (
        <h1 className="truncate text-[13px] font-semibold text-neutral-100">{title}</h1>
      )}
      {subtitle && <p className="truncate text-[10.5px] text-neutral-400">{subtitle}</p>}
    </div>
  );

  const trayIcons = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        onClick={onDownloadAll}
        disabled={isDownloadingAll}
        title={isDownloadingAll ? "Preparing zip..." : "Download all stems (.zip)"}
        className="flex h-6 w-6 items-center justify-center rounded text-neutral-300 hover:bg-black/40 disabled:text-neutral-600"
      >
        {isDownloadingAll ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-neutral-400 border-t-transparent" />
        ) : (
          <DownloadTrayIcon />
        )}
      </button>
      <button onClick={onUploadAnother} title="Upload another song" className="flex h-6 w-6 items-center justify-center rounded text-neutral-300 hover:bg-black/40">
        <UploadTrayIcon />
      </button>
    </div>
  );

  const viewModeCluster = (
    <div className="flex flex-col items-center gap-1">
      <span className="font-['Oswald'] text-[15px] font-semibold uppercase tracking-[0.14em] text-neutral-200">Master</span>
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={() => onChangeViewMode("simple")}
            title="Simple view"
            className="flex h-5 w-8 items-center justify-center rounded-sm"
            style={{ backgroundColor: "#141414", boxShadow: "inset 0 0 0 1px #2a2a2e, inset 0 1px 2px rgba(0,0,0,0.6)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: viewMode === "simple" ? accentColor : "#2a2a2e",
                boxShadow: viewMode === "simple" ? `0 0 5px ${accentColor}` : "none",
              }}
            />
          </button>
          <span className="font-['Oswald'] text-[6px] text-[#6a6a6e]">Simple</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={() => onChangeViewMode("studio")}
            title="Studio view"
            className="flex h-5 w-8 items-center justify-center rounded-sm"
            style={{ backgroundColor: "#141414", boxShadow: "inset 0 0 0 1px #2a2a2e, inset 0 1px 2px rgba(0,0,0,0.6)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: viewMode === "studio" ? "#4ade80" : "#2a2a2e",
                boxShadow: viewMode === "studio" ? "0 0 5px #4ade80" : "none",
              }}
            />
          </button>
          <span className="font-['Oswald'] text-[6px] text-[#6a6a6e]">Studio</span>
        </div>
      </div>
    </div>
  );

  const keyCluster = keyLabel && (
    <div className="flex flex-col items-center gap-0.5">
      <div ref={keyTooltip.containerRef} className="relative flex items-center gap-1">
        <div
          className="flex shrink-0 items-center justify-center rounded-sm px-1.5 py-0.5"
          style={{ backgroundColor: "#081a0e", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.85), inset 0 0 0 1px #000" }}
        >
          <span
            className="whitespace-nowrap tabular-nums"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 700,
              fontSize: 11,
              color: "#4ade80",
              textShadow: "0 0 4px rgba(74,222,128,0.8), 0 0 1px rgba(74,222,128,0.9)",
            }}
          >
            {transposeKeyLabel(keyLabel, transpose)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => keyTooltip.setOpen((v) => !v)}
          title="Adjust the key if detected wrong. This will transpose the chords accordingly."
          className="flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full text-[9px] leading-none text-[#6a6a6e] shadow-[inset_0_0_0_1px_#4a4a4e]"
        >
          i
        </button>
        {keyTooltip.open && (
          <div
            role="tooltip"
            style={{ backgroundColor: "#161616", boxShadow: "inset 0 0 0 1px #2a2a2e" }}
            className="absolute left-1/2 top-full z-10 mt-2 w-44 -translate-x-1/2 rounded-md p-2.5 text-[10px] leading-snug text-neutral-300 shadow-lg"
          >
            Adjust the key if detected wrong. This will transpose the chords accordingly.
          </div>
        )}
      </div>
      <span className="font-['Oswald'] text-[7px] text-[#6a6a6e]">Key</span>
    </div>
  );

  const transposeCluster = (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTransposeChange((t) => Math.max(MIN_TRANSPOSE, t - 1))}
          disabled={transpose === MIN_TRANSPOSE}
          className="flex h-5 w-5 items-center justify-center rounded-full text-[#e5e5e5] shadow-[inset_0_0_0_1px_#4a4a4e] disabled:opacity-40"
          style={{ background: "radial-gradient(circle at 35% 30%,#3a3a3e,#0d0d0d 70%)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width="10" height="10">
            <path d="M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
        <div
          className="flex w-7 shrink-0 items-center justify-center rounded-sm py-0.5"
          style={{ backgroundColor: "#081a0e", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.85), inset 0 0 0 1px #000" }}
        >
          <span
            className="tabular-nums"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 700,
              fontSize: 11,
              color: "#4ade80",
              textShadow: "0 0 4px rgba(74,222,128,0.8), 0 0 1px rgba(74,222,128,0.9)",
            }}
          >
            {formatTranspose(transpose)}
          </span>
        </div>
        <button
          onClick={() => onTransposeChange((t) => Math.min(MAX_TRANSPOSE, t + 1))}
          disabled={transpose === MAX_TRANSPOSE}
          className="flex h-5 w-5 items-center justify-center rounded-full text-[#e5e5e5] shadow-[inset_0_0_0_1px_#4a4a4e] disabled:opacity-40"
          style={{ background: "radial-gradient(circle at 35% 30%,#3a3a3e,#0d0d0d 70%)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width="10" height="10">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <span className="font-['Oswald'] text-[7px] text-[#6a6a6e]">Transpose</span>
    </div>
  );

  const metroCluster = onToggleMetronome && (
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
  );

  return (
    <div
      className="rounded-lg px-4 pt-4 shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
      style={{
        width: isMobile ? MASTER_MOBILE_WIDTH : MASTER_WIDTH,
        background: "linear-gradient(100deg, #b8321f 0%, #9c281a 15%, #c43d28 30%, #9c281a 45%, #b8321f 60%, #c43d28 75%, #9c281a 90%, #b8321f 100%)",
      }}
    >
      <div className="flex flex-col gap-3.5 rounded-t-md px-5 py-4" style={{ backgroundColor: "#161616" }}>
        {isMobile ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex h-11 min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md px-3" style={titleBoxBackgroundStyle}>
              {titleAndSubtitle}
              {trayIcons}
            </div>
            <div
              className="flex w-full items-baseline gap-2.5 overflow-hidden rounded px-3.5 py-1.5"
              style={{ backgroundColor: "#081a0e", boxShadow: "inset 0 2px 5px rgba(0,0,0,0.8), inset 0 0 0 1px #000" }}
            >
              {lcdContent}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {viewModeCluster}
              {keyCluster}
              {transposeCluster}
              {metroCluster}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div
              className="flex shrink-0 items-baseline gap-2.5 overflow-hidden rounded px-3.5 py-1.5"
              style={{ width: 310, backgroundColor: "#081a0e", boxShadow: "inset 0 2px 5px rgba(0,0,0,0.8), inset 0 0 0 1px #000" }}
            >
              {lcdContent}
            </div>

            <div className="flex h-[52px] min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden rounded-md px-3" style={titleBoxBackgroundStyle}>
              {titleAndSubtitle}
              {trayIcons}
            </div>

            <div className="flex items-center gap-5">
              {viewModeCluster}
              {keyCluster}
              {transposeCluster}
              {metroCluster}
            </div>
          </div>
        )}

        {segments.length > 0 && (
          <div
            className="relative flex h-6 select-none cursor-pointer touch-none overflow-hidden rounded-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.7)]"
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
            className="relative h-[5px] flex-1 select-none cursor-pointer touch-none rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]"
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
