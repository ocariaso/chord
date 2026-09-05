import { formatTime } from "../utils/time";

interface TransportBarProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

function MetronomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M12 3l7 17H5z" strokeLinejoin="round" />
      <path d="M12 7l3 10" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0">
      <path d="M4 9v6h4l5 5V4L8 9H4z" strokeLinejoin="round" />
      <path d="M16 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
    </svg>
  );
}

export function TransportBar({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onSeek,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
}: TransportBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-neutral-900 p-3">
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
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
          className="min-w-24 flex-1 accent-purple-500"
        />
        <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-400">{formatTime(duration)}</span>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="flex items-center gap-2 text-neutral-400" title="Master volume">
          <SpeakerIcon />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => onMasterVolumeChange(Number(e.target.value))}
            className="w-20 accent-purple-500"
          />
        </div>

        {onToggleMetronome && (
          <button
            onClick={onToggleMetronome}
            title="Toggle metronome"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
              metronomeEnabled ? "bg-purple-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            <MetronomeIcon />
          </button>
        )}
      </div>
    </div>
  );
}
