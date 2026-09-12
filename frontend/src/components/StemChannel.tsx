import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useSeekDrag } from "./studio/useSeekDrag";
import { downloadFile } from "../utils/download";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M7.5 10.5 12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

interface StemChannelProps {
  name: string;
  buffer: AudioBuffer;
  muted: boolean;
  isSoloed: boolean;
  volume: number;
  downloadHref: string;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onVolumeChange: (volume: number) => void;
  onWaveSurferReady: (name: string, instance: WaveSurfer) => void;
  accentColor: string;
  secondaryColor: string;
  cardBg: string;
  cardBorder: string;
  duration: number;
  onSeek: (seconds: number) => void;
}

export function StemChannel({
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
  accentColor,
  secondaryColor,
  cardBg,
  cardBorder,
  duration,
  onSeek,
}: StemChannelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const seekDrag = useSeekDrag(duration, onSeek);

  async function handleDownload() {
    setIsDownloading(true);
    try {
      await downloadFile(downloadHref, `${name}.wav`);
    } catch {
      // The download simply won't start; nothing else to recover here.
    } finally {
      setIsDownloading(false);
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;

    // This instance only renders the waveform; PlaybackEngine owns playback. A real media
    // element (loaded from the same stem URL) gives WaveSurfer a genuine duration to compute
    // cursor/progress position from; `peaks` still skips re-decoding for the waveform itself.
    const instance = WaveSurfer.create({
      container: containerRef.current,
      height: 56,
      waveColor: "#525252",
      progressColor: accentColor,
      cursorColor: "#e5e5e5",
      cursorWidth: 1,
      interact: false,
      url: downloadHref,
      peaks: [buffer.getChannelData(0)],
      duration: buffer.duration,
    });
    waveSurferRef.current = instance;
    onWaveSurferReady(name, instance);

    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  // The accent color resolves asynchronously (sampled from the thumbnail after it loads), so keep
  // the already-created instance's progress color in sync instead of only setting it at creation.
  useEffect(() => {
    waveSurferRef.current?.setOptions({ progressColor: accentColor });
  }, [accentColor]);

  return (
    <div className="flex items-center gap-3 rounded-md p-3" style={{ backgroundColor: cardBg, boxShadow: `inset 0 0 0 1px ${cardBorder}` }}>
      <div className="flex w-24 shrink-0 flex-col gap-1">
        <span className="truncate text-sm font-medium capitalize text-neutral-200">{name}</span>
        <div className="flex gap-1">
          <button
            onClick={onToggleMute}
            style={!muted ? { boxShadow: `inset 0 0 0 1px ${cardBorder}` } : undefined}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              muted ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            M
          </button>
          <button
            onClick={onToggleSolo}
            style={isSoloed ? { backgroundColor: secondaryColor } : { boxShadow: `inset 0 0 0 1px ${cardBorder}` }}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              isSoloed ? "text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            S
          </button>
        </div>
      </div>

      <div ref={containerRef} className="min-w-0 flex-1 cursor-pointer touch-none select-none" {...seekDrag} />

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        style={{ accentColor }}
        className="w-20 shrink-0"
      />

      <button
        onClick={handleDownload}
        disabled={isDownloading}
        title={`Download ${name}`}
        className="flex shrink-0 items-center justify-center rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:hover:bg-transparent"
      >
        {isDownloading ? (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-[1.5px] border-neutral-500 border-t-transparent" />
        ) : (
          <DownloadIcon />
        )}
      </button>
    </div>
  );
}
