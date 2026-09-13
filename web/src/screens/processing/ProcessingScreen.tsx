import type { Job } from "../../api/client";
import { CoverArt } from "../../components/CoverArt";
import { CheckIcon } from "../../components/icons";
import { processingCopy } from "../../design/copy";
import { PHONE_QUERY } from "../../design/layout";
import {
  DETECTING_CHORDS_STAGE,
  PROCESSING_STAGES,
  processingStage,
  QUEUED_STAGE,
} from "../../design/stages";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatTime } from "../../utils/time";

interface ProcessingScreenProps {
  job: Job;
  onCancel: () => void;
  isCancelling?: boolean;
  /** The first update seen in each stage, from useJobEvents; stage times come from these. */
  stageSnapshots?: Record<number, Job>;
  /** The template's `processing-loading`: the job is done and its stems are loading in the browser. */
  loading?: boolean;
}

/** "Paper Lanterns · 4:12 · FLAC 24/48"; the phone arrangement leaves the format out. */
function metaFor(job: Job, withFormat: boolean): string {
  return [
    job.author,
    job.duration_seconds != null ? formatTime(job.duration_seconds) : null,
    withFormat ? job.audio_format : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Seconds between two server timestamps. Both come from the job row, so client clock skew never enters. */
function secondsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

/**
 * The template's processing screen — the `processing-*` scenarios — at web and phone width. Like the landing screen it
 * sits on the page ground rather than a `ScreenCard`: one centered column, vertically centered above the footer.
 */
export function ProcessingScreen({ job, onCancel, isCancelling = false, stageSnapshots = {}, loading = false }: ProcessingScreenProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  // While stems load the design holds the last stage current, at 100%.
  const current = loading ? DETECTING_CHORDS_STAGE : processingStage(job);
  const progress = loading ? 1 : job.progress;
  const stageMessage = loading ? processingCopy.loadingStems : (job.stage_message ?? PROCESSING_STAGES[current] ?? "");

  function stageStartedAt(index: number): string | undefined {
    return index === QUEUED_STAGE ? job.created_at : stageSnapshots[index]?.updated_at;
  }

  const stageRows = PROCESSING_STAGES.map((label, index) => {
    const done = index < current;
    const start = stageStartedAt(index);
    let end: string | undefined;
    for (let later = index + 1; later <= current && end === undefined; later++) end = stageStartedAt(later);
    return {
      label,
      className: done ? "ch-stage is-done" : index === current ? "ch-stage is-current" : "ch-stage",
      tick: done ? "var(--color-accent-400)" : "transparent",
      at: done && start && end ? formatTime(Math.max(0, secondsBetween(start, end))) : "",
    };
  });

  const cancelLabel = isCancelling ? processingCopy.cancelling : processingCopy.cancel;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col items-center justify-center"
      style={{ paddingBlock: isPhone ? "var(--space-3)" : "clamp(12px, 4vh, 56px)" }}
    >
      {/* Spacing follows the viewport's height, so a short window tightens the column instead of scrolling. */}
      <div
        className="flex w-full flex-col items-center"
        style={{ maxWidth: 460, gap: isPhone ? "clamp(12px, 2.5vh, 28px)" : "clamp(16px, 3.5vh, 36px)" }}
      >
        <header className="flex w-full min-w-0 flex-col items-center text-center" style={{ gap: "var(--space-6)" }}>
          <CoverArt
            jobId={job.id}
            hasThumbnail={job.has_thumbnail}
            size={isPhone ? 88 : 112}
            radius={10}
            outlined={!isPhone}
          />
          <span className="flex w-full min-w-0 flex-col items-center" style={{ gap: 6 }}>
            <span
              className="w-full truncate"
              style={{ font: isPhone ? "500 17px/1.3 var(--font-body)" : "500 20px/1.3 var(--font-body)", color: "var(--color-text)" }}
            >
              {job.original_filename}
            </span>
            <span className="ch-subtitle" style={{ fontSize: 12.5 }}>
              {metaFor(job, !isPhone)}
            </span>
          </span>
        </header>

        <div className="flex w-full flex-col items-center text-center" style={{ gap: 10 }}>
          <span
            style={{
              font: isPhone ? "500 32px/1 var(--font-body)" : "500 40px/1 var(--font-body)",
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {`${Math.round(progress * 100)}%`}
          </span>
          <span style={{ font: "500 13px/1.3 var(--font-body)", color: "var(--color-accent-400)" }} aria-live="polite">
            {stageMessage}
          </span>
          <div
            className="ch-progress w-full"
            style={{ "--v": progress, marginTop: 6 } as React.CSSProperties}
            role="progressbar"
            aria-label={stageMessage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <span />
          </div>
        </div>

        <div className="flex w-full flex-col">
          {stageRows.map((stage) =>
            isPhone ? (
              <div key={stage.label} className={stage.className} style={{ padding: "var(--space-4) 0" }}>
                <span className="ch-stage-mark" style={{ width: 14, height: 14 }} />
                <span style={{ flex: 1 }}>{stage.label}</span>
              </div>
            ) : (
              <div key={stage.label} className={stage.className}>
                <span className="ch-stage-mark">
                  <CheckIcon color={stage.tick} />
                </span>
                <span style={{ flex: 1 }}>{stage.label}</span>
                <span className="ch-value-sm">{stage.at}</span>
              </div>
            ),
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={isPhone ? { width: "100%", minHeight: 46, fontSize: 13 } : { minWidth: 140, minHeight: 38, fontSize: 13 }}
          onClick={onCancel}
          disabled={isCancelling}
        >
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}
