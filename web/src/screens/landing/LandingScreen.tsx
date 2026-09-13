import { useId, useRef, useState } from "react";
import { UploadIcon } from "../../components/icons";
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
    <div className="ch-alert w-full text-left" role="alert">
      <span className="ch-alert-head">
        <span className="ch-dot ch-dot-status" style={{ "--stem": "var(--ch-danger)" } as React.CSSProperties} />
        {title}
      </span>
      <span className="ch-alert-body">{body}</span>
    </div>
  );
}

/**
 * The template's landing screen — scenarios `upload`, `upload-submitting` and `upload-error` — at web and phone width.
 * Unlike the other screens it sits on the page ground rather than a `ScreenCard`: one centered column, vertically
 * centered in the space above the footer.
 */
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

  // A rejection is always newer than a server error: any submission that reaches the server clears it first.
  const alert = rejection ? { title: landingCopy.rejectedTitle, body: rejection.body } : error;
  const fontSize = isPhone ? 13.5 : 13;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col items-center justify-center"
      style={{ paddingBlock: isPhone ? "var(--space-3)" : "clamp(12px, 4vh, 56px)" }}
    >
      {/* Spacing follows the viewport's height, so a short window tightens the column instead of scrolling. */}
      <div
        className="flex w-full flex-col items-center text-center"
        style={{ maxWidth: 580, gap: isPhone ? "clamp(14px, 3vh, 28px)" : "clamp(18px, 4vh, 40px)" }}
      >
        <header className="flex flex-col items-center" style={{ gap: isPhone ? "var(--space-4)" : "var(--space-6)" }}>
          <span className="flex flex-col items-center" style={{ gap: 6 }}>
            <span style={{ font: "600 13px/1 var(--font-body)", letterSpacing: "0.32em", paddingLeft: "0.32em", color: "var(--color-text)" }}>
              {brand.name}
            </span>
            <span style={{ font: "400 11px/1.4 var(--font-body)", letterSpacing: "0.04em", color: "var(--color-neutral-500)" }}>
              {brand.expansion}
            </span>
          </span>
          <h1
            style={{
              margin: 0,
              font: isPhone ? "500 28px/1.18 var(--font-body)" : "500 44px/1.1 var(--font-body)",
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              textWrap: "balance",
            }}
          >
            {landingCopy.headline}
          </h1>
          {!isPhone && (
            <p
              style={{
                margin: 0,
                maxWidth: 500,
                font: "400 14.5px/1.65 var(--font-body)",
                color: "var(--color-neutral-400)",
                textWrap: "pretty",
              }}
            >
              {landingCopy.intro}
            </p>
          )}
        </header>

        <div className="flex w-full flex-col" style={{ gap: isPhone ? "var(--space-6)" : 20 }}>
          <div
            className={`ch-dropzone${isOver ? " is-over" : ""}${rejection ? " is-rejected" : ""}`}
            style={{ flexDirection: "column", textAlign: "center", padding: isPhone ? "28px var(--space-6)" : "36px var(--space-8)", gap: 14 }}
            // On phones there is no Choose file button, so the dropzone itself is the control.
            role={isPhone ? "button" : undefined}
            tabIndex={isPhone ? 0 : undefined}
            aria-disabled={isPhone ? busy : undefined}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (isPhone && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                openPicker();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsOver(true);
            }}
            onDragLeave={() => setIsOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsOver(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <span className="ch-dropicon">
              <UploadIcon />
            </span>
            <span className="flex min-w-0 flex-col items-center" style={{ gap: 6 }}>
              <span style={{ font: "500 15px/1.3 var(--font-body)", color: "var(--color-text)" }}>
                {rejection
                  ? landingCopy.rejectedDropTitle(rejection.fileName)
                  : isPhone
                    ? landingCopy.phoneDropTitle
                    : landingCopy.dropTitle}
              </span>
              <span style={{ font: "400 12px/1.45 var(--font-body)", color: "var(--color-neutral-500)", textWrap: "balance" }}>
                {rejection ? rejection.hint : isPhone ? landingCopy.phoneDropHint : landingCopy.dropHint}
              </span>
            </span>
            {!isPhone && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 6, fontSize: 13 }}
                disabled={busy}
                onClick={(event) => {
                  // The dropzone opens the picker too; one click shouldn't open it twice.
                  event.stopPropagation();
                  openPicker();
                }}
              >
                {submitting === "file" ? landingCopy.submitting : landingCopy.chooseFile}
              </button>
            )}
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
          </div>

          {!isPhone && (
            <div className="flex items-center" style={{ gap: 14 }}>
              <span className="ch-divider-y" style={{ flex: 1 }} />
              <span className="ch-label">{landingCopy.orPasteLink}</span>
              <span className="ch-divider-y" style={{ flex: 1 }} />
            </div>
          )}

          <form className="field flex flex-col text-left" style={{ gap: "var(--space-2)" }} onSubmit={handleUrlSubmit}>
            <label className="ch-label" htmlFor={urlId}>
              {landingCopy.urlLabel}
            </label>
            {/* The label sits above the row rather than beside the button, so input and button share one height. */}
            <div className={isPhone ? "flex flex-col" : "flex items-stretch"} style={{ gap: isPhone ? "var(--space-6)" : "var(--space-4)" }}>
              <input
                className="input min-w-0 flex-1"
                id={urlId}
                type="url"
                required
                placeholder={landingCopy.urlPlaceholder}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
                style={{ width: "100%", minHeight: isPhone ? 46 : 42, fontSize }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                style={isPhone ? { width: "100%", minHeight: 46, fontSize } : { flex: "none", paddingInline: 18, fontSize }}
                disabled={busy}
              >
                {(isPhone ? busy : submitting === "url") ? landingCopy.submitting : landingCopy.fetchTrack}
              </button>
            </div>
          </form>

          {alert && <Alert title={alert.title} body={alert.body} />}
        </div>

        <span className="ch-hint">{landingCopy.stemsHint}</span>
      </div>
    </section>
  );
}
