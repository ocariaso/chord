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
    <svg viewBox="0 0 24 24" fill="none" stroke="#2a2a2e" strokeWidth={2} width="12" height="12">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M7.5 10.5 12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

export function DrumsAmp({
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
  useStemWaveform(containerRef, name, buffer, downloadHref, "#1e3a26", "#4ade80", 26, onWaveSurferReady);

  const woodStyle = {
    background: "linear-gradient(90deg, #7a2f1e 0%, #5e2216 12%, #8f3a24 28%, #5e2216 44%, #7a2f1e 60%, #8f3a24 76%, #5e2216 90%, #7a2f1e 100%)",
  };
  const width = controlsOnly ? AMP_MOBILE_WIDTH : AMP_WIDTH;

  return (
    <div className="flex flex-col items-center">
      <div
        className="flex items-center justify-center gap-4 rounded-t-md px-5 py-2.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]"
        style={{ width, backgroundColor: "#1c1c1c" }}
      >
        <Knob value={volume} onChange={onVolumeChange} size={40} label="Vol" labelColor="#9a9a9e" stops={["#f0f0f2", "#b6b6ba", "#7a7a7e"]} pointerColor="#1a1a1a" ring />
        <Knob value={0.25} onChange={() => {}} size={20} label="Tone" labelColor="#9a9a9e" stops={["#f0f0f2", "#b6b6ba", "#7a7a7e"]} pointerColor="#1a1a1a" disabled />

        <button onClick={onToggleMute} className="flex flex-col items-center gap-0.5" title="Mute">
          <div
            className="h-5 w-5 rounded-full"
            style={{
              background: muted ? "radial-gradient(circle, #fca5a5, #dc2626 70%)" : "radial-gradient(circle, #e2e2e4, #6a6a6e 70%)",
              boxShadow: muted ? "0 0 5px #dc2626" : "none",
            }}
          />
          <span className="font-['Oswald'] text-[6px] text-[#9a9a9e]">M</span>
        </button>

        <button onClick={onToggleSolo} className="flex flex-col items-center gap-0.5" title="Solo">
          <div
            className="h-5 w-5 rounded-full"
            style={{
              background: isSoloed ? "radial-gradient(circle, #fde68a, #eab308 70%)" : "radial-gradient(circle, #e2e2e4, #6a6a6e 70%)",
              boxShadow: isSoloed ? "0 0 5px #eab308" : "none",
            }}
          />
          <span className="font-['Oswald'] text-[6px] text-[#9a9a9e]">S</span>
        </button>

        <div className="flex flex-col items-center gap-0.5">
          <div className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute -left-2.5 top-1/2 -translate-y-1/2">
              <DownloadLed active={isDownloading} idleColor="#3b82f6" idleGlow="#bfdbfe" size={6} />
            </span>
            <button
              onClick={() => void download()}
              title={`Download ${name}`}
              className="flex h-5 w-5 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
              style={{ background: "radial-gradient(circle at 35% 30%, #e2e2e4, #6a6a6e 70%)" }}
            >
              <DownloadIcon />
            </button>
          </div>
          <span className="font-['Oswald'] text-[6px] text-[#9a9a9e]">Save</span>
        </div>
      </div>

      <div style={{ width, ...woodStyle }} className="flex justify-center px-5 py-2">
        <div className="flex h-[26px] w-full items-center rounded shadow-[inset_0_2px_4px_rgba(0,0,0,0.7)]" style={{ backgroundColor: "#0a0a0a" }}>
          <div ref={containerRef} className="h-full w-full select-none cursor-pointer touch-none px-2" {...seekDrag} />
        </div>
      </div>

      {!controlsOnly && (
        <div className="rounded-b-lg p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.5)]" style={{ width: AMP_WIDTH, ...woodStyle }}>
          <div
            className="relative h-[120px] rounded shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]"
            style={{ backgroundColor: "#0a0a0a", backgroundImage: "radial-gradient(circle, #1e1e1e 40%, transparent 42%)", backgroundSize: "10px 10px", backgroundPosition: "0 0, 5px 5px" }}
          >
            <div className="absolute left-1/2 top-3.5 -translate-x-1/2 rounded-lg border-2 px-3.5 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.3)]" style={{ backgroundColor: "#141414", borderColor: "#f0f0f0" }}>
              <span className="font-['Oswald'] text-[16px] font-bold text-white">Drums</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
