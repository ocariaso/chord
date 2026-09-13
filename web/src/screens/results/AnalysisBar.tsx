import { Fader } from "../../components/controls/Fader";
import { resultsCopy } from "../../design/copy";
import { masterDb, MAX_TRANSPOSE, MIN_TRANSPOSE } from "../../design/player";
import { formatDb, formatSigned } from "../../utils/levels";
import { formatBpm } from "../../utils/tempo";
import { transposeKeyLabel } from "../../utils/transpose";

interface AnalysisBarProps {
  keyEstimate: string | null;
  keyConfidence: number | null;
  transpose: number;
  onTransposeChange: (semitones: number) => void;
  tempoBpm: number | null;
  master: number;
  onMasterChange: (value: number) => void;
}

/** Key, transpose, tempo and master level — shared by all three views, so rendered once above them (design.md#chords-and-lyrics). */
export function AnalysisBar({
  keyEstimate,
  keyConfidence,
  transpose,
  onTransposeChange,
  tempoBpm,
  master,
  onMasterChange,
}: AnalysisBarProps) {
  const masterText = `${formatDb(masterDb(master))} dB`;

  return (
    <div className="ch-section flex flex-wrap items-stretch" style={{ gap: "var(--space-8)" }}>
      <div className="flex flex-col" style={{ gap: 4 }}>
        <span className="ch-label">{resultsCopy.key}</span>
        <div className="flex items-baseline" style={{ gap: 8 }}>
          <span style={{ font: "500 26px/1 var(--font-body)", color: "var(--color-text)" }}>
            {keyEstimate ? transposeKeyLabel(keyEstimate, transpose) : resultsCopy.noValue}
          </span>
          {keyConfidence != null && <span className="ch-hint">{resultsCopy.confident(Math.round(keyConfidence * 100))}</span>}
        </div>
      </div>
      {/* Below 720px the groups wrap into a column, where a divider would divide nothing. */}
      <span className="ch-divider-x max-[720px]:hidden" />
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <span className="ch-label">{resultsCopy.transpose}</span>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 26, height: 26, padding: 0, fontSize: 14 }}
            aria-label={resultsCopy.transposeDown}
            disabled={transpose <= MIN_TRANSPOSE}
            onClick={() => onTransposeChange(transpose - 1)}
          >
            {resultsCopy.transposeDownSymbol}
          </button>
          <span
            style={{
              minWidth: 34,
              textAlign: "center",
              font: "500 14px/1 var(--font-body)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text)",
            }}
            aria-live="polite"
          >
            {formatSigned(transpose, 0)}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 26, height: 26, padding: 0, fontSize: 14 }}
            aria-label={resultsCopy.transposeUp}
            disabled={transpose >= MAX_TRANSPOSE}
            onClick={() => onTransposeChange(transpose + 1)}
          >
            {resultsCopy.transposeUpSymbol}
          </button>
          <span className="ch-hint" style={{ whiteSpace: "nowrap" }}>
            {resultsCopy.transposeHint}
          </span>
        </div>
      </div>
      <span className="ch-divider-x max-[720px]:hidden" />
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <span className="ch-label">{resultsCopy.tempo}</span>
        <div className="flex items-baseline" style={{ gap: 8 }}>
          <span style={{ font: "500 22px/1 var(--font-body)", fontVariantNumeric: "tabular-nums", color: "var(--color-text)" }}>
            {tempoBpm ? formatBpm(tempoBpm) : resultsCopy.noValue}
          </span>
          <span className="ch-subtitle">{resultsCopy.bpm}</span>
        </div>
      </div>
      <span className="ch-divider-x max-[720px]:hidden" />
      <div className="flex flex-1 flex-col" style={{ gap: "var(--space-2)", minWidth: 200 }}>
        <span className="ch-label">{resultsCopy.masterLevel}</span>
        <div className="flex items-center" style={{ gap: "var(--space-4)" }}>
          <Fader thin value={master} onChange={onMasterChange} label={resultsCopy.masterLevelLabel(masterText)} valueText={masterText} />
          <span className="ch-value">{masterText}</span>
        </div>
      </div>
    </div>
  );
}
