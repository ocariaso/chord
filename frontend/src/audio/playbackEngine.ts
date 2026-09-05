export interface StemInput {
  name: string;
  url: string;
}

export interface StemState {
  name: string;
  buffer: AudioBuffer;
  muted: boolean;
  volume: number;
}

/** Plays multiple decoded stems in sample-accurate lockstep using a single AudioContext clock. */
export class PlaybackEngine {
  private audioContext: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private gainNodes = new Map<string, GainNode>();
  private sourceNodes = new Map<string, AudioBufferSourceNode>();
  private volumes = new Map<string, number>();
  private muted = new Set<string>();
  private soloed = new Set<string>();

  private offsetSeconds = 0;
  private startedAtContextTime = 0;
  private playing = false;
  private disposed = false;

  private tempoBpm: number | null = null;
  private metronomeEnabled = false;
  private metronomeGain: GainNode;
  private metronomeOscillators: OscillatorNode[] = [];

  private masterGain: GainNode;

  constructor() {
    this.audioContext = new AudioContext();

    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);

    this.metronomeGain = this.audioContext.createGain();
    this.metronomeGain.gain.value = 1;
    this.metronomeGain.connect(this.audioContext.destination);
  }

  async load(stems: StemInput[]): Promise<void> {
    await Promise.all(
      stems.map(async (stem) => {
        const response = await fetch(stem.url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        // Bail out if disposed while this fetch/decode was still in flight.
        if (this.disposed) return;
        this.buffers.set(stem.name, audioBuffer);
        this.volumes.set(stem.name, 1);

        const gainNode = this.audioContext.createGain();
        gainNode.connect(this.masterGain);
        this.gainNodes.set(stem.name, gainNode);
      })
    );
    this.applyGains();
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

  getCurrentTime(): number {
    if (!this.playing) return this.offsetSeconds;
    return this.offsetSeconds + (this.audioContext.currentTime - this.startedAtContextTime);
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.audioContext.state === "suspended") await this.audioContext.resume();

    const startTime = this.audioContext.currentTime;
    this.startedAtContextTime = startTime;

    for (const [name, buffer] of this.buffers) {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gainNodes.get(name)!);
      source.start(startTime, this.offsetSeconds);
      this.sourceNodes.set(name, source);
    }
    this.playing = true;

    if (this.metronomeEnabled) this.scheduleMetronomeClicks(startTime, this.offsetSeconds);
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSeconds = this.getCurrentTime();
    this.stopAllSources();
    this.clearMetronomeSchedule();
    this.playing = false;
  }

  async seek(seconds: number): Promise<void> {
    const wasPlaying = this.playing;
    this.stopAllSources();
    this.clearMetronomeSchedule();
    this.playing = false;
    this.offsetSeconds = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) await this.play();
  }

  setTempoBpm(bpm: number | null): void {
    this.tempoBpm = bpm;
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
    this.clearMetronomeSchedule();
    if (enabled && this.playing) {
      this.scheduleMetronomeClicks(this.startedAtContextTime, this.offsetSeconds);
    }
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

  setVolume(stemName: string, volume: number): void {
    this.volumes.set(stemName, volume);
    this.applyGains();
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = volume;
  }

  getStemState(stemName: string): { muted: boolean; volume: number } {
    return { muted: this.muted.has(stemName), volume: this.volumes.get(stemName) ?? 1 };
  }

  dispose(): void {
    this.disposed = true;
    this.stopAllSources();
    this.clearMetronomeSchedule();
    if (this.audioContext.state !== "closed") void this.audioContext.close();
  }

  private applyGains(): void {
    for (const [name, gainNode] of this.gainNodes) {
      const isAudible = this.soloed.size > 0 ? this.soloed.has(name) && !this.muted.has(name) : !this.muted.has(name);
      const volume = this.volumes.get(name) ?? 1;
      gainNode.gain.value = isAudible ? volume : 0;
    }
  }

  private stopAllSources(): void {
    for (const source of this.sourceNodes.values()) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sourceNodes.clear();
  }

  /** Schedules metronome clicks from the given track offset through the end of the track. */
  private scheduleMetronomeClicks(startTime: number, offsetSeconds: number): void {
    if (!this.tempoBpm) return;
    const beatInterval = 60 / this.tempoBpm;

    let beatIndex = Math.ceil(offsetSeconds / beatInterval);
    let trackTime = beatIndex * beatInterval;
    while (trackTime < this.duration) {
      this.scheduleClick(startTime + (trackTime - offsetSeconds));
      beatIndex++;
      trackTime = beatIndex * beatInterval;
    }
  }

  private scheduleClick(when: number): void {
    const oscillator = this.audioContext.createOscillator();
    oscillator.frequency.value = 1000;

    const envelope = this.audioContext.createGain();
    envelope.gain.setValueAtTime(1, when);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.05);

    oscillator.connect(envelope);
    envelope.connect(this.metronomeGain);
    oscillator.start(when);
    oscillator.stop(when + 0.05);

    this.metronomeOscillators.push(oscillator);
  }

  private clearMetronomeSchedule(): void {
    for (const oscillator of this.metronomeOscillators) {
      try {
        oscillator.stop();
      } catch {
        // already stopped
      }
    }
    this.metronomeOscillators = [];
  }
}
