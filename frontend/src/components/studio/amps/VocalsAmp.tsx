import { useRef } from "react";
import { DownloadLed } from "../DownloadLed";
import { Knob } from "../Knob";
import type { AmpProps } from "../types";
import { useDownload } from "../useDownload";
import { useSeekDrag } from "../useSeekDrag";
import { useStemWaveform } from "../useStemWaveform";
import { AMP_WIDTH } from "../constants";

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" className="shrink-0">
      <rect x="9" y="2" width="6" height="11" rx="3" fill="none" stroke="#3a2f22" strokeWidth={1.4} />
      <path d="M5 10a7 7 0 0 0 14 0" fill="none" stroke="#3a2f22" strokeWidth={1.4} strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="21" stroke="#3a2f22" strokeWidth={1.4} strokeLinecap="round" />
      <line x1="8" y1="21" x2="16" y2="21" stroke="#3a2f22" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon({ color = "#a4967c" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} width="15" height="15">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M7.5 10.5 12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

export function VocalsAmp({
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
  useStemWaveform(containerRef, name, buffer, downloadHref, "#5a4c34", "#e0a634", 34, onWaveSurferReady);

  return (
    <div
      className="relative rounded-lg p-2.5 pb-4 shadow-[0_10px_24px_rgba(0,0,0,0.6)]"
      style={{
        width: AMP_WIDTH,
        backgroundColor: "#a8825f",
        backgroundImage: "repeating-linear-gradient(115deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 5px)",
      }}
    >
      <div
        className="absolute -top-2.5 left-1/2 h-4 w-[120px] -translate-x-1/2 rounded-lg shadow-[inset_0_2px_3px_rgba(0,0,0,0.6)]"
        style={{ backgroundColor: "#1a1512" }}
      />
      <div className="absolute -top-2.5 left-[calc(50%-74px)] h-4 w-3.5 rounded shadow-[0_1px_2px_rgba(0,0,0,0.4)]" style={{ backgroundColor: "#c9c9cd" }} />
      <div className="absolute -top-2.5 left-[calc(50%+60px)] h-4 w-3.5 rounded shadow-[0_1px_2px_rgba(0,0,0,0.4)]" style={{ backgroundColor: "#c9c9cd" }} />

      <div
        className="flex items-center gap-3.5 rounded-md px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.3)]"
        style={{ background: "linear-gradient(180deg,#d8c8a8,#c7b28c)" }}
      >
        <MicIcon />
        <div className="flex gap-1.5">
          <button
            onClick={onToggleMute}
            className="rounded font-['Oswald'] text-[10px] font-bold"
            style={{
              padding: "3px 8px",
              background: muted ? "#7a2320" : "#2a2318",
              color: muted ? "#fecaca" : "#a4967c",
            }}
          >
            M
          </button>
          <button
            onClick={onToggleSolo}
            className="rounded font-['Oswald'] text-[10px] font-bold"
            style={{
              padding: "3px 8px",
              background: isSoloed ? "linear-gradient(180deg,#facc15,#a16207)" : "#2a2318",
              color: isSoloed ? "#3a2600" : "#a4967c",
            }}
          >
            S
          </button>
        </div>

        <div
          className="h-[34px] min-w-0 flex-1 rounded-sm shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]"
          style={{ backgroundColor: "#3a2f22" }}
        >
          <div ref={containerRef} className="h-full w-full select-none cursor-pointer touch-none px-2" {...seekDrag} />
        </div>

        <Knob
          value={volume}
          onChange={onVolumeChange}
          size={44}
          label="Volume"
          labelColor="#3a2f22"
          stops={["#c9c9cd", "#9a9aa0", "#6a6a70"]}
          pointerColor="#fff"
          ring
        />

        <div className="flex flex-col items-center gap-1">
          <DownloadLed active={isDownloading} idleColor="#14b8a6" idleGlow="#5eead4" size={6} />
          <button
            onClick={() => void download()}
            title={`Download ${name}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
            style={{ backgroundColor: "#2a2318" }}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>

      <div
        className="mt-2 flex items-center justify-center rounded px-3 py-2.5 shadow-[inset_0_2px_5px_rgba(0,0,0,0.7),0_0_0_2px_#1a1512]"
        style={{ backgroundColor: "#0a1410" }}
      >
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap text-center text-[13px]"
          style={{ fontFamily: "'Share Tech Mono','Courier New',monospace", color: "#5eead4", textShadow: "0 0 4px rgba(94,234,212,0.5)" }}
        >
          ♪ Live lyrics (upcoming feature) ♪
        </span>
      </div>

      <div
        className="relative mt-2.5 h-[120px] rounded shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]"
        style={{
          backgroundColor: "#0d0d0d",
          backgroundImage: "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.06) 1px, transparent 1.2px)",
          backgroundSize: "6px 6px",
        }}
      >
        <span
          className="absolute left-4 top-3.5 -rotate-6 text-[34px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
          style={{ fontFamily: "'Dancing Script',cursive", color: "#e8dcc4" }}
        >
          Vocals
        </span>
        <div
          className="absolute bottom-1.5 left-1.5 h-4 w-4 rounded-sm"
          style={{ background: "linear-gradient(135deg,#e2e2e4,#8a8a8e)", clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
        />
        <div
          className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-sm"
          style={{ background: "linear-gradient(225deg,#e2e2e4,#8a8a8e)", clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
        />
      </div>
    </div>
  );
}
