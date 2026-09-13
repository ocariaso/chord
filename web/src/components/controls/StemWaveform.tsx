interface StemWaveformProps {
  /** A CSS polygon() traced from the decoded stem. */
  envelope: string | null;
  /** Dimmed while the stem isn't heard. */
  off: boolean;
  /** 0…1 playback position. */
  playhead: number;
}

/** `.ch-wave`, clipped to the stem's real envelope in place of the stylesheet's placeholder shapes (design.md#classes), under the playhead. */
export function StemWaveform({ envelope, off, playhead }: StemWaveformProps) {
  return (
    // The clip-path would cut the playhead away, so it sits beside the wave in a wrapper. The wrapper takes over the
    // stylesheet's phone rule for .ch-wave (last, on a line of its own); with no other row child ordered on the web,
    // order and a full basis change nothing there.
    <span className="relative order-5 flex min-w-0 flex-[1_1_100%]" aria-hidden="true">
      <span className={off ? "ch-wave is-off" : "ch-wave"} style={{ clipPath: envelope ?? undefined }} />
      <span className="ch-playhead" style={{ "--p": playhead } as React.CSSProperties} />
    </span>
  );
}
