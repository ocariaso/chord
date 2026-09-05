import type WaveSurfer from "wavesurfer.js";

export interface AmpProps {
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
  duration: number;
  onSeek: (seconds: number) => void;
}
