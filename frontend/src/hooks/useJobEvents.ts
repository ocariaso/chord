import { useEffect, useRef, useState } from "react";
import { cancelJobUrl, getJob, jobEventsUrl, type Job } from "../api/client";

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled"]);

/** Tracks a job's live status via SSE. */
export function useJobEvents(jobId: string | null): { job: Job | null; error: string | null } {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      statusRef.current = null;
      return;
    }

    const currentJobId = jobId;
    let cancelled = false;
    setError(null);
    statusRef.current = null;

    getJob(currentJobId)
      .then((initial) => {
        if (!cancelled) {
          setJob(initial);
          statusRef.current = initial.status;
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    const source = new EventSource(jobEventsUrl(currentJobId));

    source.onmessage = (event) => {
      const data: Job = JSON.parse(event.data);
      if (cancelled) return;
      setJob(data);
      statusRef.current = data.status;
      if (TERMINAL_STATUSES.has(data.status)) {
        source.close();
      }
    };

    source.onerror = () => {
      source.close();
    };

    // If the tab closes or the page reloads/navigates away while this job is still
    // queued or running, tell the backend to stop it instead of leaving it orphaned.
    function abandonIfStillRunning() {
      if (statusRef.current && !TERMINAL_STATUSES.has(statusRef.current)) {
        navigator.sendBeacon(cancelJobUrl(currentJobId));
      }
    }

    window.addEventListener("pagehide", abandonIfStillRunning);

    return () => {
      cancelled = true;
      source.close();
      window.removeEventListener("pagehide", abandonIfStillRunning);
      abandonIfStillRunning();
    };
  }, [jobId]);

  return { job, error };
}
