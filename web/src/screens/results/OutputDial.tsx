import { resultsCopy } from "../../design/copy";

export interface DialScale {
  label: string;
  /** Scale values at the dial's left end, at its mid label and at its right end. */
  anchors: readonly [number, number, number];
  tickLabels: readonly [string, string, string];
  /** The accent arc marking the top of the scale, as the design draws it for this dial. */
  accentArc: string;
}

const LEVEL_ACCENT_ARC = "M173.0 58.8 A88 88 0 0 1 182.7 77.9";

/** The design's five dials: labels, scale labels and accent arcs, with the values the labels stand for. */
export const OUTPUT_DIALS = {
  left: { label: resultsCopy.dials.left, anchors: [-40, -12, 0], tickLabels: ["−40", "−12", "0"], accentArc: LEVEL_ACCENT_ARC },
  right: { label: resultsCopy.dials.right, anchors: [-40, -12, 0], tickLabels: ["−40", "−12", "0"], accentArc: LEVEL_ACCENT_ARC },
  truePeak: { label: resultsCopy.dials.truePeak, anchors: [-24, -9, 0], tickLabels: ["−24", "−9", "0"], accentArc: LEVEL_ACCENT_ARC },
  loudness: {
    label: resultsCopy.dials.loudness,
    anchors: [-36, -23, -9],
    tickLabels: ["−36", "−23", "−9"],
    accentArc: "M156.6 40.6 A88 88 0 0 1 182.7 77.9",
  },
  correlation: {
    label: resultsCopy.dials.correlation,
    anchors: [-1, 0, 1],
    tickLabels: ["−1", "0", "+1"],
    accentArc: "M144.0 31.8 A88 88 0 0 1 182.7 77.9",
  },
} as const satisfies Record<string, DialScale>;

/** The needle sweeps ±70°; the mid label sits 10° left of centre (design.md#metering). */
export const NEEDLE_SWEEP_DEGREES = 70;
export const NEEDLE_MID_DEGREES = -10;

const MAJOR_TICKS = [
  "M17.3 77.9 L29.5 82.3",
  "M32.6 51.4 L42.5 59.8",
  "M56.0 31.8 L62.5 43.0",
  "M84.7 21.3 L87.0 34.1",
  "M115.3 21.3 L113.0 34.1",
  "M144.0 31.8 L137.5 43.0",
  "M167.4 51.4 L157.5 59.8",
  "M182.7 77.9 L170.5 82.3",
];
const MINOR_TICKS = [
  "M23.8 64.0 L30.7 68.0",
  "M43.4 40.6 L48.6 46.7",
  "M69.9 25.3 L72.6 32.8",
  "M100.0 20.0 L100.0 28.0",
  "M130.1 25.3 L127.4 32.8",
  "M156.6 40.6 L151.4 46.7",
  "M176.2 64.0 L169.3 68.0",
];

interface OutputDialProps {
  scale: DialScale;
  needleRef: (element: SVGLineElement | null) => void;
  valueRef: (element: HTMLSpanElement | null) => void;
  /** What the readout shows before the first measurement; later values are written straight to the DOM. */
  initialValue: string;
  /** Where the needle rests before the first measurement. */
  restDegrees: number;
}

/** One needle meter on the template's 200×140 viewBox, pivoting at (100, 108). SVG colors go through `style` so they take tokens. */
export function OutputDial({ scale, needleRef, valueRef, initialValue, restDegrees }: OutputDialProps) {
  const text = { fill: "var(--color-neutral-500)", fontFamily: "var(--font-body)" };
  return (
    <span className="flex min-w-0 flex-col items-center" style={{ gap: 6 }}>
      <svg viewBox="0 0 200 140" style={{ width: "100%", height: "auto" }} aria-hidden="true">
        <path d="M17.3 77.9 A88 88 0 0 1 182.7 77.9" fill="none" strokeWidth={1.4} style={{ stroke: "var(--color-neutral-800)" }} />
        <path d={scale.accentArc} fill="none" strokeWidth={2.4} style={{ stroke: "var(--color-accent)" }} />
        <g strokeWidth={2.2} strokeLinecap="round" style={{ stroke: "var(--color-neutral-400)" }}>
          {MAJOR_TICKS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g strokeWidth={1.5} style={{ stroke: "var(--color-neutral-700)" }}>
          {MINOR_TICKS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <text x="39.9" y="91.1" textAnchor="start" fontSize="13" style={text}>
          {scale.tickLabels[0]}
        </text>
        <text x="88.9" y="49.0" textAnchor="middle" fontSize="13" style={text}>
          {scale.tickLabels[1]}
        </text>
        <text x="160.1" y="91.1" textAnchor="end" fontSize="13" style={text}>
          {scale.tickLabels[2]}
        </text>
        <line
          ref={needleRef}
          x1="100"
          y1="108"
          x2="100"
          y2="34"
          strokeWidth={3.2}
          strokeLinecap="round"
          transform={`rotate(${restDegrees} 100 108)`}
          style={{ stroke: "var(--color-neutral-200)" }}
        />
        <circle cx="100" cy="108" r="7" style={{ fill: "var(--color-neutral-400)" }} />
        <circle cx="100" cy="108" r="2.5" style={{ fill: "var(--color-bg)" }} />
      </svg>
      <span className="flex flex-col items-center" style={{ gap: 3 }}>
        <span className="ch-label">{scale.label}</span>
        <span ref={valueRef} className="ch-value">
          {initialValue}
        </span>
      </span>
    </span>
  );
}
