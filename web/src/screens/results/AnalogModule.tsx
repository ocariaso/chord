import { Knob } from "../../components/controls/Knob";
import { RoutingToggles } from "../../components/controls/RoutingToggles";
import { resultsCopy } from "../../design/copy";
import { fmtDb } from "../../design/player";
import { formatPan, formatTone } from "../../utils/levels";
import type { StemControls, StemDisplay } from "./types";

// Only the Level knob carries the stem's hue (design.md#controls).
const SMALL_KNOB_HUE = "var(--color-neutral-700)";

interface AnalogModuleProps {
  stem: StemDisplay;
  controls: StemControls;
}

/** `.ch-panel.ch-module`: the Level knob and its value, Tone and Pan knobs, MUTE/SOLO. Lifted when soloed, dimmed when muted. */
export function AnalogModule({ stem, controls }: AnalogModuleProps) {
  const { state } = stem;
  const value = fmtDb(state.gain, state.muted);
  // Solo before mute (design.md#state): a soloed module lifts even when it is also muted.
  const panelClass = state.solo ? "ch-panel ch-module is-active" : state.muted ? "ch-panel ch-module is-off" : "ch-panel ch-module";
  return (
    <div
      className={panelClass}
      style={
        {
          "--stem": stem.hue,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-6) var(--space-4)",
          // Below the stylesheet's 120px floor rather than scroll the row.
          minWidth: 0,
          overflow: "hidden",
        } as React.CSSProperties
      }
    >
      <span className="flex items-center" style={{ gap: 7 }}>
        <span className="ch-dot" />
        <span style={{ font: "500 12.5px/1 var(--font-body)", color: "var(--color-text)" }}>{stem.name}</span>
      </span>
      <Knob
        value={state.gain}
        onChange={(gain) => controls.onGainChange(state.key, gain)}
        label={resultsCopy.levelLabel(stem.name, value)}
        valueText={`${value} dB`}
      />
      <span className="ch-knob-group">
        <span className="ch-label">{resultsCopy.level}</span>
        <span className="ch-value">{value} dB</span>
      </span>
      <span className="flex items-center" style={{ gap: "var(--space-4)" }}>
        <span className="ch-knob-group">
          <Knob
            small
            hue={SMALL_KNOB_HUE}
            value={state.tone}
            onChange={(tone) => controls.onToneChange(state.key, tone)}
            label={resultsCopy.toneLabel(stem.name)}
            valueText={formatTone(state.tone)}
          />
          <span className="ch-label" style={{ fontSize: 9 }}>
            {resultsCopy.tone}
          </span>
          {/* Every control shows its value (design.md#ground-rules), the small knobs included. */}
          <span className="ch-value-sm">{formatTone(state.tone)}</span>
        </span>
        <span className="ch-knob-group">
          <Knob
            small
            hue={SMALL_KNOB_HUE}
            value={state.pan}
            onChange={(pan) => controls.onPanChange(state.key, pan)}
            label={resultsCopy.panLabel(stem.name, formatPan(state.pan))}
            valueText={formatPan(state.pan)}
          />
          <span className="ch-label" style={{ fontSize: 9 }}>
            {resultsCopy.pan}
          </span>
          <span className="ch-value-sm">{formatPan(state.pan)}</span>
        </span>
      </span>
      <span className="flex w-full" style={{ gap: "var(--space-2)" }}>
        <RoutingToggles
          stem={stem.name}
          muted={state.muted}
          solo={state.solo}
          onToggleMute={() => controls.onToggleMute(state.key)}
          onToggleSolo={() => controls.onToggleSolo(state.key)}
        />
      </span>
    </div>
  );
}
