import { VerticalFader } from "../../components/controls/Fader";
import { RoutingToggles } from "../../components/controls/RoutingToggles";
import { resultsCopy } from "../../design/copy";
import { fmtDb } from "../../design/player";
import { formatPan } from "../../utils/levels";
import type { StemControls, StemDisplay } from "./types";

// The strip's tick column; db() and STEM_METER_SCALE in design/player.ts are spaced to match it.
const TICKS = ["0", "−12", "−24", "−∞"];

interface ConsoleStripProps {
  stem: StemDisplay;
  anySolo: boolean;
  controls: StemControls;
}

/** The harness's order: a soloed strip reads Soloed even when it is also muted. */
function stateLabel(stem: StemDisplay, anySolo: boolean): string {
  const { solo, muted } = stem.state;
  if (solo) return resultsCopy.stripState.soloed;
  if (muted) return stem.silent ? resultsCopy.stripState.silent : resultsCopy.stripState.muted;
  return anySolo ? resultsCopy.stripState.held : resultsCopy.stripState.playing;
}

/**
 * `.ch-panel.ch-strip` (INSTRUCTIONS §4.2): lifted when soloed, dimmed when muted. Its meter carries
 * `data-meter`, where the Console's frame loop writes `--l`.
 */
export function ConsoleStrip({ stem, anySolo, controls }: ConsoleStripProps) {
  const { state } = stem;
  const value = fmtDb(state.gain, state.muted);
  const panelClass = state.solo ? "ch-panel ch-strip is-active" : state.muted ? "ch-panel ch-strip is-off" : "ch-panel ch-strip";
  return (
    <div
      className={panelClass}
      style={
        {
          "--stem": stem.hue,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "var(--space-6) 14px",
        } as React.CSSProperties
      }
    >
      <span className="flex flex-col" style={{ gap: 3 }}>
        <span style={{ font: "500 12.5px/1 var(--font-body)", color: "var(--color-text)" }}>{stem.name}</span>
        <span className="ch-label" style={{ color: state.solo ? "var(--color-accent-400)" : "var(--color-neutral-600)" }}>
          {stateLabel(stem, anySolo)}
        </span>
      </span>
      <span className="flex flex-1" style={{ gap: "var(--space-4)", minHeight: 170 }}>
        <VerticalFader
          value={state.gain}
          onChange={(gain) => controls.onGainChange(state.key, gain)}
          label={resultsCopy.levelLabel(stem.name, value)}
          valueText={`${value} dB`}
        />
        <span className="ch-meter" aria-hidden="true">
          <i data-meter={state.key} data-channel="0" style={{ "--l": 0 } as React.CSSProperties} />
          <i data-meter={state.key} data-channel="1" style={{ "--l": 0 } as React.CSSProperties} />
        </span>
        <span className="ch-ticks" aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </span>
      </span>
      <span className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <span className="flex justify-between" style={{ font: "400 11px/1 var(--font-body)", color: "var(--color-neutral-400)" }}>
          <span>{resultsCopy.level}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
        </span>
        <span className="flex justify-between" style={{ font: "400 11px/1 var(--font-body)", color: "var(--color-neutral-600)" }}>
          <span>{resultsCopy.pan}</span>
          <span>{formatPan(state.pan)}</span>
        </span>
        <span className="flex" style={{ gap: "var(--space-2)" }}>
          <RoutingToggles
            stem={stem.name}
            muted={state.muted}
            solo={state.solo}
            onToggleMute={() => controls.onToggleMute(state.key)}
            onToggleSolo={() => controls.onToggleSolo(state.key)}
          />
        </span>
      </span>
    </div>
  );
}
