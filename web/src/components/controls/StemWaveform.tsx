interface StemWaveformProps {
  /** A CSS polygon() traced from the decoded stem. */
  envelope: string | null;
  /** Dimmed while the stem isn't heard. */
  off: boolean;
}

/** `.ch-wave`, clipped to the stem's real envelope in place of the template's placeholder shapes (INSTRUCTIONS §8). */
export function StemWaveform({ envelope, off }: StemWaveformProps) {
  return (
    <span
      className={off ? "ch-wave is-off" : "ch-wave"}
      style={{ clipPath: envelope ?? undefined }}
      aria-hidden="true"
    />
  );
}
