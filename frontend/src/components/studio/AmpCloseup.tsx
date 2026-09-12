import { useEffect, useRef } from "react";
import type WaveSurfer from "wavesurfer.js";
import { AMP_COMPONENTS } from "./ampComponents";
import { OtherAmp } from "./amps/OtherAmp";
import type { AmpProps } from "./types";
import { ZoomOverlay } from "./ZoomOverlay";

interface AmpCloseupProps extends Omit<AmpProps, "onWaveSurferReady"> {
  currentTime: number;
  originRect: DOMRect;
  onClose: () => void;
}

/** A closer look at one amp's real controls — the exact same component as in the grid, just isolated. */
export function AmpCloseup({ currentTime, originRect, onClose, ...ampProps }: AmpCloseupProps) {
  const Amp = AMP_COMPONENTS[ampProps.name] ?? OtherAmp;
  const waveSurferRef = useRef<WaveSurfer | null>(null);

  // The closeup's own WaveSurfer instance isn't part of the shared tick loop that keeps the
  // grid's amps in sync, so drive its playhead directly off the currentTime prop instead.
  useEffect(() => {
    waveSurferRef.current?.setTime(currentTime);
  }, [currentTime]);

  return (
    <ZoomOverlay originRect={originRect} onClose={onClose}>
      <Amp {...ampProps} controlsOnly onWaveSurferReady={(_n, instance) => (waveSurferRef.current = instance)} />
    </ZoomOverlay>
  );
}
