import { useRef } from "react";
import { DownloadLed } from "../DownloadLed";
import { Knob } from "../Knob";
import type { AmpProps } from "../types";
import { useDownload } from "../useDownload";
import { useSeekDrag } from "../useSeekDrag";
import { useStemWaveform } from "../useStemWaveform";
import { AMP_MOBILE_WIDTH, AMP_WIDTH } from "../constants";

export function PianoAmp({
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
  useStemWaveform(containerRef, name, buffer, downloadHref, "#1e3a5a", "#3b82f6", 32, onWaveSurferReady);

  const woodStyle: React.CSSProperties = {
    width: 16,
    flexShrink: 0,
    background: "linear-gradient(90deg, #b5895a 0%, #a67c4e 15%, #c69a6c 30%, #a67c4e 45%, #b5895a 60%, #c69a6c 75%, #a67c4e 90%, #b5895a 100%)",
  };

  return (
    <div className="flex overflow-hidden rounded-lg shadow-[0_10px_24px_rgba(0,0,0,0.5)]" style={{ width: controlsOnly ? AMP_MOBILE_WIDTH : AMP_WIDTH }}>
      <div style={woodStyle} />

      <div className="relative flex flex-1 flex-col" style={{ backgroundColor: "#e2e2e4" }}>
        <div className="flex justify-center pb-1 pt-2">
          <div className="h-3 w-[140px] rounded-md shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.2)]" style={{ background: "linear-gradient(180deg,#fff,#c9c9cd)" }} />
        </div>

        <div className="flex items-center gap-3 px-4 pb-3.5 pt-2">
          <Knob value={volume} onChange={onVolumeChange} size={42} label="Volume" labelColor="#4a4a4e" stops={["#fff", "#d4d4d8", "#9a9a9e"]} pointerColor="#3a3a3e" ring />
          <Knob value={0.4} onChange={() => {}} size={20} label="EQ" labelColor="#4a4a4e" stops={["#fff", "#d4d4d8", "#9a9a9e"]} pointerColor="#3a3a3e" disabled />

          <div className="self-stretch w-px" style={{ backgroundColor: "#c4c4c8" }} />

          <div className="flex gap-2">
            <button onClick={onToggleMute} className="flex flex-col items-center gap-0.5" title="Mute">
              <div
                className="h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: "#fff", boxShadow: muted ? "inset 0 0 0 1.5px #ef4444, 0 1px 1px rgba(0,0,0,0.15)" : "inset 0 0 0 1.5px #a4a4a8, 0 1px 1px rgba(0,0,0,0.15)" }}
              />
              <span className="font-['Oswald'] text-[6px] text-[#4a4a4e]">M</span>
            </button>
            <button onClick={onToggleSolo} className="flex flex-col items-center gap-0.5" title="Solo">
              <div
                className="h-3.5 w-3.5 rounded-full"
                style={{
                  background: isSoloed ? "radial-gradient(circle, #fde68a, #eab308 70%)" : "#fff",
                  boxShadow: isSoloed ? "0 0 4px #eab308" : "inset 0 0 0 1.5px #a4a4a8, 0 1px 1px rgba(0,0,0,0.15)",
                }}
              />
              <span className="font-['Oswald'] text-[6px] text-[#4a4a4e]">S</span>
            </button>
          </div>

          <div className="flex h-8 min-w-0 flex-1 items-center rounded shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]" style={{ backgroundColor: "#1a1a1a" }}>
            <div ref={containerRef} className="h-full w-full select-none cursor-pointer touch-none px-2" {...seekDrag} />
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <DownloadLed active={isDownloading} idleColor="#3b82f6" idleGlow="#bfdbfe" size={6} />
            <button
              onClick={() => void download()}
              title={`Download ${name}`}
              className="rounded p-0.5"
              style={{ background: "linear-gradient(180deg,#fff,#c9c9cd)" }}
            >
              <div className="h-3 w-[18px] rounded-sm shadow-[inset_0_0_0_1px_#9a9a9e]" style={{ background: "linear-gradient(180deg,#e2e2e4 48%, #b6b6ba 52%)" }} />
            </button>
            <span className="font-['Oswald'] text-[6px] text-[#4a4a4e]">Save</span>
          </div>
        </div>

        {!controlsOnly && (
          <div
            className="relative mx-2.5 mb-2.5 flex-1 rounded shadow-[inset_0_2px_6px_rgba(0,0,0,0.15)]"
            style={{
              minHeight: 110,
              backgroundColor: "#e8e8ea",
              backgroundImage:
                "radial-gradient(#1a1a1a 46%, transparent 48%)," +
                "radial-gradient(circle 48px at 175px 55px, rgba(110,110,114,0.65) 0%, rgba(110,110,114,0.65) 55%, transparent 100%)," +
                "radial-gradient(circle 30px at 375px 78px, rgba(110,110,114,0.6) 0%, rgba(110,110,114,0.6) 55%, transparent 100%)",
              backgroundSize: "9px 15px, auto, auto",
              backgroundRepeat: "repeat, no-repeat, no-repeat",
            }}
          >
            <div className="absolute left-3.5 top-3 rounded-md border-2 px-3 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.3)]" style={{ backgroundColor: "#141414", borderColor: "#f0f0f0" }}>
              <span className="font-['Oswald'] text-[13px] font-bold text-white">Piano</span>
            </div>
          </div>
        )}
      </div>

      <div style={woodStyle} />
    </div>
  );
}
