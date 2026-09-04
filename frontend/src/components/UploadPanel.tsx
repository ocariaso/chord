import { useRef, useState } from "react";

interface UploadPanelProps {
  onFileSelected: (file: File) => void;
  onUrlSubmitted: (url: string) => void;
  isSubmitting: boolean;
  error: string | null;
}

export function UploadPanel({ onFileSelected, onUrlSubmitted, isSubmitting, error }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileSelected(file);
  }

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) onUrlSubmitted(url.trim());
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-neutral-100">CHORD</h1>
        <p className="mt-1 text-neutral-400">Component Harmony &amp; Orchestral Retrieval Decoder</p>
      </div>

      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a link (YouTube, SoundCloud, and more)"
          disabled={isSubmitting}
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-purple-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSubmitting || !url.trim()}
          className="shrink-0 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          Fetch
        </button>
      </form>

      <div className="flex items-center gap-3 text-neutral-600">
        <div className="h-px flex-1 bg-neutral-800" />
        <span className="text-xs uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-neutral-800" />
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
    </div>
  );
}
