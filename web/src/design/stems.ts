import { stemNames } from "./copy";
import type { StemKey } from "./player";

/** The template's six stems in its order, which is also the API's STEM_NAMES order. */
export const STEM_KEYS: readonly StemKey[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];

// Where each stem's Tone knob tilts: near the middle of the range that instrument mostly occupies.
const TONE_PIVOT_HZ: Record<StemKey, number> = {
  vocals: 1500,
  drums: 2000,
  bass: 250,
  guitar: 1200,
  piano: 1000,
  other: 1000,
};

// Written out rather than built from the key, so the design check sees every token the stems use.
const STEM_HUES: Record<StemKey, string> = {
  vocals: "var(--ch-vocals)",
  drums: "var(--ch-drums)",
  bass: "var(--ch-bass)",
  guitar: "var(--ch-guitar)",
  piano: "var(--ch-piano)",
  other: "var(--ch-other)",
};

/**
 * The job's stems the template has an identity for, in its order. A stem outside the six has no name or
 * hue in the design, so it isn't loaded at all — change STEM_KEYS together with the Demucs model.
 */
export function templateStems(names: readonly string[]): StemKey[] {
  return STEM_KEYS.filter((key) => names.includes(key));
}

export function stemName(key: StemKey): string {
  return stemNames[key];
}

/** A `--stem` value: the stem's hue token from chord-theme.css. */
export function stemHue(key: StemKey): string {
  return STEM_HUES[key];
}

export function tonePivotHz(key: StemKey): number {
  return TONE_PIVOT_HZ[key];
}
