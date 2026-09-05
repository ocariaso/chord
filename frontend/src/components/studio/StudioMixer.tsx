import { useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type { ChordSegment } from "../../api/client";
import { AmpCloseup } from "./AmpCloseup";
import { AMP_COMPONENTS, STEM_ORDER } from "./ampComponents";
import { OtherAmp } from "./amps/OtherAmp";
import { MasterCloseup } from "./MasterCloseup";
import { MasterUnit, type ViewMode } from "./MasterUnit";
import { CABINET_INTERIOR_COLOR, CABINET_INTERIOR_IMAGE, GRID_GAP, MASTER_WIDTH } from "./constants";

interface ChannelState {
  muted: boolean;
  volume: number;
}

interface StudioMixerProps {
  title: string;
  author: string | null;
  keyLabel: string | null;
  bpm: number | null;
  thumbnailUrl: string | null;
  transpose: number;
  onTransposeChange: React.Dispatch<React.SetStateAction<number>>;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  accentColor: string;
  onDownloadAll: () => void;
  isDownloadingAll: boolean;
  onUploadAnother: () => void;

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
  onSeek: (seconds: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  metronomeEnabled: boolean;
  onToggleMetronome?: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

export function StudioMixer({
  title,
  author,
  keyLabel,
  bpm,
  thumbnailUrl,
  transpose,
  onTransposeChange,
  viewMode,
  onChangeViewMode,
  accentColor,
  onDownloadAll,
  isDownloadingAll,
  onUploadAnother,
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
  onSeek,
  isPlaying,
  onPlayPause,
  metronomeEnabled,
  onToggleMetronome,
  masterVolume,
  onMasterVolumeChange,
}: StudioMixerProps) {
  const orderedNames = STEM_ORDER.filter((n) => stemNames.includes(n)).concat(stemNames.filter((n) => !STEM_ORDER.includes(n)));
  const [closeup, setCloseup] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [masterCloseupRect, setMasterCloseupRect] = useState<DOMRect | null>(null);

  function handleAmpClick(e: React.MouseEvent<HTMLDivElement>, name: string) {
    const target = e.target as HTMLElement;
    if (target.closest("button, .touch-none")) return;
    setCloseup({ name, rect: e.currentTarget.getBoundingClientRect() });
  }

  function handleMasterClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button, .touch-none")) return;
    setMasterCloseupRect(e.currentTarget.getBoundingClientRect());
  }

  const masterProps = {
    title,
    author,
    keyLabel,
    bpm,
    thumbnailUrl,
    transpose,
    onTransposeChange,
    segments,
    currentTime,
    duration,
    onSeek,
    isPlaying,
    onPlayPause,
    metronomeEnabled,
    onToggleMetronome,
    masterVolume,
    onMasterVolumeChange,
    viewMode,
    onChangeViewMode,
    accentColor,
    onDownloadAll,
    isDownloadingAll,
    onUploadAnother,
  };

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="sticky top-0 z-10 w-full pb-1" style={{ backgroundColor: CABINET_INTERIOR_COLOR, backgroundImage: CABINET_INTERIOR_IMAGE }}>
        <div onClick={handleMasterClick} className="mx-auto flex cursor-pointer justify-center pt-2">
          <MasterUnit {...masterProps} />
        </div>
      </div>

      <div className="grid grid-cols-2 justify-items-center" style={{ gap: GRID_GAP, width: MASTER_WIDTH }}>
        {orderedNames.map((name) => {
          const Amp = AMP_COMPONENTS[name] ?? OtherAmp;
          const buffer = getBuffer(name);
          if (!buffer) return null;
          const state = channelStates[name] ?? { muted: false, volume: 1 };
          return (
            <div key={name} onClick={(e) => handleAmpClick(e, name)} className="cursor-pointer">
              <Amp
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
            </div>
          );
        })}
      </div>

      {closeup &&
        (() => {
          const buffer = getBuffer(closeup.name);
          if (!buffer) return null;
          const state = channelStates[closeup.name] ?? { muted: false, volume: 1 };
          return (
            <AmpCloseup
              name={closeup.name}
              buffer={buffer}
              muted={state.muted}
              isSoloed={soloedStems.has(closeup.name)}
              volume={state.volume}
              downloadHref={stemUrl(closeup.name)}
              onToggleMute={() => onToggleMute(closeup.name)}
              onToggleSolo={() => onToggleSolo(closeup.name)}
              onVolumeChange={(v) => onVolumeChange(closeup.name, v)}
              duration={duration}
              onSeek={onSeek}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              currentTime={currentTime}
              originRect={closeup.rect}
              onClose={() => setCloseup(null)}
            />
          );
        })()}

      {masterCloseupRect && (
        <MasterCloseup {...masterProps} originRect={masterCloseupRect} onClose={() => setMasterCloseupRect(null)} />
      )}
    </div>
  );
}
