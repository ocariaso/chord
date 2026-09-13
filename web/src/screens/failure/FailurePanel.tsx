import { AlertIcon, StopIcon } from "../../components/icons";

/**
 * The tone picks the mark and the hue of its ring. The ring is a hairline, the only place a status hue appears on
 * the panel (design.md#processing-and-failure).
 */
export type FailureTone = "danger" | "warn" | "neutral";

const RING_COLORS: Record<FailureTone, string> = {
  danger: "var(--ch-danger)",
  warn: "var(--ch-warn)",
  neutral: "var(--color-accent-700)",
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
 * A failure state (`job-error`, `job-cancelled`, `connection-error`, `results-load-error`): `.ch-alert` under a
 * `.ch-dropicon` mark, an optional `.ch-log`, its actions: one centered column on the page ground, vertically centered
 * above the footer.
 */
export function FailurePanel({ tone, title, body, log, primary, secondary }: FailurePanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center" style={{ paddingBlock: "clamp(12px, 4vh, 56px)" }}>
      <div className="flex min-h-0 w-full flex-col items-center" style={{ maxWidth: 480, gap: "clamp(20px, 4vh, 36px)" }}>
        <div className="ch-alert items-center text-center" role="alert" style={{ gap: "var(--space-6)" }}>
          <span
            className="ch-dropicon"
            style={{
              width: 56,
              height: 56,
              boxShadow: `inset 0 0 0 1px ${RING_COLORS[tone]}`,
              // A status hue stays in the ring; the mark itself only takes it from the accent when nothing went wrong.
              color: tone === "neutral" ? undefined : "var(--color-neutral-300)",
            }}
          >
            {tone === "neutral" ? <StopIcon /> : <AlertIcon />}
          </span>
          <h1
            style={{
              margin: 0,
              font: "500 32px/1.15 var(--font-body)",
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              textWrap: "balance",
            }}
          >
            {title}
          </h1>
          <p className="ch-alert-body" style={{ margin: 0, maxWidth: 440, fontSize: 14.5, lineHeight: 1.65 }}>
            {body}
          </p>
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
            style={{ minWidth: 150, minHeight: 40, fontSize: 13.5 }}
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {primary.label}
          </button>
          {secondary && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 40, paddingInline: 18, fontSize: 13.5 }}
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
