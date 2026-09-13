import { gainToDb } from "../utils/levels";

export interface IirCoefficients {
  feedforward: number[];
  feedback: number[];
}

/**
 * ITU-R BS.1770 K-weighting (a high shelf, then the RLB high-pass) for any sample rate. The spec
 * tabulates coefficients only at 48 kHz; this is libebur128's bilinear-transform derivation.
 */
export function kWeightingFilters(sampleRate: number): { shelf: IirCoefficients; highPass: IirCoefficients } {
  const shelfGainDb = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = 10 ** (shelfGainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;

  const highPassQ = 0.5003270373238773;
  const highPassK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const highPassA0 = 1 + highPassK / highPassQ + highPassK * highPassK;

  return {
    shelf: {
      feedforward: [
        (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
        (2 * (shelfK * shelfK - vh)) / shelfA0,
        (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
      ],
      feedback: [1, (2 * (shelfK * shelfK - 1)) / shelfA0, (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0],
    },
    highPass: {
      feedforward: [1, -2, 1],
      feedback: [
        1,
        (2 * (highPassK * highPassK - 1)) / highPassA0,
        (1 - highPassK / highPassQ + highPassK * highPassK) / highPassA0,
      ],
    },
  };
}

export function peakOf(samples: Float32Array, from = 0): number {
  let peak = 0;
  for (let i = from; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

export function meanSquareOf(samples: Float32Array, from: number): number {
  let sum = 0;
  for (let i = from; i < samples.length; i++) sum += samples[i] * samples[i];
  return sum / Math.max(1, samples.length - from);
}

const TRUE_PEAK_TAPS = 12;
const TRUE_PEAK_LEAD = 5; // taps before the sample being interpolated from
const TRUE_PEAK_WINDOW_HALF_WIDTH = 6.5;

// Hann-windowed sinc kernels for the three in-between positions of 4× oversampling, each
// normalized to unity DC gain. Enough for a display to track inter-sample peaks to a fraction of a dB.
const TRUE_PEAK_KERNELS = [0.25, 0.5, 0.75].map((fraction) => {
  const kernel = new Float32Array(TRUE_PEAK_TAPS);
  let sum = 0;
  for (let tap = 0; tap < TRUE_PEAK_TAPS; tap++) {
    const t = tap - TRUE_PEAK_LEAD - fraction;
    const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
    const window = 0.5 * (1 + Math.cos((Math.PI * t) / TRUE_PEAK_WINDOW_HALF_WIDTH));
    kernel[tap] = sinc * window;
    sum += kernel[tap];
  }
  return kernel.map((value) => value / sum);
});

/** Sample peak including the 4×-oversampled positions between samples, over `samples[from…]`. */
export function truePeakOf(samples: Float32Array, from: number): number {
  let peak = 0;
  const last = samples.length - (TRUE_PEAK_TAPS - TRUE_PEAK_LEAD);
  for (let n = Math.max(from, TRUE_PEAK_LEAD); n < last; n++) {
    const sample = Math.abs(samples[n]);
    if (sample > peak) peak = sample;
    const base = n - TRUE_PEAK_LEAD;
    for (const kernel of TRUE_PEAK_KERNELS) {
      let interpolated = 0;
      for (let tap = 0; tap < TRUE_PEAK_TAPS; tap++) interpolated += samples[base + tap] * kernel[tap];
      const magnitude = Math.abs(interpolated);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

// Below this summed energy the two channels are effectively silent and correlation is noise.
const CORRELATION_ENERGY_FLOOR = 1e-6;

/** Pearson correlation of left against right: +1 mono, 0 unrelated, −1 out of phase. */
export function correlationOf(left: Float32Array, right: Float32Array): number | null {
  let cross = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let i = 0; i < left.length; i++) {
    cross += left[i] * right[i];
    leftEnergy += left[i] * left[i];
    rightEnergy += right[i] * right[i];
  }
  if (leftEnergy + rightEnergy < CORRELATION_ENERGY_FLOOR) return null;
  if (leftEnergy === 0 || rightEnergy === 0) return 0;
  return cross / Math.sqrt(leftEnergy * rightEnergy);
}

/** BS.1770 loudness from the per-channel mean squares of K-weighted audio (both channels weighted 1). */
export function loudnessFromMeanSquares(leftMeanSquare: number, rightMeanSquare: number): number {
  const sum = leftMeanSquare + rightMeanSquare;
  return sum > 0 ? -0.691 + 10 * Math.log10(sum) : -Infinity;
}

// A meter reading this far down is indistinguishable from silence, and reads "−∞".
const SILENCE_DB = -90;

/** Meter ballistics in dB: instant attack, a linear release in dB per second, and an optional hold. */
export class LevelFollower {
  private readonly releaseDbPerSecond: number;
  private readonly holdMs: number;
  private levelDb = -Infinity;
  private lastUpdate: number | null = null;
  private heldUntil = 0;

  constructor(releaseDbPerSecond: number, holdMs = 0) {
    this.releaseDbPerSecond = releaseDbPerSecond;
    this.holdMs = holdMs;
  }

  /** `now` in milliseconds, e.g. a requestAnimationFrame timestamp. */
  update(peak: number, now: number): number {
    const inputDb = gainToDb(peak);
    const elapsedSeconds = this.lastUpdate === null ? 0 : (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    if (inputDb >= this.levelDb) {
      this.levelDb = inputDb;
      this.heldUntil = now + this.holdMs;
    } else if (now >= this.heldUntil) {
      this.levelDb = Math.max(inputDb, this.levelDb - this.releaseDbPerSecond * elapsedSeconds);
    }
    if (this.levelDb < SILENCE_DB) this.levelDb = -Infinity;
    return this.levelDb;
  }
}

/** Exponential smoothing toward a moving value; `null` input (unmeasurable) leaves the value alone. */
export class Smoother {
  private readonly timeConstantMs: number;
  private current: number | null = null;
  private lastUpdate: number | null = null;

  constructor(timeConstantMs: number) {
    this.timeConstantMs = timeConstantMs;
  }

  update(value: number | null, now: number): number | null {
    const elapsed = this.lastUpdate === null ? 0 : now - this.lastUpdate;
    this.lastUpdate = now;
    if (value === null || !Number.isFinite(value)) {
      if (value === -Infinity) this.current = -Infinity;
      return this.current;
    }
    if (this.current === null || !Number.isFinite(this.current)) {
      this.current = value;
    } else {
      const blend = 1 - Math.exp(-elapsed / this.timeConstantMs);
      this.current += (value - this.current) * blend;
    }
    return this.current;
  }
}
