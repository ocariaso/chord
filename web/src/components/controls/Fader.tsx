import { useSliderControl } from "../../hooks/useSliderControl";

interface FaderProps {
  value: number;
  onChange: (value: number) => void;
  /** The accessible name, carrying the stem and the current value. */
  label: string;
  valueText: string;
}

function ariaValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `.ch-fader` — horizontal gain, positioned by `--v` alone. */
export function Fader({ value, onChange, label, valueText, thin = false }: FaderProps & { thin?: boolean }) {
  const handlers = useSliderControl({ value, onChange, axis: "horizontal" });
  return (
    <span
      className={thin ? "ch-fader ch-fader-thin" : "ch-fader"}
      style={{ "--v": value } as React.CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={ariaValue(value)}
      aria-valuetext={valueText}
      {...handlers}
    />
  );
}

/** `.ch-vfader` — the console strip's vertical fader; its one child is the cap. */
export function VerticalFader({ value, onChange, label, valueText }: FaderProps) {
  const handlers = useSliderControl({ value, onChange, axis: "vertical" });
  return (
    <span
      className="ch-vfader"
      style={{ "--v": value } as React.CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={ariaValue(value)}
      aria-valuetext={valueText}
      {...handlers}
    >
      <span />
    </span>
  );
}
