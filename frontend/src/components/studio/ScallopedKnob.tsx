import { useId } from "react";
import { LevelRing } from "./LevelRing";
import { useKnobDrag, valueToRotation } from "./useKnobDrag";

interface ScallopedKnobProps {
  value: number;
  onChange: (value: number) => void;
  size?: number;
  label?: string;
  disabled?: boolean;
  /** Green-to-red level ring around the face, like the Master gain knob. */
  ring?: boolean;
}

/** The Bass amp's distinct two-layer scalloped chrome knob — kept separate from Knob.tsx so Bass's own identity isn't reused elsewhere. */
export function ScallopedKnob({ value, onChange, size = 38, label, disabled = false, ring = false }: ScallopedKnobProps) {
  const outerId = useId();
  const topId = useId();
  const drag = useKnobDrag(value, onChange);
  const rotation = valueToRotation(value);

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
        <g transform="translate(6,6)">
          <circle cx={22} cy={22} r={19} fill="none" stroke="#9a9aa0" strokeWidth={1} />
          <circle cx={22} cy={22} r={18} fill={`url(#${outerId})`} />
          <circle cx={22} cy={22} r={18} fill="none" stroke="#000" strokeWidth={0.5} strokeDasharray="1.5,2.8" />
          <circle cx={22} cy={22} r={11} fill={`url(#${topId})`} stroke="#2a2a2a" strokeWidth={1} />
          <line
            x1={22}
            y1={22}
            x2={22}
            y2={13}
            stroke="#1a1a1a"
            strokeWidth={1.6}
            strokeLinecap="round"
            transform={`rotate(${rotation} 22 22)`}
          />
        </g>
        <defs>
          <radialGradient id={outerId} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#f5f5f7" />
            <stop offset="60%" stopColor="#c4c4c8" />
            <stop offset="100%" stopColor="#8a8a8e" />
          </radialGradient>
          <radialGradient id={topId} cx="35%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#e8e8ec" />
            <stop offset="60%" stopColor="#b6b6ba" />
            <stop offset="100%" stopColor="#8a8a8e" />
          </radialGradient>
        </defs>
      </svg>
      {label && <span className="font-['Oswald'] text-[6px] uppercase tracking-wide text-[#3a3a3e]">{label}</span>}
    </div>
  );
}
