import { useState } from "react";
import { thumbnailUrl } from "../api/client";
import { MusicNoteIcon } from "./icons";

interface CoverArtProps {
  jobId: string;
  hasThumbnail: boolean;
  size: number;
  radius: number;
  /** The hairline edge; the mobile tiles are drawn without one. */
  outlined?: boolean;
}

/** The accent-gradient tile: the track's artwork drawn plainly on top, or a music-note mark before it's there. */
export function CoverArt({ jobId, hasThumbnail, size, radius, outlined = true }: CoverArtProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative flex-none overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(150deg, var(--color-accent-800), var(--color-accent-900))",
      }}
    >
      {hasThumbnail && !failed ? (
        <img
          src={thumbnailUrl(jobId)}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex size-full items-center justify-center"
          style={{ color: "var(--color-accent-200)" }}
        >
          <MusicNoteIcon size={Math.round(size * 0.4)} />
        </span>
      )}
      {outlined && (
        <span
          className="pointer-events-none absolute inset-0"
          style={{ borderRadius: "inherit", boxShadow: "inset 0 0 0 1px var(--color-neutral-800)" }}
        />
      )}
    </span>
  );
}
