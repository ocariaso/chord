import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

interface StemChannelProps {
  name: string;
  buffer: AudioBuffer;
  muted: boolean;
  isSoloed: boolean;
  volume: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onVolumeChange: (volume: number) => void;
  onWaveSurferReady: (name: string, instance: WaveSurfer) => void;
}

export function StemChannel({
  name,
  buffer,
  muted,
  isSoloed,
  volume,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onWaveSurferReady,
}: StemChannelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // This instance only renders the waveform; PlaybackEngine owns playback.
    const instance = WaveSurfer.create({
      container: containerRef.current,
      height: 56,
      waveColor: "#525252",
      progressColor: "#a855f7",
      cursorColor: "#e5e5e5",
      cursorWidth: 1,
      interact: false,
      peaks: [buffer.getChannelData(0)],
      duration: buffer.duration,
    });
    onWaveSurferReady(name, instance);

    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  return (
    <div className="flex items-center gap-3 rounded-md bg-neutral-900 p-3">
      <div className="flex w-24 shrink-0 flex-col gap-1">
        <span className="truncate text-sm font-medium capitalize text-neutral-200">{name}</span>
        <div className="flex gap-1">
          <button
            onClick={onToggleMute}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              muted ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            M
          </button>
          <button
            onClick={onToggleSolo}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              isSoloed ? "bg-yellow-500 text-black" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            S
          </button>
        </div>
      </div>

      <div ref={containerRef} className="min-w-0 flex-1" />

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        className="w-20 shrink-0 accent-purple-500"
      />
    </div>
  );
}
