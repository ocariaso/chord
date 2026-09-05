import { useId, useRef } from "react";
import { DownloadLed } from "../DownloadLed";
import { ScallopedKnob } from "../ScallopedKnob";
import type { AmpProps } from "../types";
import { useDownload } from "../useDownload";
import { useSeekDrag } from "../useSeekDrag";
import { useStemWaveform } from "../useStemWaveform";
import { AMP_WIDTH } from "../constants";

function CornerBracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const id = useId();
  const paths: Record<typeof position, { style: React.CSSProperties; d: string; x1: string; y1: string; x2: string; y2: string }> = {
    tl: { style: { top: 2, left: 2 }, d: "M2 20 L2 8 Q2 2 8 2 L20 2", x1: "0", y1: "0", x2: "1", y2: "1" },
    tr: { style: { top: 2, right: 2 }, d: "M32 20 L32 8 Q32 2 26 2 L14 2", x1: "1", y1: "0", x2: "0", y2: "1" },
    bl: { style: { bottom: 2, left: 2 }, d: "M2 14 L2 26 Q2 32 8 32 L20 32", x1: "0", y1: "1", x2: "1", y2: "0" },
    br: { style: { bottom: 2, right: 2 }, d: "M32 14 L32 26 Q32 32 26 32 L14 32", x1: "1", y1: "1", x2: "0", y2: "0" },
  };
  const p = paths[position];
  return (
    <svg className="absolute" style={p.style} width="34" height="34" viewBox="0 0 34 34">
      <path d={p.d} fill="none" stroke={`url(#${id})`} strokeWidth={6} strokeLinecap="round" />
      <defs>
        <linearGradient id={id} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}>
          <stop offset="0%" stopColor="#f2f2f4" />
          <stop offset="50%" stopColor="#8a8a90" />
          <stop offset="100%" stopColor="#e8e8ec" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BassAmp({
  name,
  buffer,
  muted,
  isSoloed,
  volume,
  downloadHref,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onWaveSurferReady,
  duration,
  onSeek,
}: AmpProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hexId = useId();
  const stemId = useId();
  const ballId = useId();
  const { isDownloading, download } = useDownload(downloadHref, `${name}.wav`);
  const seekDrag = useSeekDrag(duration, onSeek);
  useStemWaveform(containerRef, name, buffer, downloadHref, "#1e3a26", "#4ade80", 38, onWaveSurferReady);

  return (
    <div
      className="relative rounded-lg border p-[10px_10px_16px] shadow-[0_10px_24px_rgba(0,0,0,0.6)]"
      style={{ width: AMP_WIDTH, backgroundColor: "#141414", backgroundImage: "repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 5px)", borderColor: "#2a2a2a" }}
    >
      <div className="absolute -top-2 left-1/2 h-[13px] w-[110px] -translate-x-1/2 rounded-md shadow-[inset_0_2px_3px_rgba(0,0,0,0.7)]" style={{ backgroundColor: "#1c1c1c" }} />
      <div className="absolute -top-2 left-[calc(50%-68px)] h-[15px] w-4 rounded-sm" style={{ backgroundColor: "#111" }} />
      <div className="absolute -top-2 left-[calc(50%+52px)] h-[15px] w-4 rounded-sm" style={{ backgroundColor: "#111" }} />

      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      <div
        className="flex items-center gap-3 rounded-md px-4.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_0_1px_#9a9aa0,0_2px_4px_rgba(0,0,0,0.4)]"
        style={{ background: "linear-gradient(100deg, #f5f5f7 0%, #d4d4d8 20%, #f8f8fa 40%, #b6b6ba 55%, #eaeaec 72%, #c4c4c8 100%)" }}
      >
        <ScallopedKnob value={volume} onChange={onVolumeChange} size={48} label="0    10" ring />
        <ScallopedKnob value={0.3} onChange={() => {}} size={30} label="Tone" disabled />

        <div className="flex flex-col gap-1.5">
          <button onClick={onToggleMute} className="flex items-center gap-1" title="Mute">
            <div
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
              style={{ background: "radial-gradient(circle at 35% 30%, #d4d4d8, #8a8a8e 70%)", boxShadow: muted ? "inset 0 0 0 1.5px #ef4444" : "inset 0 0 0 1.5px #6a6a6e" }}
            >
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: muted ? "#ef4444" : "#3a3a3e" }} />
            </div>
            <span className="font-['Oswald'] text-[7px] text-[#3a3a3e]">M</span>
          </button>
          <button onClick={onToggleSolo} className="flex items-center gap-1" title="Solo">
            <div
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
              style={{ background: "radial-gradient(circle at 35% 30%, #d4d4d8, #8a8a8e 70%)", boxShadow: "inset 0 0 0 1.5px #6a6a6e" }}
            >
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: isSoloed ? "radial-gradient(circle, #fde68a, #eab308 70%)" : "#3a3a3e", boxShadow: isSoloed ? "0 0 4px #eab308" : "none" }}
              />
            </div>
            <span className="font-['Oswald'] text-[7px] text-[#3a3a3e]">S</span>
          </button>
        </div>

        <div className="h-[38px] min-w-0 flex-1 rounded p-[2.5px] shadow-[0_1px_2px_rgba(0,0,0,0.3)]" style={{ background: "linear-gradient(180deg,#c4c4c8,#8a8a8e)" }}>
          <div
            ref={containerRef}
            className="h-full w-full select-none cursor-pointer touch-none rounded-sm px-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"
            style={{ backgroundColor: "#0d0d0d" }}
            {...seekDrag}
          />
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <DownloadLed active={isDownloading} idleColor="#16a34a" idleGlow="#86efac" size={6} />
          <button
            onClick={() => void download()}
            title={`Download ${name}`}
            className="flex flex-col items-center gap-0.5"
          >
            <svg viewBox="0 0 24 32" width="20" height="26">
              <polygon points="12,17 18.5,20.5 18.5,27.5 12,31 5.5,27.5 5.5,20.5" fill={`url(#${hexId})`} stroke="#5a5a5e" strokeWidth={0.5} />
              <rect x="10.7" y="9" width="2.6" height="11" rx="1.3" fill={`url(#${stemId})`} />
              <circle cx="12" cy="8" r="4" fill={`url(#${ballId})`} stroke="#6a6a6e" strokeWidth={0.5} />
              <defs>
                <radialGradient id={hexId} cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="#e8e8ec" />
                  <stop offset="55%" stopColor="#b6b6ba" />
                  <stop offset="100%" stopColor="#8a8a8e" />
                </radialGradient>
                <linearGradient id={stemId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#8a8a8e" />
                  <stop offset="50%" stopColor="#e8e8ec" />
                  <stop offset="100%" stopColor="#8a8a8e" />
                </linearGradient>
                <radialGradient id={ballId} cx="35%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#f5f5f7" />
                  <stop offset="60%" stopColor="#c4c4c8" />
                  <stop offset="100%" stopColor="#8a8a8e" />
                </radialGradient>
              </defs>
            </svg>
            <span className="font-['Oswald'] text-[6px] text-[#3a3a3e]">Save</span>
          </button>
        </div>
      </div>

      <div className="mt-2.5 rounded-md border-[1.5px] p-[3px]" style={{ borderColor: "#d8d8dc" }}>
        <div
          className="relative h-[114px] rounded shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]"
          style={{
            backgroundColor: "#161616",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 1.5px, transparent 1.5px 4px)," +
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0 1.5px, transparent 1.5px 4px)",
          }}
        >
          <span
            className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 text-[24px]"
            style={{
              fontFamily: "'Rock Salt',cursive",
              background: "linear-gradient(180deg, #fff 0%, #c9c9cd 45%, #7a7a80 55%, #e8e8ec 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.4)) drop-shadow(0 2px 2px rgba(0,0,0,0.7))",
            }}
          >
            Bass
          </span>
        </div>
      </div>
    </div>
  );
}
