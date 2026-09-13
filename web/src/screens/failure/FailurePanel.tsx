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

/**
 * A failure state (`job-error`, `job-cancelled`, `connection-error`, `results-load-error`): `.ch-alert`, an optional
 * `.ch-log`, its actions. Like the landing and processing screens it sits on the page ground rather than a
 * `ScreenCard`: one centered column, vertically centered above the footer.
 */
export function FailurePanel({ tone, title, body, log, primary, secondary }: FailurePanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center" style={{ paddingBlock: "clamp(12px, 4vh, 56px)" }}>
      <div className="flex min-h-0 w-full flex-col items-center" style={{ maxWidth: 460, gap: "clamp(16px, 3.5vh, 28px)" }}>
        <div className="ch-alert items-center text-center" role="alert" style={{ gap: "var(--space-6)" }}>
          <span className="ch-alert-head" style={{ font: "500 22px/1.25 var(--font-body)", color: "var(--color-text)" }}>
            <span className="ch-dot ch-dot-status" style={{ "--stem": DOT_COLORS[tone] } as React.CSSProperties} />
            {title}
          </span>
          <span className="ch-alert-body" style={{ maxWidth: 420, fontSize: 14 }}>
            {body}
          </span>
        </div>
        {log && (
          // pre-line: a stem failure logs one request per line. A long traceback is cut at 30% of the viewport rather
          // than scrolling the page; the whole log stays one Copy log away.
          <div className="ch-log w-full text-left" style={{ whiteSpace: "pre-line", maxHeight: "30vh", overflow: "hidden" }}>
            {log}
          </div>
        )}
        <div className="flex w-full flex-wrap justify-center" style={{ gap: "var(--space-4)" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minWidth: 140, minHeight: 38, fontSize: 13 }}
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {primary.label}
          </button>
          {secondary && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 38, paddingInline: 18, fontSize: 13 }}
              onClick={secondary.onClick}
              disabled={secondary.disabled}
            >
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
