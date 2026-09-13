import { useId, useState } from "react";
import { saveLyrics, type Lyrics } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { dialogCopy } from "../../design/copy";

/** `sheet` is what Open lyric sheet opens; `edit` is what Add lyrics manually opens. */
export type LyricsDialogMode = "sheet" | "edit";

interface LyricsDialogProps {
  jobId: string;
  mode: LyricsDialogMode;
  lyrics: Lyrics | null | undefined;
  onSaved: (lyrics: Lyrics) => void;
  onClose: () => void;
}

const DIALOG_WIDTH = 560;

/** The dialogs behind the lyric row's two buttons. The template doesn't draw them, so they compose Nocturne's dialog and form classes. */
export function LyricsDialog({ jobId, mode, lyrics, onSaved, onClose }: LyricsDialogProps) {
  const formId = useId();
  const textareaId = useId();
  const [text, setText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      onSaved(await saveLyrics(jobId, text));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : dialogCopy.addLyrics.failedFallback);
    } finally {
      setIsSaving(false);
    }
  }

  if (mode === "sheet") {
    return (
      <Dialog
        title={dialogCopy.lyricSheet.title}
        width={DIALOG_WIDTH}
        onClose={onClose}
        actions={
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {dialogCopy.lyricSheet.close}
          </button>
        }
      >
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {/* pre-line keeps the lyrics' own line breaks. */}
          <span className="ch-lyric" style={{ whiteSpace: "pre-line" }}>
            {lyrics?.plain}
          </span>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={dialogCopy.addLyrics.title}
      width={DIALOG_WIDTH}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dialogCopy.addLyrics.cancel}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={isSaving || !text.trim()}>
            {isSaving ? dialogCopy.addLyrics.saving : dialogCopy.addLyrics.save}
          </button>
        </>
      }
    >
      <form id={formId} className="field flex flex-col" style={{ gap: "var(--space-3)" }} onSubmit={handleSave}>
        <label className="ch-label" htmlFor={textareaId}>
          {dialogCopy.addLyrics.label}
        </label>
        <textarea
          id={textareaId}
          className="input"
          data-autofocus
          rows={12}
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ fontSize: 12.5 }}
        />
        <span className="ch-hint">{dialogCopy.addLyrics.hint}</span>
        {error && (
          <div className="ch-alert" role="alert">
            <span className="ch-alert-head">
              <span className="ch-dot ch-dot-status" style={{ "--stem": "var(--ch-danger)" } as React.CSSProperties} />
              {dialogCopy.addLyrics.failedTitle}
            </span>
            <span className="ch-alert-body">{error}</span>
          </div>
        )}
      </form>
    </Dialog>
  );
}
