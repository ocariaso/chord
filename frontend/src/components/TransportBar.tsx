interface TransportBarProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function TransportBar({ isPlaying, currentTime, duration, onPlayPause, onSeek }: TransportBarProps) {
  return (
    <div className="flex items-center gap-4 rounded-md bg-neutral-900 p-3">
      <button
        onClick={onPlayPause}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white hover:bg-purple-500"
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-400">{formatTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="flex-1 accent-purple-500"
      />
      <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-400">{formatTime(duration)}</span>
    </div>
  );
}
