import { useRef, useState } from "react";
import { EqualizerBars, MusicNoteIcon } from "./DecorativeIcons";

interface UploadPanelProps {
  onFileSelected: (file: File) => void;
  onUrlSubmitted: (url: string) => void;
  isSubmitting: boolean;
  error: string | null;
}

const BRAND_ACCENT = "#307E9F";
const BRAND_ACCENT_LIGHT = "hsl(198, 54%, 58%)";

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
    <>
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage:
            `radial-gradient(ellipse 90% 60% at 50% 0%, ${BRAND_ACCENT}26, transparent 80%), ` +
            "linear-gradient(180deg, #141416 0%, #0a0a0b 65%, #030303 100%)",
        }}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 sm:gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <EqualizerBars color={BRAND_ACCENT} className="h-5" />
            <h1 className="text-3xl font-semibold text-neutral-100 sm:text-4xl">CHORD</h1>
            <p className="text-sm text-neutral-400 sm:text-base">Component Harmony &amp; Orchestral Retrieval Decoder</p>
          </div>

          <form onSubmit={handleUrlSubmit} className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a link (YouTube, SoundCloud, and more)"
              disabled={isSubmitting}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#307E9F] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSubmitting || !url.trim()}
              style={!isSubmitting && url.trim() ? { backgroundColor: BRAND_ACCENT } : undefined}
              className="shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
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
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-all duration-200 sm:p-12 ${
              isDragging ? "scale-[1.02] border-[#307E9F] bg-[#307E9F]/15" : "border-neutral-700 bg-neutral-950/40 hover:border-neutral-500"
            }`}
          >
            <MusicNoteIcon color={isDragging ? BRAND_ACCENT_LIGHT : "#737373"} className="h-8 w-8" />
            <input
              ref={inputRef}
              type="file"
              accept=".mp3,.flac,audio/mpeg,audio/flac"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <p className="text-sm text-neutral-300 sm:text-base">
              {isSubmitting ? "Uploading..." : "Drag & drop an MP3 or FLAC here, or click to choose a file"}
            </p>
          </div>

          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </>
  );
}
