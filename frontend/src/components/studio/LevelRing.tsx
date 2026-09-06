import { useId } from "react";

export const RING_RADIUS = 25;
const RING_STROKE = 4;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_SWEEP = RING_CIRCUMFERENCE * (270 / 360);

/** Green-to-red level ring, expects to be drawn inside a 56x56 viewBox centered at (28,28). */
export function LevelRing({ value }: { value: number }) {
  const ringId = useId();
  return (
    <>
      <circle cx={28} cy={28} r={RING_RADIUS} fill="none" stroke="#0d0d0d" strokeWidth={RING_STROKE} />
      <circle
        cx={28}
        cy={28}
        r={RING_RADIUS}
        fill="none"
        stroke={`url(#${ringId})`}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${value * RING_SWEEP} ${RING_CIRCUMFERENCE}`}
        strokeLinecap="round"
        transform="rotate(126 28 28)"
      />
      <defs>
        <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="70%" stopColor="#eab308" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
    </>
  );
}
