import { formatDb, mapThroughAnchors, type Anchors } from "../utils/levels";

/**
 * The template's state model — web/template/template/INSTRUCTIONS.md §3. The screens need exactly this
 * much player state; everything else (speed, loop, lyrics, dialogs) belongs to the results screen.
 */
export type StemKey = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

export interface StemState {
  key: StemKey;
  /** 0…1 UI position, not dB. */
  gain: number;
  muted: boolean;
  solo: boolean;
  /** 0…1 shelf tilt; 0.5 is flat. */
  tone: number;
  /** 0…1; 0.5 is centre. */
  pan: number;
}

export type ResultView = "mixer" | "console" | "analog";

export interface PlayerState {
  view: ResultView;
  playing: boolean;
  /** Seconds. */
  time: number;
  /** Seconds. */
  duration: number;
  /** 0…1 UI position. */
  master: number;
  /** Semitones, MIN_TRANSPOSE…MAX_TRANSPOSE. */
  transpose: number;
  metronome: boolean;
  stems: StemState[];
}

// ±11 rather than ±12: twelve semitones is the same pitch class and would read identically to 0.
export const MIN_TRANSPOSE = -11;
export const MAX_TRANSPOSE = 11;

// Derived, never stored.

/**
 * The span of the template's db(). Its demo maps 0…1 linearly onto −12…0 dB and asks for the audio graph's
 * own taper instead; this one spans 36 dB with the bottom silent, the scale the Console strips' 0 / −12 /
 * −24 / −∞ ticks are spaced for.
 */
export const FADER_RANGE_DB = 36;

/** The template's db(): a stem control's UI position → dB. */
export function db(v: number): number {
  return v <= 0 ? -Infinity : (v - 1) * FADER_RANGE_DB;
}

/** The master strip's 0 / −6 / −18 / −∞ ticks as [position, dB] — the master fader's taper. */
const MASTER_TICKS: Anchors = [
  [0, -FADER_RANGE_DB],
  [1 / 3, -18],
  [2 / 3, -6],
  [1, 0],
];

/** db() for the master fader, which follows its own strip's ticks. */
export function masterDb(v: number): number {
  return v <= 0 ? -Infinity : mapThroughAnchors(v, MASTER_TICKS);
}

/** The template's fmtDb(): "−∞" when muted, otherwise one decimal with a real minus sign. */
export function fmtDb(v: number, muted: boolean): string {
  return formatDb(muted ? -Infinity : db(v));
}

/** The template's audible(): not muted, and either nothing is soloed or this stem is. */
export function audible(stem: StemState, anySolo: boolean): boolean {
  return !stem.muted && (!anySolo || stem.solo);
}

/** dB → a Console meter's fill, matching its stem strip's tick column. `!(value > first)` catches −∞. */
export const STEM_METER_SCALE: Anchors = [
  [-FADER_RANGE_DB, 0],
  [-24, 1 / 3],
  [-12, 2 / 3],
  [0, 1],
];

/** dB → the master meter's fill, read against the same ticks as the master fader. */
export const MASTER_METER_SCALE: Anchors = MASTER_TICKS.map(([position, value]) => [value, position] as const);
