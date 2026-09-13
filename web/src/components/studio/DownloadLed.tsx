const BUSY_COLOR = "#f97316";
const BUSY_GLOW = "#fdba74";

interface DownloadLedProps {
  /** True while the stem's WAV is being fetched. */
  active: boolean;
  /** The LED's resting color when nothing is downloading — distinct per amp. */
  idleColor: string;
  idleGlow: string;
  size?: number;
}

/** Save/download indicator light: lit in the amp's own color at rest, switches to a shared "busy" amber while downloading. */
export function DownloadLed({ active, idleColor, idleGlow, size = 7 }: DownloadLedProps) {
  const color = active ? BUSY_COLOR : idleColor;
  const glow = active ? BUSY_GLOW : idleGlow;
  return (
    <div
      className="rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${glow}, ${color} 70%)`,
        boxShadow: `0 0 ${Math.max(4, size)}px ${color}`,
      }}
    />
  );
}
