import { useEffect, useState } from "react";
import { thumbnailUrl } from "../api/client";
import { extractDominantHue } from "../utils/dominantHue";

const RETRY_DELAYS_MS = [500, 1500, 3000];

/** The job's cover-art hue in OKLCH degrees, or null to fall back to the default accent. */
export function useAccentHue(jobId: string | null, hasThumbnail: boolean): number | null {
  // Keyed by job, so a different (or thumbnail-less) job reads as null without an effect-driven reset.
  const [result, setResult] = useState<{ jobId: string; hue: number | null } | null>(null);

  useEffect(() => {
    if (!jobId || !hasThumbnail) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // The thumbnail file can still be mid-write the instant has_thumbnail flips true, so a failed
    // read is retried a few times rather than permanently falling back to the default accent.
    async function attempt(retries: number) {
      const hue = await extractDominantHue(thumbnailUrl(jobId!));
      if (cancelled) return;
      if (hue !== null || retries >= RETRY_DELAYS_MS.length) {
        setResult({ jobId: jobId!, hue });
        return;
      }
      timer = setTimeout(() => void attempt(retries + 1), RETRY_DELAYS_MS[retries]);
    }
    void attempt(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, hasThumbnail]);

  const hue = jobId && hasThumbnail && result?.jobId === jobId ? result.hue : null;

  // --color-accent's var(--accent-hue) is resolved where --color-accent is declared (nocturne.css's
  // :root), so the override has to land on the real :root, not a nested element, for it to apply.
  useEffect(() => {
    const root = document.documentElement.style;
    if (hue !== null) root.setProperty("--accent-hue", String(hue));
    else root.removeProperty("--accent-hue");
  }, [hue]);

  return hue;
}
