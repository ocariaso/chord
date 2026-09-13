import { useId, useRef, useState } from "react";
import { UploadIcon } from "../../components/icons";
import { ScreenCard } from "../../components/ScreenCard";
import { brand, landingCopy } from "../../design/copy";
import { PHONE_QUERY } from "../../design/layout";
import { useMediaQuery } from "../../hooks/useMediaQuery";

/**
 * The request in flight, if any. The template's busy state ("Submitting…") goes on the button that sent it;
 * the phone arrangement has only Fetch track, so that one shows it for a file too.
 */
export type Submission = "file" | "url" | null;

/** A request the server refused or never received. */
export interface SubmitError {
  title: string;
  body: string;
}

interface LandingScreenProps {
  submitting: Submission;
  error: SubmitError | null;
  onFileSelected: (file: File) => void;
  onUrlSubmitted: (url: string) => void;
}

interface Rejection {
  fileName: string;
  hint: string;
  body: string;
}

const ACCEPTED_EXTENSIONS = [".mp3", ".flac"];

function rejectionFor(file: File): Rejection | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return { fileName: file.name, hint: landingCopy.rejectedDropHint, body: landingCopy.rejectedBody(file.name) };
  }
  if (file.size === 0) {
    return { fileName: file.name, hint: landingCopy.emptyDropHint, body: landingCopy.emptyBody(file.name) };
  }
  return null;
}

function Alert({ title, body }: SubmitError) {
  return (
    <div className="ch-alert" role="alert">
      <span className="ch-alert-head">
        <span className="ch-dot ch-dot-status" style={{ "--stem": "var(--ch-danger)" } as React.CSSProperties} />
        {title}
      </span>
      <span className="ch-alert-body">{body}</span>
    </div>
  );
}

