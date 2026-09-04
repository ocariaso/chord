import { useRef, useState } from "react";

interface UploadPanelProps {
  onFileSelected: (file: File) => void;
  isSubmitting: boolean;
  error: string | null;
}

export function UploadPanel({ onFileSelected, isSubmitting, error }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    </div>
  );
}
