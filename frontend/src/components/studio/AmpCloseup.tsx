import { useEffect } from "react";
import type WaveSurfer from "wavesurfer.js";
import { AMP_COMPONENTS } from "./ampComponents";
import { OtherAmp } from "./amps/OtherAmp";
import type { AmpProps } from "./types";
import { ZoomOverlay } from "./ZoomOverlay";

interface AmpCloseupProps extends Omit<AmpProps, "onWaveSurferReady"> {
  onWaveSurferReady: (name: string, instance: WaveSurfer) => void;
  onWaveSurferRemove: (name: string) => void;
  originRect: DOMRect;
  onClose: () => void;
}

/** A closer look at one amp's real controls — the exact same component as in the grid, just isolated. */
export function AmpCloseup({ onWaveSurferReady, onWaveSurferRemove, originRect, onClose, ...ampProps }: AmpCloseupProps) {
  const Amp = AMP_COMPONENTS[ampProps.name] ?? OtherAmp;
  const closeupKey = `${ampProps.name}:closeup`;

  useEffect(() => () => onWaveSurferRemove(closeupKey), [closeupKey, onWaveSurferRemove]);

  return (
    <ZoomOverlay originRect={originRect} onClose={onClose}>
      <Amp {...ampProps} controlsOnly onWaveSurferReady={(n, instance) => onWaveSurferReady(`${n}:closeup`, instance)} />
    </ZoomOverlay>
  );
}
