import { useState } from "react";
import { thumbnailUrl } from "../api/client";

interface CoverArtProps {
  jobId: string;
  hasThumbnail: boolean;
  size: number;
  radius: number;
  /** The hairline edge; the mobile tiles are drawn without one. */
  outlined?: boolean;
}

/** The accent-gradient tile, with the track's artwork blended in through Nocturne's `.lighten` when there is some. */
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
      {hasThumbnail && !failed && (
        <img
          src={thumbnailUrl(jobId)}
          alt=""
          className="lighten size-full object-cover"
          onError={() => setFailed(true)}
        />
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
