const EQ_BAR_DELAYS = ["0ms", "160ms", "80ms", "240ms"];

export function EqualizerBars({ color, className = "h-3.5" }: { color: string; className?: string }) {
  return (
    <div className={`flex items-end gap-0.5 ${className}`}>
      {EQ_BAR_DELAYS.map((delay, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full"
          style={{
            height: "100%",
            backgroundColor: color,
            transformOrigin: "bottom",
            animation: `eq-bounce 900ms ease-in-out ${delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function MusicNoteIcon({ color, className = "h-10 w-10" }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} className={className}>
      <circle cx="7" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
      <path d="M10 18V5.5L20 3v13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
