/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */

// Pitch-preserving time stretch for every stem at once, by WSOLA (waveform-similarity overlap-add).
// All stems are cut and overlap-added at the same input positions, chosen by similarity on a
// gain-weighted mix of them, so the stems stay sample-aligned with each other at any speed.
//
// The processor holds no song: it asks the main thread for one-second blocks of input around where
// it is about to read ("need"), keeps a handful, and plays silence over any block that hasn't
// arrived yet. Plain JavaScript because it runs in AudioWorkletGlobalScope, loaded by URL.

const FRAME_SECONDS = 0.06;
const SEEK_SECONDS = 0.015;
const COARSE_STEP = 4;
const LOOKAHEAD_SECONDS = 3;
const REQUEST_EVERY_HOPS = 8;
const RE_REQUEST_AFTER_SECONDS = 1;
const MAX_CACHED_BLOCKS = 12;
const ENERGY_EPSILON = 1e-9;

class StretchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { stemCount, blockSize, trackLength } = options.processorOptions;
    this.stemCount = stemCount;
    this.channelCount = stemCount * 2;
    this.blockSize = blockSize;
    this.trackLength = trackLength;

    this.hop = Math.round((FRAME_SECONDS * sampleRate) / 2);
    this.frameLength = this.hop * 2;
    this.seek = Math.round(SEEK_SECONDS * sampleRate);
    // Periodic Hann: two copies offset by half a frame sum to exactly one.
    this.window = new Float32Array(this.frameLength);
    for (let i = 0; i < this.frameLength; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frameLength);
    }

    this.blocks = new Map();
    this.requested = new Map();
    this.needed = new Set();
    this.weights = new Float32Array(stemCount).fill(1);

    this.tails = Array.from({ length: this.channelCount }, () => new Float32Array(this.hop));
    this.hopOutput = Array.from({ length: this.channelCount }, () => new Float32Array(this.hop));
    this.frame = new Float32Array(this.frameLength);
    this.natural = new Float32Array(this.hop);
    this.candidates = new Float32Array(this.hop + 2 * this.seek);
    this.candidateEnergy = new Float64Array(this.hop + 2 * this.seek + 1);
    this.scratch = new Float32Array(this.hop + 2 * this.seek);

    this.playing = false;
    this.outputPosition = this.hop;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(message) {
    switch (message.type) {
      case "blocks":
        for (const block of message.blocks) {
          this.blocks.set(block.index, block.channels);
          this.requested.delete(block.index);
        }
        break;
      case "weights":
        this.setWeights(message.weights);
        break;
      case "start":
        this.begin(message);
        break;
      case "stop":
        this.playing = false;
        break;
    }
  }

  setWeights(weights) {
    const audible = weights.some((weight) => weight > 0);
    for (let stem = 0; stem < this.stemCount; stem++) {
      // With everything silenced there is nothing to prefer; judge similarity on the whole mix.
      this.weights[stem] = audible ? weights[stem] : 1;
    }
  }

  begin({ when, offset, rate, loop, weights }) {
    this.rate = rate;
    this.loop = loop ? { start: loop.start * sampleRate, end: loop.end * sampleRate } : null;
    this.startFrame = Math.round(when * sampleRate);
    this.offset = offset * sampleRate;
    this.setWeights(weights);

    // Frame 0 is centred on the start position; only its second half is ever heard.
    this.hopsDone = 0;
    const center = this.nominalCenter(0);
    for (let channel = 0; channel < this.channelCount; channel++) {
      this.read(channel, center - this.hop, this.frame, this.frameLength);
      const tail = this.tails[channel];
      for (let i = 0; i < this.hop; i++) tail[i] = this.frame[this.hop + i] * this.window[this.hop + i];
    }
    this.previousCenter = center;
    this.outputPosition = this.hop;
    this.playing = true;
    this.requestAhead();
  }

  wrap(position) {
    const loop = this.loop;
    if (!loop || position < loop.end) return position;
    return loop.start + ((position - loop.start) % (loop.end - loop.start));
  }

  nominalCenter(hopIndex) {
    return this.wrap(this.offset + hopIndex * this.hop * this.rate);
  }

  /** Copies `length` samples of one stem channel from input position `start` into `destination`, times `gain`, added or not. */
  read(channel, start, destination, length, gain = 1, add = false) {
    let position = Math.round(start);
    let written = 0;
    while (written < length) {
      let run;
      if (position < 0) {
        run = Math.min(length - written, -position);
        if (!add) destination.fill(0, written, written + run);
      } else if (position >= this.trackLength) {
        run = length - written;
        if (!add) destination.fill(0, written, written + run);
      } else {
        const index = Math.floor(position / this.blockSize);
        const within = position - index * this.blockSize;
        run = Math.min(length - written, this.blockSize - within, this.trackLength - position);
        const block = this.blocks.get(index);
        const data = block && block[channel];
        const available = data ? Math.max(0, Math.min(run, data.length - within)) : 0;
        if (add) {
          for (let i = 0; i < available; i++) destination[written + i] += data[within + i] * gain;
        } else {
          for (let i = 0; i < available; i++) destination[written + i] = data[within + i] * gain;
          destination.fill(0, written + available, written + run);
        }
      }
      written += run;
      position += run;
    }
  }

  mixInto(destination, start, length) {
    destination.fill(0, 0, length);
    for (let stem = 0; stem < this.stemCount; stem++) {
      const weight = this.weights[stem];
      if (weight <= 0) continue;
      this.read(stem * 2, start, destination, length, weight, true);
      this.read(stem * 2 + 1, start, destination, length, weight, true);
    }
  }

  /** The candidate centre near `nominal` whose first half best continues the previous frame. */
  bestCenter(nominal) {
    const { hop, seek } = this;
    const span = hop + 2 * seek;
    const base = Math.round(nominal) - seek - hop;

    // What would have followed the previous frame's centre, had it kept playing at speed 1.
    this.mixInto(this.natural, this.previousCenter, hop);
    this.mixInto(this.candidates, base, span);

    const energy = this.candidateEnergy;
    energy[0] = 0;
    for (let i = 0; i < span; i++) energy[i + 1] = energy[i] + this.candidates[i] * this.candidates[i];

    let best = 0;
    let bestScore = -Infinity;
    for (let delta = 0; delta <= 2 * seek; delta += COARSE_STEP) {
      let cross = 0;
      for (let i = 0; i < hop; i += COARSE_STEP) cross += this.natural[i] * this.candidates[delta + i];
      const score = cross / Math.sqrt(energy[delta + hop] - energy[delta] + ENERGY_EPSILON);
      if (score > bestScore) {
        bestScore = score;
        best = delta;
      }
    }

    const from = Math.max(0, best - COARSE_STEP + 1);
    const to = Math.min(2 * seek, best + COARSE_STEP - 1);
    bestScore = -Infinity;
    let refined = best;
    for (let delta = from; delta <= to; delta++) {
      let cross = 0;
      for (let i = 0; i < hop; i++) cross += this.natural[i] * this.candidates[delta + i];
      const score = cross / Math.sqrt(energy[delta + hop] - energy[delta] + ENERGY_EPSILON);
      if (score > bestScore) {
        bestScore = score;
        refined = delta;
      }
    }
    return base + refined + hop;
  }

  /** Fills `hopOutput` with the next hop: the previous frame's tail overlapped with a new frame's head. */
  synthesizeHop() {
    this.hopsDone++;
    const center = this.bestCenter(this.nominalCenter(this.hopsDone));
    const { hop } = this;
    for (let channel = 0; channel < this.channelCount; channel++) {
      this.read(channel, center - hop, this.frame, this.frameLength);
      const output = this.hopOutput[channel];
      const tail = this.tails[channel];
      for (let i = 0; i < hop; i++) {
        output[i] = tail[i] + this.frame[i] * this.window[i];
        tail[i] = this.frame[hop + i] * this.window[hop + i];
      }
    }
    this.previousCenter = center;
    this.outputPosition = 0;
    if (this.hopsDone % REQUEST_EVERY_HOPS === 0) this.requestAhead();
  }

  addNeededRange(start, end) {
    const first = Math.max(0, Math.floor(start / this.blockSize));
    const last = Math.min(Math.ceil(this.trackLength / this.blockSize) - 1, Math.floor(end / this.blockSize));
    for (let index = first; index <= last; index++) this.needed.add(index);
  }

  requestAhead() {
    const { hop, seek } = this;
    const reach = 2 * hop + seek;
    const hopsAhead = Math.ceil((LOOKAHEAD_SECONDS * sampleRate) / hop);
    this.needed.clear();
    for (let k = this.hopsDone; k <= this.hopsDone + hopsAhead; k += 2) {
      const center = this.nominalCenter(k);
      this.addNeededRange(center - reach, center + reach);
    }

    const missing = [];
    for (const index of this.needed) {
      if (this.blocks.has(index)) continue;
      const askedAt = this.requested.get(index);
      if (askedAt !== undefined && currentFrame - askedAt < RE_REQUEST_AFTER_SECONDS * sampleRate) continue;
      this.requested.set(index, currentFrame);
      missing.push(index);
    }
    if (missing.length > 0) this.port.postMessage({ type: "need", indices: missing });

    if (this.blocks.size > MAX_CACHED_BLOCKS) {
      for (const index of this.blocks.keys()) {
        if (!this.needed.has(index)) this.blocks.delete(index);
      }
    }
  }

  process(_inputs, outputs) {
    const quantum = outputs[0][0].length;
    if (!this.playing) {
      silence(outputs, quantum);
      return true;
    }

    const lead = Math.max(0, Math.min(quantum, this.startFrame - currentFrame));
    if (lead > 0) silence(outputs, lead);

    let written = lead;
    while (written < quantum) {
      if (this.outputPosition >= this.hop) this.synthesizeHop();
      const count = Math.min(quantum - written, this.hop - this.outputPosition);
      for (let stem = 0; stem < this.stemCount; stem++) {
        for (let side = 0; side < 2; side++) {
          const source = this.hopOutput[stem * 2 + side];
          const target = outputs[stem][side];
          for (let i = 0; i < count; i++) target[written + i] = source[this.outputPosition + i];
        }
      }
      this.outputPosition += count;
      written += count;
    }
    return true;
  }
}

// Indexed loops rather than for-of or subarray(): either would allocate on every render quantum, and
// garbage collection on the audio thread is heard as dropouts.
function silence(outputs, length) {
  for (let output = 0; output < outputs.length; output++) {
    for (let channel = 0; channel < outputs[output].length; channel++) outputs[output][channel].fill(0, 0, length);
  }
}

registerProcessor("chord-stretch", StretchProcessor);
