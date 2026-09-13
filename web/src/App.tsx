import { useState } from "react";
import { cancelJob, createJob, createJobFromUrl, resumeJob, type Job } from "./api/client";
import { Footer } from "./components/Footer";
import { failureCopy, landingCopy } from "./design/copy";
import { MAX_RECONNECT_ATTEMPTS, useJobEvents } from "./hooks/useJobEvents";
import { FailurePanel } from "./screens/failure/FailurePanel";
import { LandingScreen, type SubmitError, type Submission } from "./screens/landing/LandingScreen";
import { ProcessingScreen } from "./screens/processing/ProcessingScreen";
import { ResultsScreen } from "./screens/results/ResultsScreen";
import { copyText } from "./utils/clipboard";

const COPIED_FEEDBACK_MS = 2000;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function App() {
  // No job means the landing screen; otherwise the job's own status picks processing, failure or results.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // The create response, shown until the event stream delivers its first update.
  const [createdJob, setCreatedJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState<Submission>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [logCopied, setLogCopied] = useState(false);

  const { job: liveJob, connection, stageSnapshots, reconnect } = useJobEvents(activeJobId);
  const job = liveJob ?? (createdJob?.id === activeJobId ? createdJob : null);

  function startWatching(created: Job) {
    setCreatedJob(created);
    setActiveJobId(created.id);
  }

  async function handleFileSelected(file: File) {
    setSubmitError(null);
    setSubmitting("file");
    try {
      startWatching(await createJob(file));
    } catch (error) {
      setSubmitError({ title: landingCopy.uploadFailedTitle, body: messageOf(error, landingCopy.uploadFailedTitle) });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleUrlSubmitted(url: string) {
    setSubmitError(null);
    setSubmitting("url");
    try {
      startWatching(await createJobFromUrl(url));
    } catch (error) {
      setSubmitError({ title: landingCopy.linkFailedTitle, body: messageOf(error, landingCopy.linkFailedTitle) });
    } finally {
      setSubmitting(null);
    }
  }

  function handleBack() {
    setActiveJobId(null);
    setCreatedJob(null);
    setSubmitError(null);
    setResumeError(null);
  }

  async function handleCancel() {
    if (!job) return;
    setIsCancelling(true);
    try {
      await cancelJob(job.id);
    } catch {
      // A job that finished in the meantime answers 409; the event stream reports its real state either way.
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleResume() {
    if (!job) return;
    setIsResuming(true);
    setResumeError(null);
    try {
      reconnect(await resumeJob(job.id));
    } catch (error) {
      setResumeError(messageOf(error, failureCopy["job-cancelled"].resumeFailed));
    } finally {
      setIsResuming(false);
    }
  }

  async function handleCopyLog(log: string) {
    if (await copyText(log)) {
      setLogCopied(true);
      window.setTimeout(() => setLogCopied(false), COPIED_FEEDBACK_MS);
    }
  }

  function renderJob() {
    if (job?.status === "done") {
      return <ResultsScreen job={job} onBack={handleBack} stageSnapshots={stageSnapshots} />;
    }

    if (connection.status !== "live") {
      const copy = failureCopy["connection-error"];
      if (connection.status === "failed" && connection.notFound) {
        // Reconnecting can't bring back a job the server no longer has, so a new track is the only way on.
        return (
          <FailurePanel
            tone="danger"
            title={copy.notFoundTitle}
            body={copy.notFoundBody}
            log={connection.lastError}
            primary={{ label: copy.secondary, onClick: handleBack }}
          />
        );
      }
      return (
        <FailurePanel
          tone="warn"
          title={copy.title}
          body={
            connection.status === "retrying"
              ? copy.body(connection.attempt, MAX_RECONNECT_ATTEMPTS)
              : copy.gaveUp(MAX_RECONNECT_ATTEMPTS)
          }
          log={connection.lastError}
          primary={{ label: copy.primary, onClick: () => reconnect() }}
          secondary={{ label: copy.secondary, onClick: handleBack }}
        />
      );
    }

    if (!job) return null;

    if (job.status === "error") {
      const copy = failureCopy["job-error"];
      // Copy log hands over the traceback when the server kept one, and the error message when it didn't.
      const log = job.error_log ?? job.error_message ?? copy.bodyFallback;
      return (
        <FailurePanel
          tone="danger"
          title={copy.title}
          body={job.error_message ?? copy.bodyFallback}
          log={job.error_log}
          primary={{ label: copy.primary, onClick: handleBack }}
          secondary={{ label: logCopied ? copy.copied : copy.secondary, onClick: () => void handleCopyLog(log) }}
        />
      );
    }

    if (job.status === "cancelled") {
      const copy = failureCopy["job-cancelled"];
      return (
        <FailurePanel
          tone="neutral"
          title={copy.title}
          body={copy.body}
          log={resumeError}
          primary={{ label: isResuming ? copy.resuming : copy.primary, onClick: () => void handleResume(), disabled: isResuming }}
          secondary={{ label: copy.secondary, onClick: handleBack, disabled: isResuming }}
        />
      );
    }

    return (
      <ProcessingScreen
        job={job}
        onCancel={() => void handleCancel()}
        isCancelling={isCancelling}
        stageSnapshots={stageSnapshots}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <main
        className={`flex min-h-0 flex-1 justify-center px-(--space-8) pt-5 max-[720px]:px-3 max-[720px]:pt-3 ${activeJobId === null ? "pb-2" : "pb-5"}`}
      >
        <div className="flex h-full w-full max-w-280 min-w-0 flex-col">
          {activeJobId === null ? (
            <LandingScreen
              submitting={submitting}
              error={submitError}
              onFileSelected={(file) => void handleFileSelected(file)}
              onUrlSubmitted={(url) => void handleUrlSubmitted(url)}
            />
          ) : (
            renderJob()
          )}
        </div>
      </main>
      {/* The footer belongs to the front page; a job's screens keep the whole viewport. */}
      {activeJobId === null && <Footer />}
    </div>
  );
}

export default App;
