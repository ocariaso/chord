import { Fader } from "../../components/controls/Fader";
import { RoutingToggles } from "../../components/controls/RoutingToggles";
import { StemWaveform } from "../../components/controls/StemWaveform";
import { resultsCopy } from "../../design/copy";
import { fmtDb } from "../../design/player";
import type { StemControls, StemDisplay } from "./types";

interface StemRowProps {
  stem: StemDisplay;
  controls: StemControls;
  /** The 0…1 playback position, read every frame. */
  progress: () => number;
}

/** `.ch-stemrow` (design.md#controls): name, level fader and value, MUTE/SOLO, waveform. Below 720px the stylesheet stacks it. */
export function StemRow({ stem, controls, progress }: StemRowProps) {
  const { state } = stem;
  const value = fmtDb(state.gain, state.muted);
  return (
    // On the web the rows share any spare height evenly, never shrinking below their content; a stacked phone row keeps
    // its own height, and the panel scrolls.
    <div className="ch-stemrow flex-1 max-[720px]:flex-none" style={{ "--stem": stem.hue } as React.CSSProperties}>
      <span className="ch-stemrow-name">
        <span className="ch-dot" />
        <span style={{ color: "var(--color-text)" }}>{stem.name}</span>
      </span>
      <span className="ch-stemrow-level">
        <Fader
          thin
          value={state.gain}
          onChange={(gain) => controls.onGainChange(state.key, gain)}
          label={resultsCopy.levelLabel(stem.name, value)}
          valueText={`${value} dB`}
        />
        <span className="ch-value-sm" style={{ width: 38, textAlign: "right" }}>
          {value}
        </span>
      </span>
      <span className="ch-stemrow-routing">
        <RoutingToggles
          stem={stem.name}
          muted={state.muted}
          solo={state.solo}
          onToggleMute={() => controls.onToggleMute(state.key)}
          onToggleSolo={() => controls.onToggleSolo(state.key)}
        />
      </span>
      <StemWaveform envelope={stem.envelope} off={!stem.audible} progress={progress} />
    </div>
  );
}
