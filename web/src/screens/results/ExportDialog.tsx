import { useState } from "react";
import { downloadAllUrl, stemUrl } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { dialogCopy } from "../../design/copy";
import { downloadFile } from "../../utils/download";
import type { StemDisplay } from "./types";

interface ExportDialogProps {
  jobId: string;
  trackTitle: string;
  stems: StemDisplay[];
  onClose: () => void;
}

const ZIP_KEY = "zip";

/** The track title without an upload's audio extension, for naming saved files. */
function baseName(title: string): string {
  return title.replace(/\.(mp3|flac)$/i, "");
}

/** What Export stems opens. The template doesn't draw it, so it composes Nocturne's dialog with the template's stem rows. */
export function ExportDialog({ jobId, trackTitle, stems, onClose }: ExportDialogProps) {
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const name = baseName(trackTitle);

  async function download(key: string, url: string, filename: string) {
    setInFlight((current) => new Set(current).add(key));
    setFailed(false);
    try {
      await downloadFile(url, filename);
    } catch {
      setFailed(true);
    } finally {
      setInFlight((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <Dialog
      title={dialogCopy.export.title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {dialogCopy.export.close}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={inFlight.has(ZIP_KEY)}
            onClick={() => void download(ZIP_KEY, downloadAllUrl(jobId), `${name}_stems.zip`)}
          >
            {inFlight.has(ZIP_KEY) ? dialogCopy.export.preparingZip : dialogCopy.export.downloadAll}
          </button>
        </>
      }
    >
      <div className="flex flex-col">
        <span className="ch-hint" style={{ paddingBottom: "var(--space-3)" }}>
          {dialogCopy.export.hint}
        </span>
        {stems.map((stem) => (
          <div key={stem.state.key} className="ch-stemrow" style={{ "--stem": stem.hue } as React.CSSProperties}>
            <span className="ch-stemrow-name">
              <span className="ch-dot" />
              <span style={{ color: "var(--color-text)" }}>{stem.name}</span>
            </span>
            <span className="ch-value-sm" style={{ flex: 1 }}>
              {dialogCopy.export.format}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11.5 }}
              aria-label={dialogCopy.export.downloadLabel(stem.name)}
              disabled={inFlight.has(stem.state.key)}
              onClick={() => void download(stem.state.key, stemUrl(jobId, stem.state.key), `${name} - ${stem.state.key}.wav`)}
            >
              {inFlight.has(stem.state.key) ? dialogCopy.export.saving : dialogCopy.export.download}
            </button>
          </div>
        ))}
        {failed && (
          <span className="ch-hint" role="alert" style={{ paddingTop: "var(--space-3)" }}>
            {dialogCopy.export.failed}
          </span>
        )}
      </div>
    </Dialog>
  );
}
