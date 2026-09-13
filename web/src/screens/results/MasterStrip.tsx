import type { RefObject } from "react";
import { VerticalFader } from "../../components/controls/Fader";
import { resultsCopy } from "../../design/copy";
import { masterDb } from "../../design/player";
import { formatDb } from "../../utils/levels";

/** The `data-meter` key the Console's frame loop reads the master levels into. */
export const MASTER_METER = "master";

// The master's tick column; masterDb() and MASTER_METER_SCALE in design/player.ts follow it.
const TICKS = ["0", "−6", "−18", "−∞"];

interface MasterStripProps {
  master: number;
  onMasterChange: (value: number) => void;
  metronome: boolean;
  onExport: () => void;
  /** Where the frame loop writes the true-peak readout. */
  peakRef: RefObject<HTMLSpanElement | null>;
  /** Below 720px: a horizontal bar instead of the 190px column, matching the stem strips. */
  compact?: boolean;
}

/** The Console's 190px master strip: fader, stereo meter, the Output / Peak / Metronome readouts, Export stems. */
export function MasterStrip({ master, onMasterChange, metronome, onExport, peakRef, compact = false }: MasterStripProps) {
  const masterText = `${formatDb(masterDb(master))} dB`;
  return (
    <div
      className="ch-panel flex"
      style={{
        flexDirection: compact ? "row" : "column",
        flexWrap: compact ? "wrap" : undefined,
        alignItems: compact ? "center" : undefined,
        width: compact ? "100%" : 190,
        flex: "none",
        gap: compact ? "var(--space-3)" : 14,
        padding: compact ? "var(--space-3) 14px" : "var(--space-6) 14px",
        background: "var(--ch-panel-raised)",
        boxShadow: "inset 0 0 0 1px var(--color-neutral-800)",
      }}
    >
      <span className="ch-label" style={{ color: "var(--color-text)", flex: compact ? "none" : undefined, width: compact ? 76 : undefined }}>
        {resultsCopy.master}
      </span>
      <span className="flex flex-1" style={{ gap: "var(--space-4)", minHeight: compact ? 84 : undefined }}>
        <VerticalFader value={master} onChange={onMasterChange} label={resultsCopy.masterLevelLabel(masterText)} valueText={masterText} />
        <span className="ch-meter" style={{ "--stem": "var(--color-accent)" } as React.CSSProperties} aria-hidden="true">
          <i data-meter={MASTER_METER} data-channel="0" style={{ "--l": 0 } as React.CSSProperties} />
          <i data-meter={MASTER_METER} data-channel="1" style={{ "--l": 0 } as React.CSSProperties} />
        </span>
        <span className="ch-ticks" aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </span>
      </span>
      <span className="flex flex-col" style={{ gap: "var(--space-2)", flex: compact ? "none" : undefined, width: compact ? 108 : undefined }}>
        <span className="flex justify-between" style={{ font: "400 10.5px/1 var(--font-body)", color: "var(--color-neutral-400)" }}>
          <span>{resultsCopy.output}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{masterText}</span>
        </span>
        <span className="flex justify-between" style={{ font: "400 10.5px/1 var(--font-body)", color: "var(--color-neutral-400)" }}>
          <span>{resultsCopy.peak}</span>
          <span ref={peakRef} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDb(-Infinity)}
          </span>
        </span>
        <span className="flex justify-between" style={{ font: "400 10.5px/1 var(--font-body)", color: "var(--color-neutral-400)" }}>
          <span>{resultsCopy.metronome}</span>
          <span style={{ color: "var(--color-accent-400)" }}>{metronome ? resultsCopy.on : resultsCopy.off}</span>
        </span>
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: "100%", flex: compact ? "1 0 100%" : undefined, fontSize: 11 }}
        onClick={onExport}
      >
        {resultsCopy.exportStems}
      </button>
    </div>
  );
}
