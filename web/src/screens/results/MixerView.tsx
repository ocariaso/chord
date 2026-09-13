import { resultsCopy } from "../../design/copy";
import { StemRow } from "./StemRow";
import type { StemControls, StemDisplay } from "./types";

interface MixerViewProps {
  stems: StemDisplay[];
  controls: StemControls;
  /** The 0…1 playback position, read every frame and drawn across every waveform. */
  progress: () => number;
  duration: number;
  onSeek: (seconds: number) => void;
}

/** The default view: column labels and a stem row per stem. */
export function MixerView({ stems, controls, progress, duration, onSeek }: MixerViewProps) {
  return (
    <div className="flex flex-1 flex-col" style={{ padding: "var(--space-3) var(--space-8) var(--space-4)", gap: 2 }}>
      {/* The labels head fixed-width columns that the stylesheet dissolves below 720px, so they go with them. */}
      <div className="flex items-center max-[720px]:hidden" style={{ gap: "var(--space-6)", paddingBottom: "var(--space-3)" }}>
        <span className="ch-label" style={{ width: 96, flex: "none" }}>
          {resultsCopy.columns.stem}
        </span>
        <span className="ch-label" style={{ width: 150, flex: "none" }}>
          {resultsCopy.columns.level}
        </span>
        <span className="ch-label" style={{ width: 92, flex: "none" }}>
          {resultsCopy.columns.routing}
        </span>
        <span className="ch-label" style={{ flex: 1 }}>
          {resultsCopy.columns.waveform}
        </span>
      </div>
      {stems.map((stem) => (
        <StemRow key={stem.state.key} stem={stem} controls={controls} progress={progress} duration={duration} onSeek={onSeek} />
      ))}
    </div>
  );
}
