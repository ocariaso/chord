import { useId } from "react";
import { LevelRing } from "./LevelRing";
import { useKnobDrag, valueToRotation } from "./useKnobDrag";

interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  size?: number;
  label?: string;
  labelColor?: string;
  /** Chrome tone, light -> mid -> shadow. */
  stops: [string, string, string];
  pointerColor?: string;
  /** Recessed dark socket behind a dashed ribbed ring, like the Guitar amp. */
  ribbed?: boolean;
  disabled?: boolean;
  /** Green-to-red level ring around the face, like the Master gain knob. */
  ring?: boolean;
}

export function Knob({
  value,
  onChange,
  size = 26,
  label,
  labelColor = "#8a8a8e",
  stops,
  pointerColor = "#1a1a1a",
  ribbed = false,
  disabled = false,
  ring = false,
}: KnobProps) {
  const gradId = useId();
  const drag = useKnobDrag(value, onChange);
  const rotation = valueToRotation(value);
  const faceR = ribbed ? 15 : 19;
  const socketR = 22;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        viewBox="0 0 56 56"
        width={size}
        height={size}
        className={disabled ? "" : "cursor-ns-resize touch-none"}
        {...(disabled ? {} : drag)}
      >
        {ring && <LevelRing value={value} />}
        {ribbed && (
          <>
            <circle cx={28} cy={28} r={socketR} fill="#0a0a0a" />
            <circle cx={28} cy={28} r={socketR} fill="none" stroke="#000" strokeWidth={0.8} strokeDasharray="1.6,3" />
          </>
        )}
        <circle cx={28} cy={28} r={faceR} fill={`url(#${gradId})`} stroke={ribbed ? "#3a3a3e" : "#5a5a5e"} strokeWidth={ribbed ? 1 : 1.2} />
        <line
          x1={28}
          y1={28}
          x2={28}
          y2={28 - (faceR - 3)}
          stroke={pointerColor}
          strokeWidth={2}
          strokeLinecap="round"
          transform={`rotate(${rotation} 28 28)`}
        />
        <defs>
          <radialGradient id={gradId} cx="35%" cy="28%" r="70%">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="55%" stopColor={stops[1]} />
            <stop offset="100%" stopColor={stops[2]} />
          </radialGradient>
        </defs>
      </svg>
      {label && (
        <span className="font-['Oswald'] text-[6px] uppercase tracking-wide" style={{ color: labelColor }}>
          {label}
        </span>
      )}
    </div>
  );
}
