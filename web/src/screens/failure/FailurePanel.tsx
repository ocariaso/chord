import { ScreenCard } from "../../components/ScreenCard";

/** The dot is the only status hue — danger for hard failures, warn for recoverable ones (design.md#processing-and-failure). */
export type FailureTone = "danger" | "warn" | "neutral";

const DOT_COLORS: Record<FailureTone, string> = {
  danger: "var(--ch-danger)",
  warn: "var(--ch-warn)",
  neutral: "var(--color-neutral-600)",
};

export interface FailureAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface FailurePanelProps {
  tone: FailureTone;
  title: string;
  body: string;
  log?: string | null;
  primary: FailureAction;
  /** Every template failure state has one; only an app-authored state with nothing else to offer leaves it out. */
  secondary?: FailureAction;
}

/** A failure state (`job-error`, `job-cancelled`, `connection-error`, `results-load-error`): `.ch-alert`, an optional `.ch-log`, its actions. */
export function FailurePanel({ tone, title, body, log, primary, secondary }: FailurePanelProps) {
  return (
    <ScreenCard maxWidth={520}>
      <div className="flex flex-col" style={{ padding: "var(--space-8)", gap: "var(--space-6)" }}>
        <div className="ch-alert" role="alert">
          <span className="ch-alert-head">
            <span className="ch-dot ch-dot-status" style={{ "--stem": DOT_COLORS[tone] } as React.CSSProperties} />
            {title}
          </span>
          <span className="ch-alert-body">{body}</span>
        </div>
        {log && (
          // pre-line: a stem failure logs one request per line.
          <div className="ch-log" style={{ whiteSpace: "pre-line" }}>
            {log}
          </div>
        )}
        <div className="flex" style={{ gap: "var(--space-3)" }}>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </button>
          {secondary && (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </ScreenCard>
  );
}
