import { useRef } from "react";
import { DownloadLed } from "../DownloadLed";
import { Knob } from "../Knob";
import type { AmpProps } from "../types";
import { useDownload } from "../useDownload";
import { useSeekDrag } from "../useSeekDrag";
import { useStemWaveform } from "../useStemWaveform";
import { AMP_MOBILE_WIDTH, AMP_WIDTH } from "../constants";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="14" height="14">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M7.5 10.5 12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

export function OtherAmp({
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
  controlsOnly = false,
}: AmpProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDownloading, download } = useDownload(downloadHref, `${name}.wav`);
  const seekDrag = useSeekDrag(duration, onSeek);
  useStemWaveform(containerRef, name, buffer, downloadHref, "#4a4a4e", "#d4d4d8", 28, onWaveSurferReady);

  return (
    <div
      className="rounded-md border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-2px_4px_rgba(0,0,0,0.3),0_6px_14px_rgba(0,0,0,0.5)]"
      style={{ width: controlsOnly ? AMP_MOBILE_WIDTH : AMP_WIDTH, background: "linear-gradient(180deg,#5a5a5e 0%, #45454a 50%, #3a3a3e 100%)", borderColor: "#2a2a2e" }}
    >
      <div className="flex items-center gap-3.5 pb-3">
        <Knob value={volume} onChange={onVolumeChange} size={40} label="Vol" labelColor="#c4c4c8" stops={["#8a8a8e", "#5a5a5e", "#3a3a3e"]} pointerColor="#2a2a2e" ring />

        <div className="flex gap-1.5">
          <button
            onClick={onToggleMute}
            className="rounded text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.4)]"
            style={{ padding: "3px 8px", background: muted ? "linear-gradient(180deg,#7a2320,#3a0f0d)" : "linear-gradient(180deg,#3a3a3e,#1a1a1e)", color: muted ? "#fecaca" : "#9a9a9e" }}
          >
            M
          </button>
          <button
            onClick={onToggleSolo}
            className="rounded text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.4)]"
            style={{ padding: "3px 8px", background: isSoloed ? "linear-gradient(180deg,#facc15,#a16207)" : "linear-gradient(180deg,#3a3a3e,#1a1a1e)", color: isSoloed ? "#1a1200" : "#9a9a9e" }}
          >
            S
          </button>
        </div>

        <div className="h-8 min-w-0 flex-1 rounded p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.3)]" style={{ background: "linear-gradient(180deg,#3a3a3e,#5a5a5e)" }}>
          <div className="h-full rounded-sm shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]" style={{ backgroundColor: "#0d0d0d" }}>
            <div ref={containerRef} className="h-full w-full select-none cursor-pointer touch-none px-2" {...seekDrag} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <DownloadLed active={isDownloading} idleColor="#94a3b8" idleGlow="#e2e8f0" size={6} />
          <button
            onClick={() => void download()}
            title={`Download ${name}`}
            className="flex h-[26px] w-[26px] items-center justify-center rounded text-[#9a9a9e] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.4)]"
            style={{ background: "linear-gradient(180deg,#3a3a3e,#1a1a1e)" }}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>

      {!controlsOnly && (
        <div className="rounded-md p-[3px] shadow-[0_2px_5px_rgba(0,0,0,0.35)]" style={{ background: "linear-gradient(180deg,#6a6a6e,#3a3a3e)" }}>
          <div
            className="relative h-20 rounded-sm shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]"
            style={{ backgroundColor: "#3a3a3e", backgroundImage: "radial-gradient(#2a2a2e 40%, transparent 42%)", backgroundSize: "10px 10px" }}
          >
            <div
              className="absolute bottom-2.5 left-2.5 rounded border px-2.5 py-1"
              style={{ backgroundColor: "#141414", borderColor: "#6a6a6e", boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
            >
              <span className="font-['Oswald'] text-[10px] font-medium uppercase tracking-wide text-[#a4a4a8]">Aux / Other</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
