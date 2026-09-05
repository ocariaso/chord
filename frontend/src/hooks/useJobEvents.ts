import { useEffect, useState } from "react";
import { getJob, jobEventsUrl, type Job } from "../api/client";

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled"]);

/** Tracks a job's live status via SSE. */
export function useJobEvents(jobId: string | null): { job: Job | null; error: string | null } {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    getJob(jobId)
      .then((initial) => {
        if (!cancelled) setJob(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    const source = new EventSource(jobEventsUrl(jobId));

    source.onmessage = (event) => {
      const data: Job = JSON.parse(event.data);
      if (cancelled) return;
      setJob(data);
      if (TERMINAL_STATUSES.has(data.status)) {
        source.close();
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [jobId]);

  return { job, error };
}
