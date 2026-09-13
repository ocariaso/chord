import { useCallback, useEffect, useState } from "react";
import { getLyrics, type Lyrics } from "../api/client";

/**
 * undefined = still loading, null = confirmed no lyrics found, otherwise the fetched result.
 * The setter takes lyrics saved from the manual entry dialog.
 */
export function useLyrics(jobId: string): [Lyrics | null | undefined, (lyrics: Lyrics) => void] {
  // Keyed by job, so a different job reads as loading until its own lookup answers.
  const [result, setResult] = useState<{ jobId: string; lyrics: Lyrics | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLyrics(jobId)
      .then((lyrics) => {
        if (!cancelled) setResult({ jobId, lyrics });
      })
      .catch(() => {
        if (!cancelled) setResult({ jobId, lyrics: null });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const replaceLyrics = useCallback((lyrics: Lyrics) => setResult({ jobId, lyrics }), [jobId]);

  return [result?.jobId === jobId ? result.lyrics : undefined, replaceLyrics];
}
