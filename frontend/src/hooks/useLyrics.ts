import { useEffect, useState } from "react";
import { getLyrics, type Lyrics } from "../api/client";

/** undefined = still loading, null = confirmed no lyrics found, otherwise the fetched result. */
export function useLyrics(jobId: string): Lyrics | null | undefined {
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLyrics(undefined);
    getLyrics(jobId)
      .then((result) => {
        if (!cancelled) setLyrics(result);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return lyrics;
}
