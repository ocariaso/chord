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
  /** Show just the interactive control row + waveform, skipping the decorative shell (used by the closer-look overlay). */
  controlsOnly?: boolean;
  /** True only on an actual narrow viewport — picks the amp's narrower mobile design width. The
   * closer-look overlay always renders at the full desktop width regardless of controlsOnly, since
   * it does its own fit-to-viewport scaling. */
  isMobile?: boolean;
  /** Only set (and only rendered) for the vocals amp — the current live-lyrics line, if any. */
  lyricLine?: string;
}
