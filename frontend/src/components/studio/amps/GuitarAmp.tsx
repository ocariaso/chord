import { useRef } from "react";
import { DownloadLed } from "../DownloadLed";
import { Knob } from "../Knob";
import type { AmpProps } from "../types";
import { useDownload } from "../useDownload";
import { useSeekDrag } from "../useSeekDrag";
import { useStemWaveform } from "../useStemWaveform";
import { AMP_WIDTH } from "../constants";

export function GuitarAmp({
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
  const { isDownloading, download } = useDownload(downloadHref, `${name}.wav`);
  const seekDrag = useSeekDrag(duration, onSeek);
  useStemWaveform(containerRef, name, buffer, downloadHref, "#1e3a26", "#4ade80", 36, onWaveSurferReady);

  return (
    <div
      className="relative rounded-lg border p-[9px] shadow-[0_10px_24px_rgba(0,0,0,0.6)]"
      style={{
        width: AMP_WIDTH,
        backgroundColor: "#131313",
        backgroundImage: "repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 5px)",
        borderColor: "#050505",
      }}
    >
      <div className="absolute -top-2 left-1/2 h-3.5 w-[110px] -translate-x-1/2 rounded-md shadow-[inset_0_2px_3px_rgba(0,0,0,0.7)]" style={{ backgroundColor: "#0d0d0d" }} />
      <div className="absolute -top-2 left-[calc(50%-68px)] h-[15px] w-4 rounded-sm" style={{ backgroundColor: "#c9c9cd" }} />
      <div className="absolute -top-2 left-[calc(50%+52px)] h-[15px] w-4 rounded-sm" style={{ backgroundColor: "#c9c9cd" }} />

      <div className="absolute left-0 top-0 h-[5px] w-[22px] rounded-tl" style={{ background: "linear-gradient(90deg,#e8e8ec,#8a8a8e)" }} />
      <div className="absolute left-0 top-0 h-[22px] w-[5px] rounded-tl" style={{ background: "linear-gradient(180deg,#e8e8ec,#8a8a8e)" }} />
      <div className="absolute right-0 top-0 h-[5px] w-[22px] rounded-tr" style={{ background: "linear-gradient(270deg,#e8e8ec,#8a8a8e)" }} />
      <div className="absolute right-0 top-0 h-[22px] w-[5px] rounded-tr" style={{ background: "linear-gradient(180deg,#e8e8ec,#8a8a8e)" }} />

      <div
        className="flex items-center gap-3.5 rounded-md px-4.5 py-2.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.4)]"
        style={{ backgroundColor: "#3a3a3e" }}
      >
        <Knob value={volume} onChange={onVolumeChange} size={42} label="Volume" stops={["#f0f0f2", "#b6b6ba", "#7a7a7e"]} pointerColor="#e5e5e5" ribbed ring />
        <Knob value={0.35} onChange={() => {}} size={20} label="Tone" stops={["#f0f0f2", "#b6b6ba", "#7a7a7e"]} pointerColor="#e5e5e5" ribbed disabled />

        <div
          className="h-9 min-w-0 flex-1 rounded shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"
          style={{ backgroundColor: "#000" }}
        >
          <div ref={containerRef} className="h-full w-full cursor-pointer touch-none px-2" {...seekDrag} />
        </div>

        <div className="flex flex-col gap-1.5">
          <button onClick={onToggleMute} className="flex items-center gap-1" title="Mute">
            <div
              className="h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: "#1a1a1a", boxShadow: muted ? "inset 0 0 0 1.5px #ef4444, 0 0 4px #ef4444" : "inset 0 0 0 1.5px #4a4a4e" }}
            />
            <span className="font-['Oswald'] text-[7px] text-[#8a8a8e]">M</span>
          </button>
          <button onClick={onToggleSolo} className="flex items-center gap-1" title="Solo">
            <div
              className="h-3.5 w-3.5 rounded-full"
              style={{
                background: isSoloed ? "radial-gradient(circle, #fde68a, #eab308 70%)" : "#1a1a1a",
                boxShadow: isSoloed ? "0 0 4px #eab308" : "inset 0 0 0 1.5px #4a4a4e",
              }}
            />
            <span className="font-['Oswald'] text-[7px] text-[#8a8a8e]">S</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <DownloadLed active={isDownloading} idleColor="#dc2626" idleGlow="#fca5a5" size={8} />
          <button
            onClick={() => void download()}
            title={`Download ${name}`}
            className="flex rounded p-0.5"
            style={{ background: "linear-gradient(180deg,#c4c4c8,#8a8a8e)" }}
          >
            <div className="h-3.5 w-5 rounded-sm shadow-[inset_0_0_0_1px_#0a0a0a]" style={{ background: "linear-gradient(180deg,#2a2a2e 48%, #141416 52%)" }} />
          </button>
          <span className="font-['Oswald'] text-[6px] text-[#8a8a8e]">Save</span>
        </div>
      </div>

      <div className="flex justify-center px-0 pb-2 pt-3">
        <div className="relative rounded-md border-[1.5px] px-4 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.5)]" style={{ backgroundColor: "#0a0a0a", borderColor: "#c4c4c8" }}>
          <div className="absolute left-0.5 top-0.5 h-[3px] w-[3px] rounded-full" style={{ backgroundColor: "#8a8a8e" }} />
          <div className="absolute right-0.5 top-0.5 h-[3px] w-[3px] rounded-full" style={{ backgroundColor: "#8a8a8e" }} />
          <div className="absolute bottom-0.5 left-0.5 h-[3px] w-[3px] rounded-full" style={{ backgroundColor: "#8a8a8e" }} />
          <div className="absolute bottom-0.5 right-0.5 h-[3px] w-[3px] rounded-full" style={{ backgroundColor: "#8a8a8e" }} />
          <span
            className="text-[20px]"
            style={{
              fontFamily: "'Dancing Script',cursive",
              background: "linear-gradient(180deg, #fff 0%, #c9c9cd 45%, #6a6a70 55%, #e8e8ec 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Guitar
          </span>
        </div>
      </div>

      <div
        className="relative h-[110px] rounded shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]"
        style={{
          backgroundColor: "#8a8a8e",
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.5) 0.6px, transparent 1px)," +
            "radial-gradient(circle at 60% 70%, rgba(0,0,0,0.35) 0.6px, transparent 1px)," +
            "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.4) 0.6px, transparent 1px)," +
            "radial-gradient(circle at 35% 80%, rgba(0,0,0,0.3) 0.6px, transparent 1px)," +
            "radial-gradient(circle at 90% 55%, rgba(255,255,255,0.4) 0.6px, transparent 1px)",
          backgroundSize: "6px 6px, 7px 7px, 5px 5px, 8px 8px, 6.5px 6.5px",
        }}
      >
        <div className="absolute bottom-2 right-2.5 rounded-md border-[1.5px] px-2.5 py-0.5" style={{ backgroundColor: "#0a0a0a", borderColor: "#e5e5e5" }}>
          <span className="text-[15px]" style={{ fontFamily: "'Dancing Script',cursive", color: "#f0f0f0" }}>
            Six Strings
          </span>
        </div>
      </div>
    </div>
  );
}
