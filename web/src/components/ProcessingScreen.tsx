import { useEffect, useRef, useState } from "react";
import { cancelJob, thumbnailUrl, type Job } from "../api/client";
import { EqualizerBars, MusicNoteIcon } from "./DecorativeIcons";
import { DEFAULT_ACCENT_COLORS, useDominantColors } from "../hooks/useDominantColor";

interface ProcessingScreenProps {
  job: Job | null;
  connectionError: string | null;
  onRetry: () => void;
  /** Overrides the default cancelJob call, for reuse where there's no server job to cancel. */
  onCancel?: () => void;
}

const MARQUEE_GAP = 48;

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  fetching: "Downloading audio",
  separating: "Separating stems",
  analyzing: "Analyzing",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

export function ProcessingScreen({ job, connectionError, onRetry, onCancel }: ProcessingScreenProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const dominantColors = useDominantColors(job?.has_thumbnail ? thumbnailUrl(job.id) : null) ?? DEFAULT_ACCENT_COLORS;
  const accentColor = dominantColors.primary.css;

  const titleContainerRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const [marqueeTextWidth, setMarqueeTextWidth] = useState(0);

  useEffect(() => {
    const container = titleContainerRef.current;
    const measure = titleMeasureRef.current;
    if (!container || !measure) return;
    function update() {
      const natural = measure!.scrollWidth;
      setMarqueeTextWidth(natural > container!.clientWidth ? natural : 0);
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [job?.original_filename]);

  const background = (
    <div
      className="fixed inset-0 z-0"
      style={{
        backgroundImage:
          `radial-gradient(ellipse 90% 70% at 50% 0%, hsl(${dominantColors.primary.h}, ${dominantColors.primary.s}%, ${dominantColors.primary.l}%, 0.22), transparent 80%), ` +
          "linear-gradient(180deg, #141416 0%, #0a0a0b 65%, #030303 100%)",
      }}
    />
  );

  function centered(children: React.ReactNode) {
    return (
      <>
        {background}
        <div className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">{children}</div>
      </>
    );
  }

  if (connectionError && !job) {
    return centered(
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p className="text-red-400">{connectionError}</p>
        <button
          onClick={onRetry}
          style={{ backgroundColor: accentColor }}
          className="rounded-md px-4 py-2 text-white hover:opacity-90"
        >
          Back to upload
        </button>
      </div>
    );
  }

  if (!job) {
    return centered(<p className="text-neutral-400">Loading job...</p>);
  }

  if (job.status === "error") {
    return centered(
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p className="text-red-400">{job.error_message ?? "Something went wrong"}</p>
        <button
          onClick={onRetry}
          style={{ backgroundColor: accentColor }}
          className="rounded-md px-4 py-2 text-white hover:opacity-90"
        >
          Back to upload
        </button>
      </div>
    );
  }

  if (job.status === "cancelled") {
    return centered(
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p className="text-neutral-400">Job cancelled</p>
        <button
          onClick={onRetry}
          style={{ backgroundColor: accentColor }}
          className="rounded-md px-4 py-2 text-white hover:opacity-90"
        >
          Back to upload
        </button>
      </div>
    );
  }

  async function handleCancel() {
    if (onCancel) {
      onCancel();
      return;
    }
    if (!job) return;
    setIsCancelling(true);
    try {
      await cancelJob(job.id);
    } finally {
      setIsCancelling(false);
    }
  }

  const percent = Math.round(job.progress * 100);
  const marqueeDuration = Math.max(4, (marqueeTextWidth + MARQUEE_GAP) / 40);

  return centered(
    <div className="flex w-full max-w-sm flex-col items-center gap-6 sm:max-w-md">
      <div className="relative flex h-24 w-24 shrink-0 items-center justify-center sm:h-28 sm:w-28">
        <span
          className="absolute inset-0 animate-ping rounded-full"
          style={{ backgroundColor: accentColor, opacity: 0.2, animationDuration: "2s" }}
        />
        <div
          className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-neutral-900"
          style={{ boxShadow: `0 0 0 2px ${accentColor}` }}
        >
          {job.has_thumbnail ? (
            <img src={thumbnailUrl(job.id)} alt="" className="h-full w-full object-cover" />
          ) : (
            <MusicNoteIcon color={accentColor} />
          )}
        </div>
      </div>

      <div ref={titleContainerRef} className="relative w-full overflow-hidden">
        <span
          ref={titleMeasureRef}
          aria-hidden="true"
          className="invisible absolute whitespace-nowrap text-base font-medium sm:text-lg"
        >
          {job.original_filename}
        </span>
        {marqueeTextWidth > 0 ? (
          <p
            className="flex justify-center whitespace-nowrap text-base font-medium text-neutral-100 sm:text-lg"
            style={
              {
                "--marquee-distance": `-${marqueeTextWidth + MARQUEE_GAP}px`,
                animation: `marquee-loop ${marqueeDuration}s linear infinite`,
              } as React.CSSProperties
            }
          >
            <span style={{ paddingRight: MARQUEE_GAP }}>{job.original_filename}</span>
            <span style={{ paddingRight: MARQUEE_GAP }} aria-hidden="true">
              {job.original_filename}
            </span>
          </p>
        ) : (
          <p className="truncate text-center text-base font-medium text-neutral-100 sm:text-lg">
            {job.original_filename}
          </p>
        )}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800/70">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%`, backgroundColor: accentColor }}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <EqualizerBars color={accentColor} />
        <span>{job.stage_message ?? STAGE_LABELS[job.status] ?? job.status}</span>
      </div>

      <button
        onClick={handleCancel}
        disabled={isCancelling}
        className="text-sm text-neutral-500 hover:text-neutral-300 disabled:text-neutral-700"
      >
        {isCancelling ? "Cancelling..." : "Cancel"}
      </button>
    </div>
  );
}
