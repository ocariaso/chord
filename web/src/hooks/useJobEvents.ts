import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, discardJobUrl, getJob, jobEventsUrl, sendHeartbeat, type Job } from "../api/client";
import { processingStage } from "../design/stages";

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled"]);
export const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10_000;
// Far inside the server's JOB_TTL_HOURS, and slow enough that a background tab's throttled timers still keep it.
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export type ConnectionState =
  | { status: "live" }
  | { status: "retrying"; attempt: number; lastError: string }
  | { status: "failed"; lastError: string; notFound: boolean };

const LIVE: ConnectionState = { status: "live" };

/**
 * Tracks a job's live status via SSE, reconnecting with backoff when the stream drops. `reconnect`
 * resubscribes at once — pass the job a call just returned (a resume) to show it before the stream does.
 * `stageSnapshots` holds the first update seen in each processing stage, so the screen can time them.
 */
export function useJobEvents(jobId: string | null): {
  job: Job | null;
  connection: ConnectionState;
  stageSnapshots: Record<number, Job>;
  reconnect: (latest?: Job) => void;
} {
  const [job, setJob] = useState<Job | null>(null);
  // Keyed by job so a new job never inherits the previous one's connection trouble or stage timings.
  const [connection, setConnection] = useState<{ jobId: string | null; state: ConnectionState }>({ jobId: null, state: LIVE });
  const [snapshots, setSnapshots] = useState<{ jobId: string | null; byStage: Record<number, Job> }>({
    jobId: null,
    byStage: {},
  });
  const [generation, setGeneration] = useState(0);
  const statusRef = useRef<string | null>(null);

  const deliver = useCallback((next: Job, restart = false) => {
    setJob(next);
    statusRef.current = next.status;
    const stage = processingStage(next);
    setSnapshots((current) => {
      const sameRun = current.jobId === next.id && !restart;
      if (sameRun && current.byStage[stage]) return current;
      return { jobId: next.id, byStage: { ...(sameRun ? current.byStage : {}), [stage]: next } };
    });
  }, []);

  // Discard sits in its own effect, keyed on the job alone, so reconnecting can never fire it.
  useEffect(() => {
    if (!jobId) return;
    const currentJobId = jobId;

    // Cleans this job up on the server when the page is left, instead of leaving it orphaned.
    function discardOnLeave() {
      if (statusRef.current) {
        navigator.sendBeacon(discardJobUrl(currentJobId));
      }
    }

    window.addEventListener("pagehide", discardOnLeave);
    return () => {
      window.removeEventListener("pagehide", discardOnLeave);
      discardOnLeave();
    };
  }, [jobId]);

  // Once the stems are loaded, playback never calls the server, so without this the reaper can't tell an open job
  // from an abandoned one and deletes it from under the page.
  useEffect(() => {
    if (!jobId) return;
    const currentJobId = jobId;

    function beat() {
      sendHeartbeat(currentJobId).catch(() => {
        // One missed beat is covered by the next, long before the TTL; a job that is already gone has nothing to keep.
      });
    }

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      statusRef.current = null;
      return;
    }

    const currentJobId = jobId;
    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    function report(state: ConnectionState) {
      setConnection({ jobId: currentJobId, state });
    }

    function scheduleRetry(lastError: string) {
      attempt++;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        report({ status: "failed", lastError, notFound: false });
        return;
      }
      report({ status: "retrying", attempt, lastError });
      const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1));
      retryTimer = window.setTimeout(connect, delay);
    }

    function openStream() {
      const stream = new EventSource(jobEventsUrl(currentJobId));
      source = stream;
      stream.onmessage = (event) => {
        const data: Job = JSON.parse(event.data);
        if (cancelled) return;
        deliver(data);
        attempt = 0;
        report(LIVE);
        if (TERMINAL_STATUSES.has(data.status)) {
          stream.close();
        }
      };
      stream.onerror = () => {
        // EventSource would retry on its own with nothing to resume from; take over instead.
        stream.close();
        if (cancelled || TERMINAL_STATUSES.has(statusRef.current ?? "")) return;
        scheduleRetry("The progress stream closed unexpectedly");
      };
    }

    function connect() {
      getJob(currentJobId)
        .then((current) => {
          if (cancelled) return;
          deliver(current);
          if (TERMINAL_STATUSES.has(current.status)) {
            report(LIVE);
          } else {
            openStream();
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ApiError && error.status === 404) {
            // The job is gone; retrying can't bring it back.
            report({ status: "failed", lastError: message, notFound: true });
            return;
          }
          scheduleRetry(message);
        });
    }

    connect();

    return () => {
      cancelled = true;
      source?.close();
      window.clearTimeout(retryTimer);
    };
  }, [jobId, generation, deliver]);

  const reconnect = useCallback(
    (latest?: Job) => {
      if (latest) deliver(latest, true);
      setGeneration((value) => value + 1);
    },
    [deliver]
  );

  return {
    job: job && job.id === jobId ? job : null,
    connection: connection.jobId === jobId ? connection.state : LIVE,
    stageSnapshots: snapshots.jobId === jobId ? snapshots.byStage : {},
    reconnect,
  };
}
