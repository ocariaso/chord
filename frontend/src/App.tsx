import { useEffect, useState } from "react";
import { createJob, createJobFromUrl } from "./api/client";
import { ProcessingScreen } from "./components/ProcessingScreen";
import { StemMixer } from "./components/StemMixer";
import { UploadPanel } from "./components/UploadPanel";
import { useJobEvents } from "./hooks/useJobEvents";

type Screen = "upload" | "processing" | "results";

function App() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { job, error: connectionError } = useJobEvents(activeJobId);

  useEffect(() => {
    if (job && screen === "processing" && job.status === "done") {
      setScreen("results");
    }
  }, [job, screen]);

  async function handleFileSelected(file: File) {
    setIsSubmitting(true);
    setUploadError(null);
    try {
      const created = await createJob(file);
      setActiveJobId(created.id);
      setScreen("processing");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUrlSubmitted(url: string) {
    setIsSubmitting(true);
    setUploadError(null);
    try {
      const created = await createJobFromUrl(url);
      setActiveJobId(created.id);
      setScreen("processing");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to start download");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBack() {
    setActiveJobId(null);
    setScreen("upload");
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {screen === "upload" && (
        <UploadPanel
          onFileSelected={handleFileSelected}
          onUrlSubmitted={handleUrlSubmitted}
          isSubmitting={isSubmitting}
          error={uploadError}
        />
      )}
      {screen === "processing" && (
        <ProcessingScreen job={job} connectionError={connectionError} onRetry={handleBack} />
      )}
      {screen === "results" && job && <StemMixer job={job} onBack={handleBack} />}
    </div>
  );
}

export default App;
