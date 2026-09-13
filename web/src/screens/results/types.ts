import type { StemKey, StemState } from "../../design/player";

/** One stem as the views draw it: its template state, plus what the results screen derives from it. */
export interface StemDisplay {
  state: StemState;
  name: string;
  /** A `--stem` value. */
  hue: string;
  /** The template's audible(): heard right now. */
  audible: boolean;
  /** An instrumental's vocals: present, but near-silent. */
  silent: boolean;
  /** A CSS polygon() of the stem's waveform. */
  envelope: string | null;
}

/** The per-stem callbacks every view receives. */
export interface StemControls {
  onGainChange: (key: StemKey, gain: number) => void;
  onToggleMute: (key: StemKey) => void;
  onToggleSolo: (key: StemKey) => void;
  onToneChange: (key: StemKey, tone: number) => void;
  onPanChange: (key: StemKey, pan: number) => void;
}

/** A loop being set: `end` is null between the first press (A) and the second (B). */
export interface LoopState {
  start: number;
  end: number | null;
}
