import { useEffect, useRef } from "react";
import type WaveSurfer from "wavesurfer.js";
import { formatTime } from "../../utils/time";
import { AMP_COMPONENTS } from "./ampComponents";
import { OtherAmp } from "./amps/OtherAmp";
import type { AmpProps } from "./types";
import { ZoomOverlay } from "./ZoomOverlay";

interface AmpCloseupProps extends Omit<AmpProps, "onWaveSurferReady"> {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  originRect: DOMRect;
  onClose: () => void;
}

/** A closer look at one amp's real controls — the exact same component as in the grid, just isolated. */
export function AmpCloseup({ isPlaying, onPlayPause, currentTime, originRect, onClose, ...ampProps }: AmpCloseupProps) {
  const Amp = AMP_COMPONENTS[ampProps.name] ?? OtherAmp;
  const waveSurferRef = useRef<WaveSurfer | null>(null);

  // The closeup's own WaveSurfer instance isn't part of the shared tick loop that keeps the
  // grid's amps in sync, so drive its playhead directly off the currentTime prop instead.
  useEffect(() => {
    waveSurferRef.current?.setTime(currentTime);
  }, [currentTime]);

  return (
    <ZoomOverlay originRect={originRect} onClose={onClose}>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2.5 rounded-full bg-black/40 px-3 py-1.5">
          <button
            onClick={onPlayPause}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_#6a6a6e]"
            style={{ background: "radial-gradient(circle at 35% 28%, #f0f0f2, #9a9a9e 70%)" }}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="9" height="9">
                <rect x="6" y="4" width="4.5" height="16" rx="1" fill="#161616" />
                <rect x="13.5" y="4" width="4.5" height="16" rx="1" fill="#161616" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="9" height="9">
                <path d="M7 4.5v15l14-7.5z" fill="#161616" />
              </svg>
            )}
          </button>
          <span className="font-['Oswald'] text-[11px] text-neutral-300">
            {formatTime(currentTime)} / {formatTime(ampProps.duration)}
          </span>
        </div>
        <Amp {...ampProps} controlsOnly onWaveSurferReady={(_n, instance) => (waveSurferRef.current = instance)} />
      </div>
    </ZoomOverlay>
  );
}
