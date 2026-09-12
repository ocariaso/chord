import { useState } from "react";
import { downloadFile } from "../../utils/download";

export function useDownload(href: string, filename: string) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function download() {
    setIsDownloading(true);
    try {
      await downloadFile(href, filename);
    } catch {
      // The download simply won't start; nothing else to recover here.
    } finally {
      setIsDownloading(false);
    }
  }

  return { isDownloading, download };
}
