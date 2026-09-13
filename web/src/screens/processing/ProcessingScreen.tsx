import type { Job } from "../../api/client";
import { CoverArt } from "../../components/CoverArt";
import { CheckIcon } from "../../components/icons";
import { ScreenCard } from "../../components/ScreenCard";
import { processingCopy } from "../../design/copy";
import { PHONE_QUERY } from "../../design/layout";
import {
  DETECTING_CHORDS_STAGE,
  PROCESSING_STAGES,
  processingStage,
  QUEUED_STAGE,
  SEPARATING_STAGE,
} from "../../design/stages";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatTime } from "../../utils/time";

// The span of the bar the server gives separation; see _SEPARATION_PROGRESS in pipeline.py.
const SEPARATION_PROGRESS_END = 0.5;
// How much separation progress to observe before offering an estimate.
const ESTIMATE_AFTER_SECONDS = 3;

interface ProcessingScreenProps {
  job: Job;
  onCancel: () => void;
  isCancelling?: boolean;
  /** The first update seen in each stage, from useJobEvents; stage times and the estimate come from these. */
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

/** The template's processing screen — the `processing-*` scenarios — at web and phone width. */
export function ProcessingScreen({ job, onCancel, isCancelling = false, stageSnapshots = {}, loading = false }: ProcessingScreenProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  // While stems load the harness holds the last stage current, at 100%.
  const current = loading ? DETECTING_CHORDS_STAGE : processingStage(job);
  const progress = loading ? 1 : job.progress;
  const stageMessage = loading ? processingCopy.loadingStems : (job.stage_message ?? PROCESSING_STAGES[current] ?? "");

  let hint: string = processingCopy.model;
  const separationStart = stageSnapshots[SEPARATING_STAGE];
  if (loading) {
    hint = processingCopy.decoding;
  } else if (current === SEPARATING_STAGE && separationStart) {
    const elapsed = secondsBetween(separationStart.updated_at, job.updated_at);
    const gained = job.progress - separationStart.progress;
    if (elapsed >= ESTIMATE_AFTER_SECONDS && gained > 0) {
      const remaining = ((SEPARATION_PROGRESS_END - job.progress) / gained) * elapsed;
      hint = processingCopy.estimate(Math.max(0, remaining));
    }
  }

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

  const progressBar = (
    <div
      className="ch-progress"
      style={{ "--v": progress } as React.CSSProperties}
      role="progressbar"
      aria-label={stageMessage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <span />
    </div>
  );
  const percent = `${Math.round(progress * 100)}%`;
  const cancelLabel = isCancelling ? processingCopy.cancelling : processingCopy.cancel;

  if (isPhone) {
    return (
      <ScreenCard>
        <div className="flex flex-col" style={{ padding: "var(--space-3) var(--space-6) var(--space-8)", gap: "var(--space-8)" }}>
          <div className="flex items-center" style={{ gap: "var(--space-4)" }}>
            <CoverArt jobId={job.id} hasThumbnail={job.has_thumbnail} size={52} radius={8} outlined={false} />
            <span className="flex min-w-0 flex-col" style={{ gap: 3 }}>
              <span style={{ font: "500 13.5px/1.3 var(--font-body)", color: "var(--color-text)" }}>{job.original_filename}</span>
              <span className="ch-subtitle">{metaFor(job, false)}</span>
            </span>
          </div>
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            <div className="flex items-baseline justify-between">
              <span style={{ font: "500 13px/1 var(--font-body)", color: "var(--color-text)" }} aria-live="polite">
                {stageMessage}
              </span>
              <span style={{ font: "500 12px/1 var(--font-body)", color: "var(--color-accent-400)", fontVariantNumeric: "tabular-nums" }}>
                {percent}
              </span>
            </div>
            {progressBar}
            <span className="ch-hint">{hint}</span>
          </div>
          <div className="flex flex-col">
            {stageRows.map((stage) => (
              <div key={stage.label} className={stage.className} style={{ padding: "var(--space-4) 0" }}>
                <span className="ch-stage-mark" style={{ width: 14, height: 14 }} />
                <span style={{ flex: 1 }}>{stage.label}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "100%", minHeight: 46, fontSize: 13, marginTop: "auto" }}
            onClick={onCancel}
            disabled={isCancelling}
          >
            {cancelLabel}
          </button>
        </div>
      </ScreenCard>
    );
  }

  return (
    <ScreenCard maxWidth={520}>
      <div className="flex flex-col" style={{ padding: "var(--space-8)", gap: "var(--space-8)" }}>
        <div className="flex items-center" style={{ gap: 14 }}>
          <CoverArt jobId={job.id} hasThumbnail={job.has_thumbnail} size={56} radius={8} />
          <span className="flex min-w-0 flex-1 flex-col overflow-hidden" style={{ gap: 3 }}>
            <span className="ch-title truncate">{job.original_filename}</span>
            <span className="ch-subtitle">{metaFor(job, true)}</span>
          </span>
          <button type="button" className="btn btn-ghost" style={{ flex: "none", fontSize: 11.5 }} onClick={onCancel} disabled={isCancelling}>
            {cancelLabel}
          </button>
        </div>
        <div className="flex flex-col" style={{ gap: 7 }}>
          <div className="flex items-baseline justify-between">
            <span style={{ font: "500 12.5px/1 var(--font-body)", color: "var(--color-text)" }} aria-live="polite">
              {stageMessage}
            </span>
            <span style={{ font: "500 12px/1 var(--font-body)", color: "var(--color-accent-400)", fontVariantNumeric: "tabular-nums" }}>
              {percent}
            </span>
          </div>
          {progressBar}
          <span className="ch-hint">{hint}</span>
        </div>
        <div className="flex flex-col">
          {stageRows.map((stage) => (
            <div key={stage.label} className={stage.className}>
              <span className="ch-stage-mark">
                <CheckIcon color={stage.tick} />
              </span>
              <span style={{ flex: 1 }}>{stage.label}</span>
              <span className="ch-value-sm">{stage.at}</span>
            </div>
          ))}
        </div>
      </div>
    </ScreenCard>
  );
}
