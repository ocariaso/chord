import type WaveSurfer from "wavesurfer.js";
import type { ChordSegment } from "../../api/client";
import { BassAmp } from "./amps/BassAmp";
import { DrumsAmp } from "./amps/DrumsAmp";
import { GuitarAmp } from "./amps/GuitarAmp";
import { OtherAmp } from "./amps/OtherAmp";
import { PianoAmp } from "./amps/PianoAmp";
import { VocalsAmp } from "./amps/VocalsAmp";
import { MasterUnit } from "./MasterUnit";
import type { AmpProps } from "./types";
import { GRID_GAP, MASTER_WIDTH } from "./constants";

const AMP_COMPONENTS: Record<string, (props: AmpProps) => React.JSX.Element> = {
  vocals: VocalsAmp,
  guitar: GuitarAmp,
  bass: BassAmp,
  piano: PianoAmp,
  drums: DrumsAmp,
  other: OtherAmp,
};

const STEM_ORDER = ["vocals", "guitar", "bass", "drums", "piano", "other"];

interface ChannelState {
  muted: boolean;
  volume: number;
}

interface StudioMixerProps {
  stemNames: string[];
  getBuffer: (name: string) => AudioBuffer | undefined;
  channelStates: Record<string, ChannelState>;
  soloedStems: Set<string>;
  stemUrl: (name: string) => string;
  onToggleMute: (name: string) => void;
  onToggleSolo: (name: string) => void;
  onVolumeChange: (name: string, volume: number) => void;
  onWaveSurferReady: (name: string, instance: WaveSurfer) => void;

  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  keyLabel: string | null;
  onSeek: (seconds: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

export function StudioMixer({
  stemNames,
  getBuffer,
  channelStates,
  soloedStems,
  stemUrl,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onWaveSurferReady,
  segments,
  currentTime,
  duration,
  keyLabel,
  onSeek,
  isPlaying,
  onPlayPause,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
}: StudioMixerProps) {
  const orderedNames = STEM_ORDER.filter((n) => stemNames.includes(n)).concat(stemNames.filter((n) => !STEM_ORDER.includes(n)));

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="sticky top-0 z-10 w-full pb-1" style={{ backgroundColor: "#0a0a0a" }}>
        <div className="mx-auto flex justify-center pt-2">
          <MasterUnit
            segments={segments}
            currentTime={currentTime}
            duration={duration}
            keyLabel={keyLabel}
            onSeek={onSeek}
            isPlaying={isPlaying}
            onPlayPause={onPlayPause}
            metronomeEnabled={metronomeEnabled}
            onToggleMetronome={onToggleMetronome}
            masterVolume={masterVolume}
            onMasterVolumeChange={onMasterVolumeChange}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 justify-items-center" style={{ gap: GRID_GAP, width: MASTER_WIDTH }}>
        {orderedNames.map((name) => {
          const Amp = AMP_COMPONENTS[name] ?? OtherAmp;
          const buffer = getBuffer(name);
          if (!buffer) return null;
          const state = channelStates[name] ?? { muted: false, volume: 1 };
          return (
            <Amp
              key={name}
              name={name}
              buffer={buffer}
              muted={state.muted}
              isSoloed={soloedStems.has(name)}
              volume={state.volume}
              downloadHref={stemUrl(name)}
              onToggleMute={() => onToggleMute(name)}
              onToggleSolo={() => onToggleSolo(name)}
              onVolumeChange={(v) => onVolumeChange(name, v)}
              onWaveSurferReady={onWaveSurferReady}
              duration={duration}
              onSeek={onSeek}
            />
          );
        })}
      </div>
    </div>
  );
}
