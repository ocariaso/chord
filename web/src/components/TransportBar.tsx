import { formatTime } from "../utils/time";

interface TransportBarProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  accentColor: string;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path d="M7 4.5v15l14-7.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <rect x="6" y="4" width="4.5" height="16" rx="1" fill="currentColor" />
      <rect x="13.5" y="4" width="4.5" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

export function TransportBar({ isPlaying, currentTime, duration, onPlayPause, onSeek, accentColor }: TransportBarProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPlayPause}
        style={{ backgroundColor: accentColor }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white hover:opacity-90"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-400">{formatTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration)}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ accentColor }}
        className="min-w-24 flex-1"
      />
      <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-400">{formatTime(duration)}</span>
    </div>
  );
}
