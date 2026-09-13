import { useSliderControl } from "../../hooks/useSliderControl";

interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  /** The accessible name, carrying the stem and the current value. */
  label: string;
  valueText: string;
  /** `.ch-knob-sm`, the 34px Tone/Pan size. */
  small?: boolean;
  /** Overrides `--stem`: INSTRUCTIONS §4.3 gives the small knobs `var(--color-neutral-700)`. */
  hue?: string;
}

/** `.ch-knob` — dragged vertically; the cap, pointer and value arc are all drawn by the class from `--v`. */
export function Knob({ value, onChange, label, valueText, small = false, hue }: KnobProps) {
  const handlers = useSliderControl({ value, onChange, axis: "knob" });
  const style = { "--v": value, ...(hue ? { "--stem": hue } : {}) } as React.CSSProperties;
  return (
    <span
      className={small ? "ch-knob ch-knob-sm" : "ch-knob"}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={valueText}
      {...handlers}
    >
      <span />
    </span>
  );
}
