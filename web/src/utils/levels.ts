/** A real minus sign: a hyphen is narrower and knocks readouts off the tabular-numeral grid. */
export const MINUS = "−";

export function dbToGain(db: number): number {
  return db === -Infinity ? 0 : 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** "−9.0", "0.0" or "−∞". */
export function formatDb(db: number, digits = 1): string {
  if (db === -Infinity) return `${MINUS}∞`;
  const rounded = Number(db.toFixed(digits));
  // Number() folds "-0.0" into -0, which `< 0` treats as zero, so a near-unity level reads "0.0".
  return `${rounded < 0 ? MINUS : ""}${Math.abs(rounded).toFixed(digits)}`;
}

/** "+0.82" / "−0.50" — for values whose sign carries meaning either way. */
export function formatSigned(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? "+" : MINUS}${Math.abs(rounded).toFixed(digits)}`;
}

export type Anchors = readonly (readonly [number, number])[];

/** Piecewise-linear map through ascending [input, output] anchors, clamped at both ends. */
export function mapThroughAnchors(value: number, anchors: Anchors): number {
  const [firstIn, firstOut] = anchors[0];
  if (!(value > firstIn)) return firstOut;
  for (let i = 1; i < anchors.length; i++) {
    const [toIn, toOut] = anchors[i];
    if (value <= toIn) {
      const [fromIn, fromOut] = anchors[i - 1];
      return fromOut + ((value - fromIn) / (toIn - fromIn)) * (toOut - fromOut);
    }
  }
  return anchors[anchors.length - 1][1];
}

export const PAN_CENTER = 0.5;

/** 0…1 knob position → −1…1 for a StereoPannerNode. */
export function panToStereo(pan: number): number {
  return (pan - PAN_CENTER) * 2;
}

/** "C", "L14", "R8" — the offset from centre in percent of a full side. */
export function formatPan(pan: number): string {
  const offset = Math.round((pan - PAN_CENTER) * 100);
  if (offset === 0) return "C";
  return offset < 0 ? `L${-offset}` : `R${offset}`;
}

export const TONE_FLAT = 0.5;
/** The Tone knob tilts around a pivot: its extremes shelve highs by ±6 dB and lows by the opposite. */
export const TONE_RANGE_DB = 6;

export function toneToShelfDb(tone: number): number {
  return (tone - TONE_FLAT) * 2 * TONE_RANGE_DB;
}

export function formatTone(tone: number): string {
  return `${formatSigned(toneToShelfDb(tone), 1)} dB`;
}
