import { useState } from "react";
import { cancelJob, type Job } from "../api/client";

interface ProcessingScreenProps {
  job: Job | null;
  connectionError: string | null;
  onRetry: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  fetching: "Downloading audio",
  separating: "Separating stems",
  analyzing: "Analyzing",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

export function ProcessingScreen({ job, connectionError, onRetry }: ProcessingScreenProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  if (connectionError && !job) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-red-400">{connectionError}</p>
        <button onClick={onRetry} className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-500">
          Back to upload
        </button>
      </div>
    );
  }

  if (!job) {
    return <div className="p-8 text-center text-neutral-400">Loading job...</div>;
  }

  if (job.status === "error") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-red-400">{job.error_message ?? "Something went wrong"}</p>
        <button onClick={onRetry} className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-500">
          Back to upload
        </button>
      </div>
    );
  }

  if (job.status === "cancelled") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-neutral-400">Job cancelled</p>
        <button onClick={onRetry} className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-500">
          Back to upload
        </button>
      </div>
    );
  }

  async function handleCancel() {
    if (!job) return;
    setIsCancelling(true);
    try {
      await cancelJob(job.id);
    } finally {
      setIsCancelling(false);
    }
  }

  const percent = Math.round(job.progress * 100);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <p className="truncate text-center text-neutral-300">{job.original_filename}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-purple-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-center text-sm text-neutral-500">
        {job.stage_message ?? STAGE_LABELS[job.status] ?? job.status}
      </p>
      <button
        onClick={handleCancel}
        disabled={isCancelling}
        className="mx-auto text-sm text-neutral-500 hover:text-neutral-300 disabled:text-neutral-700"
      >
        {isCancelling ? "Cancelling..." : "Cancel"}
      </button>
    </div>
  );
}
