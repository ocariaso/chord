interface ScreenCardProps {
  maxWidth?: number;
  children: React.ReactNode;
}

/** The `.ch-app` card every screen sits on, with the design's radius, ring and shadow. */
export function ScreenCard({ maxWidth, children }: ScreenCardProps) {
  return (
    <div
      className="ch-app"
      style={{
        maxWidth,
        borderRadius: 10,
        boxShadow: "0 0 0 1px var(--color-neutral-800), 0 18px 44px rgba(0, 0, 0, 0.5)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
