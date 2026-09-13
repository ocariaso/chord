import stretchProcessorUrl from "./stretchProcessor.js?url";
import { correlationOf, kWeightingFilters, loudnessFromMeanSquares, meanSquareOf, peakOf, truePeakOf } from "./meters";

export interface StemInput {
  name: string;
  url: string;
  /** Pivot frequency of the stem's Tone tilt. */
  tonePivotHz: number;
}

export interface StemLoadFailure {
  name: string;
  url: string;
  message: string;
}

export interface LoopRegion {
  start: number;
  end: number;
}

/** Peaks are linear amplitudes (1 = full scale), all measured after the faders. */
export interface MeterReadings {
  stems: Record<string, [number, number]>;
  master: [number, number];
  truePeak: number;
  /** Momentary (400 ms) loudness in LUFS; −Infinity in silence. */
  loudness: number;
  /** null while the output is too quiet to judge. */
  correlation: number | null;
}

export function createMeterReadings(): MeterReadings {
  return { stems: {}, master: [0, 0], truePeak: 0, loudness: -Infinity, correlation: null };
}

interface StemChain {
  lowShelf: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode;
  analysers: [AnalyserNode, AnalyserNode];
}

interface TrackPiece {
  trackStart: number;
  trackEnd: number;
  contextStart: number;
}

const STEM_METER_FFT_SIZE = 1024;
const MASTER_METER_FFT_SIZE = 4096;
// True peak oversamples only the newest part of the master window; all of it would double the cost.
const TRUE_PEAK_SPAN = 2048;
const LOUDNESS_FFT_SIZE = 32768;
const MOMENTARY_LOUDNESS_SECONDS = 0.4;
const LOUDNESS_INTERVAL_MS = 100;
// Long enough that stepping a gain doesn't click, short enough to follow a fader drag.
const PARAM_SMOOTHING_SECONDS = 0.015;
const METRONOME_LOOKAHEAD_SECONDS = 0.12;
const METRONOME_TICK_MS = 25;
const CLICK_FREQUENCY_HZ = 1000;
const CLICK_SECONDS = 0.05;
// Time for the start message to reach the audio thread before the stretch processor must sound.
const STRETCH_START_DELAY_SECONDS = 0.08;
const STRETCH_BLOCK_SECONDS = 1;
const STRETCH_PRELOAD_SECONDS = 4;
const MAX_TRACK_PIECES = 64;

function splitIntoAnalysers(context: AudioContext, source: AudioNode, fftSize: number): [AnalyserNode, AnalyserNode] {
  const splitter = context.createChannelSplitter(2);
  source.connect(splitter);
  const analysers: [AnalyserNode, AnalyserNode] = [context.createAnalyser(), context.createAnalyser()];
  analysers.forEach((analyser, channel) => {
    analyser.fftSize = fftSize;
    splitter.connect(analyser, channel);
  });
  return analysers;
}

async function fetchStem(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? ` ${body.detail}` : "";
    throw new Error(`${response.status}${detail}`);
  }
  return response.arrayBuffer();
}

/** Plays multiple decoded stems in sample-accurate lockstep using a single AudioContext clock. */
export class PlaybackEngine {
  private audioContext: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private chains = new Map<string, StemChain>();
  private sourceNodes = new Map<string, AudioBufferSourceNode>();
  private volumes = new Map<string, number>();
  private muted = new Set<string>();
  private soloed = new Set<string>();

  private playing = false;
  private disposed = false;
  // Position is derived, never stored: the track time at the anchor, advancing at `rate` from the
  // context time the anchor was heard. While paused, the anchor's track time is the position.
  private anchorTrackTime = 0;
  private anchorContextTime = 0;
  private rate = 1;
  private loop: LoopRegion | null = null;
  // Bumped whenever output stops, so an asynchronous start that has been overtaken abandons itself.
  private transportToken = 0;

  private tempoBpm: number | null = null;
  private metronomeEnabled = false;
  private metronomeGain: GainNode;
  private clicks = new Set<OscillatorNode>();
  private metronomeTimer: number | undefined;
  private clicksScheduledUntil = 0;