/** The template's landing screen — scenarios `upload`, `upload-submitting` and `upload-error` — at web and phone width. */
export function LandingScreen({ submitting, error, onFileSelected, onUrlSubmitted }: LandingScreenProps) {
  const [url, setUrl] = useState("");
  const [isOver, setIsOver] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlId = useId();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const busy = submitting !== null;

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    const rejected = rejectionFor(file);
    setRejection(rejected);
    if (!rejected) onFileSelected(file);
  }

  function handleUrlSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (url.trim() && !busy) {
      setRejection(null);
      onUrlSubmitted(url.trim());
    }
  }

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  const dropClass = `ch-dropzone${isOver ? " is-over" : ""}${rejection ? " is-rejected" : ""}`;
  const dragHandlers = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(true);
    },
    onDragLeave: () => setIsOver(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(false);
      handleFiles(event.dataTransfer.files);
    },
  };
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".mp3,.flac,audio/mpeg,audio/flac"
      className="hidden"
      onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );
  const urlInput = (fontSize: number) => (
    <input
      className="input"
      id={urlId}
      type="url"
      required
      placeholder={landingCopy.urlPlaceholder}
      value={url}
      onChange={(event) => setUrl(event.target.value)}
      disabled={busy}
      style={{ width: "100%", fontSize }}
    />
  );
  // A rejection is always newer than a server error: any submission that reaches the server clears it first.
  const alert = rejection ? { title: landingCopy.rejectedTitle, body: rejection.body } : error;

  if (isPhone) {
    return (
      <ScreenCard>
        <div className="flex flex-col" style={{ padding: "var(--space-3) var(--space-6) var(--space-8)", gap: "var(--space-6)" }}>
          <span className="flex flex-col" style={{ gap: 4 }}>
            <span style={{ font: "600 12px/1 var(--font-body)", letterSpacing: "0.18em", color: "var(--color-text)" }}>{brand.name}</span>
            <span style={{ font: "400 10.5px/1.4 var(--font-body)", letterSpacing: "0.04em", color: "var(--color-neutral-500)" }}>
              {brand.expansion}
            </span>
          </span>
          <h1 style={{ margin: 0, font: "500 24px/1.2 var(--font-body)", color: "var(--color-text)" }}>{landingCopy.headline}</h1>
          {/* The phone arrangement has no Choose file button, so the dropzone itself is the control. */}
          <div
            className={dropClass}
            style={{ flexDirection: "column", textAlign: "center", padding: "var(--space-8) var(--space-6)" }}
            role="button"
            tabIndex={0}
            aria-disabled={busy}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker();
              }
            }}
            {...dragHandlers}
          >
            <span className="ch-dropicon" style={{ width: 42, height: 42 }}>
              <UploadIcon size={18} />
            </span>
            <span style={{ font: "500 13.5px/1.3 var(--font-body)", color: "var(--color-text)" }}>
              {rejection ? landingCopy.rejectedDropTitle(rejection.fileName) : landingCopy.phoneDropTitle}
            </span>
            <span className="ch-hint">{rejection ? rejection.hint : landingCopy.phoneDropHint}</span>
            {fileInput}
          </div>
          <form className="flex flex-col" style={{ gap: "var(--space-6)" }} onSubmit={handleUrlSubmit}>
            <div className="field flex flex-col" style={{ gap: "var(--space-2)" }}>
              <label className="ch-label" htmlFor={urlId}>
                {landingCopy.urlLabel}
              </label>
              {urlInput(13)}
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", minHeight: 46, fontSize: 13.5 }} disabled={busy}>
              {busy ? landingCopy.submitting : landingCopy.fetchTrack}
            </button>
          </form>
          {alert && <Alert title={alert.title} body={alert.body} />}
          <span className="ch-hint">{landingCopy.stemsHint}</span>
        </div>
      </ScreenCard>
    );
  }

  return (
    <ScreenCard>
      <div className="flex flex-col" style={{ padding: "40px 44px", gap: 26 }}>
        <div className="flex flex-col" style={{ gap: "var(--space-4)", maxWidth: 520 }}>
          <span className="flex flex-wrap items-baseline" style={{ gap: 8 }}>
            <span style={{ font: "600 13px/1 var(--font-body)", letterSpacing: "0.18em", color: "var(--color-text)" }}>{brand.name}</span>
            <span style={{ font: "400 11px/1.4 var(--font-body)", letterSpacing: "0.04em", color: "var(--color-neutral-500)" }}>
              {brand.expansion}
            </span>
          </span>
          <h1 style={{ margin: 0, font: "500 30px/1.15 var(--font-body)", letterSpacing: "-0.01em", color: "var(--color-text)" }}>
            {landingCopy.headline}
          </h1>
          <p style={{ margin: 0, font: "400 13.5px/1.6 var(--font-body)", color: "var(--color-neutral-400)", textWrap: "pretty" }}>
            {landingCopy.intro}
          </p>
        </div>
        <div className="flex flex-col" style={{ gap: 14, maxWidth: 620 }}>
          <div className={dropClass} onClick={openPicker} {...dragHandlers}>
            <span className="ch-dropicon">
              <UploadIcon />
            </span>
            <span className="flex min-w-0 flex-col" style={{ gap: 4 }}>
              <span style={{ font: "500 14px/1.3 var(--font-body)", color: "var(--color-text)" }}>
                {rejection ? landingCopy.rejectedDropTitle(rejection.fileName) : landingCopy.dropTitle}
              </span>
              <span style={{ font: "400 11.5px/1.4 var(--font-body)", color: "var(--color-neutral-500)" }}>
                {rejection ? rejection.hint : landingCopy.dropHint}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: "auto", flex: "none", fontSize: 12.5 }}
              disabled={busy}
              onClick={(event) => {
                // The dropzone opens the picker too; one click shouldn't open it twice.
                event.stopPropagation();
                openPicker();
              }}
            >
              {submitting === "file" ? landingCopy.submitting : landingCopy.chooseFile}
            </button>
            {fileInput}
          </div>
          <div className="flex items-center" style={{ gap: 14 }}>
            <span className="ch-divider-y" style={{ flex: 1 }} />
            <span className="ch-label">{landingCopy.orPasteLink}</span>
            <span className="ch-divider-y" style={{ flex: 1 }} />
          </div>
          <form className="flex items-end" style={{ gap: "var(--space-4)" }} onSubmit={handleUrlSubmit}>
            <div className="field flex min-w-0 flex-1 flex-col" style={{ gap: "var(--space-2)" }}>
              <label className="ch-label" htmlFor={urlId}>
                {landingCopy.urlLabel}
              </label>
              {urlInput(12.5)}
            </div>
            <button type="submit" className="btn btn-secondary" style={{ flex: "none", fontSize: 12.5 }} disabled={busy}>
              {submitting === "url" ? landingCopy.submitting : landingCopy.fetchTrack}
            </button>
          </form>
          {alert && <Alert title={alert.title} body={alert.body} />}
        </div>
        <span className="ch-hint">{landingCopy.stemsHint}</span>
      </div>
    </ScreenCard>
  );
}
