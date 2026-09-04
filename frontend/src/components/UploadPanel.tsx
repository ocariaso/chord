import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { listJobs } from "../api/client";

interface UploadPanelProps {
  onFileSelected: (file: File) => void;
  onSelectJob: (jobId: string) => void;
  isSubmitting: boolean;
  error: string | null;
}

export function UploadPanel({ onFileSelected, onSelectJob, isSubmitting, error }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: 5000,
  });

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-neutral-100">CHORD</h1>
        <p className="mt-1 text-neutral-400">Upload an MP3 to split it into stems</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          isDragging ? "border-purple-400 bg-purple-950/30" : "border-neutral-700 hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-neutral-300">
          {isSubmitting ? "Uploading..." : "Drag & drop an MP3 here, or click to choose a file"}
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {jobs && jobs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">Recent jobs</h2>
          <ul className="flex flex-col gap-1">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  onClick={() => onSelectJob(job.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-800"
                >
                  <span className="truncate text-neutral-200">{job.original_filename}</span>
                  <span className="ml-3 shrink-0 text-neutral-500">{job.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