  private masterGain: GainNode;
  private masterAnalysers: [AnalyserNode, AnalyserNode];
  private loudnessAnalysers: [AnalyserNode, AnalyserNode];
  private stemScratch = new Float32Array(STEM_METER_FFT_SIZE);
  private masterScratch: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(MASTER_METER_FFT_SIZE),
    new Float32Array(MASTER_METER_FFT_SIZE),
  ];
  private loudnessScratch: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(LOUDNESS_FFT_SIZE),
    new Float32Array(LOUDNESS_FFT_SIZE),
  ];
  private loudnessMeasuredAt = -Infinity;
  private loudness = -Infinity;

  private stretchModule: Promise<void> | null = null;
  private stretchUnavailable = false;
  private stretchNode: AudioWorkletNode | null = null;
  private stretchStems: string[] = [];
  private stretchBlockSize = 0;

  constructor() {
    this.audioContext = new AudioContext();
    const context = this.audioContext;

    this.masterGain = context.createGain();
    this.masterGain.connect(context.destination);
    this.masterAnalysers = splitIntoAnalysers(context, this.masterGain, MASTER_METER_FFT_SIZE);

    const { shelf, highPass } = kWeightingFilters(context.sampleRate);
    const kShelf = context.createIIRFilter(shelf.feedforward, shelf.feedback);
    const kHighPass = context.createIIRFilter(highPass.feedforward, highPass.feedback);
    this.masterGain.connect(kShelf).connect(kHighPass);
    this.loudnessAnalysers = splitIntoAnalysers(context, kHighPass, LOUDNESS_FFT_SIZE);

    this.metronomeGain = context.createGain();
    this.metronomeGain.gain.value = 1;
    this.metronomeGain.connect(context.destination);
  }

  /** Fetches and decodes stems in parallel. Resolves with the stems that failed, rather than rejecting. */
  async load(stems: StemInput[]): Promise<StemLoadFailure[]> {
    const failures: StemLoadFailure[] = [];
    await Promise.all(
      stems.map(async (stem) => {
        try {
          const bytes = await fetchStem(stem.url);
          if (this.disposed) return;
          const buffer = await this.audioContext.decodeAudioData(bytes);
          // Bail out if disposed while this fetch/decode was still in flight.
          if (this.disposed) return;
          this.addStem(stem, buffer);
        } catch (error) {
          if (this.disposed) return;
          failures.push({ name: stem.name, url: stem.url, message: error instanceof Error ? error.message : String(error) });
        }
      })
    );
    this.applyGains();
    return failures;
  }

  private addStem(stem: StemInput, buffer: AudioBuffer): void {
    const context = this.audioContext;
    const lowShelf = context.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = stem.tonePivotHz;
    const highShelf = context.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = stem.tonePivotHz;
    const gain = context.createGain();
    const panner = context.createStereoPanner();

    lowShelf.connect(highShelf).connect(gain).connect(panner).connect(this.masterGain);
    const analysers = splitIntoAnalysers(context, panner, STEM_METER_FFT_SIZE);

    this.chains.set(stem.name, { lowShelf, highShelf, gain, panner, analysers });
    this.buffers.set(stem.name, buffer);
    if (!this.volumes.has(stem.name)) this.volumes.set(stem.name, 1);
  }

  get duration(): number {
    let max = 0;
    for (const buffer of this.buffers.values()) max = Math.max(max, buffer.duration);
    return max;
  }

  get stemNames(): string[] {
    return [...this.buffers.keys()];
  }

  getBuffer(stemName: string): AudioBuffer | undefined {
    return this.buffers.get(stemName);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get playbackRate(): number {
    return this.rate;
  }

  /** Pitch-preserving speed needs AudioWorklet, which browsers expose only to secure origins. */
  get supportsTimeStretch(): boolean {
    return !this.stretchUnavailable && typeof AudioWorkletNode !== "undefined" && "audioWorklet" in this.audioContext;
  }

  getCurrentTime(): number {
    if (!this.playing) return this.anchorTrackTime;
    const elapsed = Math.max(0, this.audioContext.currentTime - this.anchorContextTime) * this.rate;
    return Math.min(this.wrap(this.anchorTrackTime + elapsed), this.duration);
  }

  /** True once playback without a loop has run past the end of the longest stem. */
  get hasEnded(): boolean {
    return this.playing && !this.loop && this.getCurrentTime() >= this.duration;
  }

  async play(): Promise<void> {
    if (this.playing || this.disposed || this.buffers.size === 0) return;
    const token = ++this.transportToken;
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    if (token !== this.transportToken) return;
    if (this.anchorTrackTime >= this.duration) this.anchorTrackTime = this.loop?.start ?? 0;

    if (this.rate !== 1 && (await this.startStretch(token))) {
      if (token !== this.transportToken) return;
    } else {
      if (token !== this.transportToken) return;
      // Either speed is 1, or the stretch processor couldn't load and playback falls back to it.
      this.rate = 1;
      this.startSources();
    }
    this.playing = true;
    this.startMetronome();
  }

  pause(): void {
    if (!this.playing) {
      // Also abandons a start that is still waiting on the context or the worklet.
      this.transportToken++;
      return;
    }
    this.anchorTrackTime = this.getCurrentTime();
    this.stopOutput();
  }

  async seek(seconds: number): Promise<void> {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stopOutput();
    this.anchorTrackTime = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) await this.play();
  }

  get loopRegion(): LoopRegion | null {
    return this.loop;
  }

  /** Loops [start, end) and jumps to its start. */
  async setLoop(region: LoopRegion): Promise<void> {
    this.loop = region;
    await this.seek(region.start);
  }

  clearLoop(): void {
    if (!this.loop) return;
    const position = this.getCurrentTime();
    this.loop = null;
    if (!this.playing) {
      this.anchorTrackTime = position;
      return;
    }
    if (this.rate === 1) {
      // A looping buffer source simply carries on from wherever it is; only the anchor has to follow.
      for (const source of this.sourceNodes.values()) source.loop = false;
      this.anchorTrackTime = position;
      this.anchorContextTime = this.audioContext.currentTime;
      this.startMetronome();
    } else {
      void this.seek(position);
    }
  }

  /** Speed without changing pitch. Resolves once playback, if it was running, has restarted. */
  async setPlaybackRate(rate: number): Promise<void> {
    if (rate === this.rate) return;
    const wasPlaying = this.playing;
    const position = this.getCurrentTime();
    if (wasPlaying) this.stopOutput();
    this.rate = rate;
    this.anchorTrackTime = position;
    if (wasPlaying) await this.play();
  }

  setTempoBpm(bpm: number | null): void {
    this.tempoBpm = bpm;
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
    if (enabled && this.playing) this.startMetronome();
    else this.stopMetronome();
  }

  get isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  setMuted(stemName: string, muted: boolean): void {
    if (muted) this.muted.add(stemName);
    else this.muted.delete(stemName);
    this.applyGains();
  }

  setSolo(stemName: string, active: boolean): void {
    if (active) this.soloed.add(stemName);
    else this.soloed.delete(stemName);
    this.applyGains();
  }

  /** Linear gain; the fader law that produces it lives with the UI. */
  setVolume(stemName: string, gain: number): void {
    this.volumes.set(stemName, gain);
    this.applyGains();
  }

  /** −1 (left) … 1 (right). */
  setPan(stemName: string, pan: number): void {
    const chain = this.chains.get(stemName);
    if (chain) this.setParam(chain.panner.pan, pan);
  }

  /** Tilts the stem around its pivot: highs shelved by `shelfDb`, lows by the opposite. */
  setTone(stemName: string, shelfDb: number): void {
    const chain = this.chains.get(stemName);
    if (!chain) return;
    this.setParam(chain.highShelf.gain, shelfDb);
    this.setParam(chain.lowShelf.gain, -shelfDb);
  }

  setMasterVolume(gain: number): void {
    this.setParam(this.masterGain.gain, gain);
  }

  getStemState(stemName: string): { muted: boolean; volume: number } {
    return { muted: this.muted.has(stemName), volume: this.volumes.get(stemName) ?? 1 };
  }

  /** Fills `target` with the current post-fader levels. Cheap enough to call every animation frame. */
  readMeters(target: MeterReadings, now: number): void {
    for (const [name, chain] of this.chains) {
      const levels = target.stems[name] ?? (target.stems[name] = [0, 0]);
      chain.analysers.forEach((analyser, channel) => {
        analyser.getFloatTimeDomainData(this.stemScratch);
        levels[channel] = peakOf(this.stemScratch);
      });
    }

    const [left, right] = this.masterScratch;
    this.masterAnalysers[0].getFloatTimeDomainData(left);
    this.masterAnalysers[1].getFloatTimeDomainData(right);
    target.master[0] = peakOf(left);
    target.master[1] = peakOf(right);
    const truePeakFrom = MASTER_METER_FFT_SIZE - TRUE_PEAK_SPAN;
    target.truePeak = Math.max(truePeakOf(left, truePeakFrom), truePeakOf(right, truePeakFrom));
    target.correlation = correlationOf(left, right);

    if (now - this.loudnessMeasuredAt >= LOUDNESS_INTERVAL_MS) {
      this.loudnessMeasuredAt = now;
      const [kLeft, kRight] = this.loudnessScratch;
      this.loudnessAnalysers[0].getFloatTimeDomainData(kLeft);
      this.loudnessAnalysers[1].getFloatTimeDomainData(kRight);
      // Above 81.9 kHz, 400 ms outgrows the analyser's largest buffer; measure the whole buffer instead.
      const windowSamples = Math.round(MOMENTARY_LOUDNESS_SECONDS * this.audioContext.sampleRate);
      const windowStart = Math.max(0, LOUDNESS_FFT_SIZE - windowSamples);
      this.loudness = loudnessFromMeanSquares(meanSquareOf(kLeft, windowStart), meanSquareOf(kRight, windowStart));
    }
    target.loudness = this.loudness;
  }

  dispose(): void {
    this.disposed = true;
    this.stopOutput();
    if (this.stretchNode) {
      this.stretchNode.port.close();
      this.stretchNode.disconnect();
    }
    if (this.audioContext.state !== "closed") void this.audioContext.close();
  }

  private setParam(param: AudioParam, value: number): void {
    param.setTargetAtTime(value, this.audioContext.currentTime, PARAM_SMOOTHING_SECONDS);
  }

  private applyGains(): void {
    for (const [name, chain] of this.chains) {
      this.setParam(chain.gain.gain, this.isAudible(name) ? (this.volumes.get(name) ?? 1) : 0);
    }
    this.stretchNode?.port.postMessage({ type: "weights", weights: this.stretchWeights() });
  }

  private isAudible(name: string): boolean {
    return this.soloed.size > 0 ? this.soloed.has(name) && !this.muted.has(name) : !this.muted.has(name);
  }

  private wrap(position: number): number {
    const loop = this.loop;
    if (!loop || position < loop.end) return position;
    return loop.start + ((position - loop.start) % (loop.end - loop.start));
  }

  private startSources(): void {
    const when = this.audioContext.currentTime;
    for (const [name, buffer] of this.buffers) {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      if (this.loop) {
        source.loop = true;
        source.loopStart = this.loop.start;
        source.loopEnd = this.loop.end;
      }
      source.connect(this.chains.get(name)!.lowShelf);
      source.start(when, this.anchorTrackTime);
      this.sourceNodes.set(name, source);
    }
    this.anchorContextTime = when;
  }

  private stopOutput(): void {
    this.transportToken++;
    for (const source of this.sourceNodes.values()) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sourceNodes.clear();
    this.stretchNode?.port.postMessage({ type: "stop" });
    this.stopMetronome();
    this.playing = false;
  }

  private async startStretch(token: number): Promise<boolean> {
    const node = await this.stretchProcessor();
    if (!node || token !== this.transportToken || this.disposed) return false;
    const when = this.audioContext.currentTime + STRETCH_START_DELAY_SECONDS;
    // The blocks around the start travel ahead of the start message, so the first output isn't silence.
    this.sendStretchBlocks(this.blocksAround(this.anchorTrackTime));
    node.port.postMessage({
      type: "start",
      when,
      offset: this.anchorTrackTime,
      rate: this.rate,
      loop: this.loop,
      weights: this.stretchWeights(),
    });
    this.anchorContextTime = when;
    return true;
  }

  private async stretchProcessor(): Promise<AudioWorkletNode | null> {
    if (!this.supportsTimeStretch) return null;
    if (this.stretchNode) return this.stretchNode;
    try {
      this.stretchModule ??= this.audioContext.audioWorklet.addModule(stretchProcessorUrl);
      await this.stretchModule;
    } catch {
      // The processor script failed to load; supportsTimeStretch now reports false and play() falls back to 1×.
      this.stretchUnavailable = true;
      return null;
    }
    if (this.disposed) return null;
    if (this.stretchNode) return this.stretchNode;

    const names = [...this.buffers.keys()];
    let trackLength = 0;
    for (const buffer of this.buffers.values()) trackLength = Math.max(trackLength, buffer.length);
    this.stretchBlockSize = Math.round(STRETCH_BLOCK_SECONDS * this.audioContext.sampleRate);

    const node = new AudioWorkletNode(this.audioContext, "chord-stretch", {
      numberOfInputs: 0,
      numberOfOutputs: names.length,
      outputChannelCount: names.map(() => 2),
      processorOptions: { stemCount: names.length, blockSize: this.stretchBlockSize, trackLength },
    });
    names.forEach((name, output) => node.connect(this.chains.get(name)!.lowShelf, output));
    node.port.onmessage = (event: MessageEvent<{ type: string; indices: number[] }>) => {
      if (event.data.type === "need") this.sendStretchBlocks(event.data.indices);
    };
    this.stretchNode = node;
    this.stretchStems = names;
    return node;
  }

  /** Similarity weights for the stretch processor: the stems as they are currently heard. */
  private stretchWeights(): number[] {
    return this.stretchStems.map((name) => (this.isAudible(name) ? (this.volumes.get(name) ?? 1) : 0));
  }

  private blocksAround(position: number): number[] {
    const indices = new Set<number>();
    const addSpan = (from: number, to: number) => {
      for (let index = Math.floor(from / STRETCH_BLOCK_SECONDS); index <= Math.floor(to / STRETCH_BLOCK_SECONDS); index++) {
        indices.add(index);
      }
    };
    addSpan(Math.max(0, position - 1), position + STRETCH_PRELOAD_SECONDS * this.rate);
    if (this.loop) addSpan(Math.max(0, this.loop.start - 1), this.loop.start + STRETCH_PRELOAD_SECONDS * this.rate);
    return [...indices];
  }

  private sendStretchBlocks(indices: number[]): void {
    const node = this.stretchNode;
    if (!node) return;
    const size = this.stretchBlockSize;
    const blocks: { index: number; channels: Float32Array[] }[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const index of indices) {
      const start = index * size;
      const channels: Float32Array[] = [];
      for (const name of this.stretchStems) {
        const buffer = this.buffers.get(name)!;
        for (let side = 0; side < 2; side++) {
          const data = buffer.getChannelData(Math.min(side, buffer.numberOfChannels - 1));
          const block = data.slice(Math.min(start, data.length), Math.min(start + size, data.length));
          channels.push(block);
          transfer.push(block.buffer);
        }
      }
      if (channels.some((channel) => channel.length > 0)) blocks.push({ index, channels });
    }
    if (blocks.length > 0) node.port.postMessage({ type: "blocks", blocks }, transfer);
  }

  private startMetronome(): void {
    this.stopMetronome();
    if (!this.metronomeEnabled || !this.tempoBpm || !this.playing) return;
    this.clicksScheduledUntil = this.anchorContextTime;
    this.scheduleClicksAhead();
    this.metronomeTimer = window.setInterval(() => this.scheduleClicksAhead(), METRONOME_TICK_MS);
  }

  private stopMetronome(): void {
    window.clearInterval(this.metronomeTimer);
    this.metronomeTimer = undefined;
    for (const oscillator of this.clicks) {
      try {
        oscillator.stop();
      } catch {
        // already stopped
      }
    }
    this.clicks.clear();
  }

  /**
   * Schedules the clicks that fall in the next lookahead window. A short window re-filled on a timer,
   * rather than every beat up front, is what lets the click follow loops and speed changes.
   * Beat one is anchored to track time zero.
   */
  private scheduleClicksAhead(): void {
    if (!this.tempoBpm) return;
    const beat = 60 / this.tempoBpm;
    const now = this.audioContext.currentTime;
    const from = Math.max(this.clicksScheduledUntil, now);
    const to = now + METRONOME_LOOKAHEAD_SECONDS;
    if (to <= from) return;
    for (const piece of this.trackPieces(from, to)) {
      for (let k = Math.ceil(piece.trackStart / beat); k * beat < piece.trackEnd; k++) {
        this.scheduleClick(piece.contextStart + (k * beat - piece.trackStart) / this.rate);
      }
    }
    this.clicksScheduledUntil = to;
  }

  /** Splits a window of context time into the stretches of track time it plays, cut at loop wraps. */
  private trackPieces(from: number, to: number): TrackPiece[] {
    const pieces: TrackPiece[] = [];
    let elapsed = (from - this.anchorContextTime) * this.rate;
    const end = (to - this.anchorContextTime) * this.rate;
    while (elapsed < end && pieces.length < MAX_TRACK_PIECES) {
      const trackStart = this.wrap(this.anchorTrackTime + elapsed);
      const boundary = this.loop ? this.loop.end : this.duration;
      const span = Math.min(end - elapsed, boundary - trackStart);
      if (span <= 0) break;
      pieces.push({
        trackStart,
        trackEnd: trackStart + span,
        contextStart: this.anchorContextTime + elapsed / this.rate,
      });
      elapsed += span;
    }
    return pieces;
  }

  private scheduleClick(when: number): void {
    const oscillator = this.audioContext.createOscillator();
    oscillator.frequency.value = CLICK_FREQUENCY_HZ;

    const envelope = this.audioContext.createGain();
    envelope.gain.setValueAtTime(1, when);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + CLICK_SECONDS);

    oscillator.connect(envelope).connect(this.metronomeGain);
    oscillator.onended = () => {
      this.clicks.delete(oscillator);
      envelope.disconnect();
    };
    oscillator.start(when);
    oscillator.stop(when + CLICK_SECONDS);
    this.clicks.add(oscillator);
  }
}
