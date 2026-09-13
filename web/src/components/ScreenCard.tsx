interface ScreenCardProps {
  maxWidth?: number;
  /** Grow to the height the page gives it, so the screen inside shares that height out instead of overflowing. */
  fill?: boolean;
  children: React.ReactNode;
}

/** The `.ch-app` card the results screen sits on, with the design's radius, ring and shadow. */
export function ScreenCard({ maxWidth, fill = false, children }: ScreenCardProps) {
  return (
    <div
      className="ch-app"
      style={{
        maxWidth,
        flex: fill ? "1 1 0" : undefined,
        minHeight: fill ? 0 : undefined,
        borderRadius: 10,
        boxShadow: "0 0 0 1px var(--color-neutral-800), 0 18px 44px rgba(0, 0, 0, 0.5)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
