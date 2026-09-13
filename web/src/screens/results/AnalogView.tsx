import { useRef } from "react";
import { LevelFollower, Smoother } from "../../audio/meters";
import { createMeterReadings, type MeterReadings } from "../../audio/playbackEngine";
import { resultsCopy } from "../../design/copy";
import { useAnimationFrame } from "../../hooks/useAnimationFrame";
import { formatDb, formatSigned, mapThroughAnchors } from "../../utils/levels";
import { AnalogModule } from "./AnalogModule";
import { NEEDLE_MID_DEGREES, NEEDLE_SWEEP_DEGREES, OUTPUT_DIALS, OutputDial, type DialScale } from "./OutputDial";
import type { StemControls, StemDisplay } from "./types";

type DialKey = keyof typeof OUTPUT_DIALS;

const DIAL_ORDER: DialKey[] = ["left", "right", "truePeak", "loudness", "correlation"];
const NEEDLE_RELEASE_DB_PER_SECOND = 20;
const TRUE_PEAK_HOLD_MS = 1500;
const LOUDNESS_SMOOTHING_MS = 300;
const CORRELATION_SMOOTHING_MS = 300;
const READOUT_INTERVAL_MS = 125;

interface AnalogViewProps {
  stems: StemDisplay[];
  controls: StemControls;
  readMeters: (target: MeterReadings, now: number) => void;
  /** Below 720px: horizontal modules stacked in a column instead of a row that scrolls sideways. */
  isPhone?: boolean;
}

function needleDegrees(value: number, scale: DialScale): number {
  const [low, mid, high] = scale.anchors;
  return mapThroughAnchors(value, [
    [low, -NEEDLE_SWEEP_DEGREES],
    [mid, NEEDLE_MID_DEGREES],
    [high, NEEDLE_SWEEP_DEGREES],
  ]);
}

/** The Analog view: five output dials above a row of knob modules. The dials bypass React (design.md#metering). */
export function AnalogView({ stems, controls, readMeters, isPhone = false }: AnalogViewProps) {
  const needles = useRef<Partial<Record<DialKey, SVGLineElement | null>>>({});
  const readouts = useRef<Partial<Record<DialKey, HTMLSpanElement | null>>>({});
  const readingsRef = useRef(createMeterReadings());
  const metersRef = useRef({
    left: new LevelFollower(NEEDLE_RELEASE_DB_PER_SECOND),
    right: new LevelFollower(NEEDLE_RELEASE_DB_PER_SECOND),
    truePeak: new LevelFollower(NEEDLE_RELEASE_DB_PER_SECOND, TRUE_PEAK_HOLD_MS),
    loudness: new Smoother(LOUDNESS_SMOOTHING_MS),
    correlation: new Smoother(CORRELATION_SMOOTHING_MS),
  });
  const lastReadoutRef = useRef(0);

  useAnimationFrame(true, (now) => {
    const readings = readingsRef.current;
    readMeters(readings, now);
    const meters = metersRef.current;
    // Correlation means nothing in silence, paused included: the readout says so and the needle rests at centre.
    const silent = readings.correlation === null;
    const values: Record<DialKey, number> = {
      left: meters.left.update(readings.master[0], now),
      right: meters.right.update(readings.master[1], now),
      truePeak: meters.truePeak.update(readings.truePeak, now),
      loudness: meters.loudness.update(readings.loudness, now) ?? -Infinity,
      correlation: meters.correlation.update(readings.correlation ?? 0, now) ?? 0,
    };

    for (const key of DIAL_ORDER) {
      needles.current[key]?.setAttribute("transform", `rotate(${needleDegrees(values[key], OUTPUT_DIALS[key]).toFixed(2)} 100 108)`);
    }

    if (now - lastReadoutRef.current < READOUT_INTERVAL_MS) return;
    lastReadoutRef.current = now;
    const text: Record<DialKey, string> = {
      left: `${formatDb(values.left)} dB`,
      right: `${formatDb(values.right)} dB`,
      truePeak: `${formatDb(values.truePeak)} dB`,
      loudness: formatDb(values.loudness),
      correlation: silent ? resultsCopy.noValue : formatSigned(values.correlation, 2),
    };
    for (const key of DIAL_ORDER) {
      const element = readouts.current[key];
      if (element) element.textContent = text[key];
    }
  });

  return (
    <div className="flex flex-1 flex-col">
      {/* A hairline under the dials instead of a panel around them: the results sit on the page ground, not in boxes. */}
      <div className="ch-section flex" style={{ gap: "var(--space-8)" }}>
        <div className="flex min-w-0 flex-1" style={{ gap: "var(--space-8)" }}>
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: "var(--space-4)" }}>
            <span className="ch-label">{resultsCopy.outputLevel}</span>
            <div
              className="ch-dial-scroll"
              style={{
                display: "grid",
                // The 180px floor keeps the in-SVG type at 9px or more; FitToPanel never lays the view out narrower.
                gridTemplateColumns: "repeat(5, minmax(180px, 1fr))",
                gap: "var(--space-6)",
                alignItems: "start",
              }}
            >
              {DIAL_ORDER.map((key) => (
                <OutputDial
                  key={key}
                  scale={OUTPUT_DIALS[key]}
                  needleRef={(element) => {
                    needles.current[key] = element;
                  }}
                  valueRef={(element) => {
                    readouts.current[key] = element;
                  }}
                  initialValue={key === "correlation" ? resultsCopy.noValue : key === "loudness" ? formatDb(-Infinity) : `${formatDb(-Infinity)} dB`}
                  restDegrees={key === "correlation" ? NEEDLE_MID_DEGREES : -NEEDLE_SWEEP_DEGREES}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* The transport's top hairline closes this section, so it draws none of its own. */}
      <div className="ch-section flex flex-1" style={{ boxShadow: "none" }}>
        <div className="ch-striprow" style={{ alignItems: isPhone ? undefined : "stretch" }}>
          {stems.map((stem) => (
            <AnalogModule key={stem.state.key} stem={stem} controls={controls} compact={isPhone} />
          ))}
        </div>
      </div>
    </div>
  );
}
