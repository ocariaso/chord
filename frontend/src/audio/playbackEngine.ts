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
  private soloed: string | null = null;

  private offsetSeconds = 0;
  private startedAtContextTime = 0;
  private playing = false;
  private disposed = false;

  constructor() {
    this.audioContext = new AudioContext();
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
        gainNode.connect(this.audioContext.destination);
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
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSeconds = this.getCurrentTime();
    this.stopAllSources();
    this.playing = false;
  }

  async seek(seconds: number): Promise<void> {
    const wasPlaying = this.playing;
    this.stopAllSources();
    this.playing = false;
    this.offsetSeconds = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) await this.play();
  }

  setMuted(stemName: string, muted: boolean): void {
    if (muted) this.muted.add(stemName);
    else this.muted.delete(stemName);
    this.applyGains();
  }

  setSolo(stemName: string | null): void {
    this.soloed = stemName;
    this.applyGains();
  }

  setVolume(stemName: string, volume: number): void {
    this.volumes.set(stemName, volume);
    this.applyGains();
  }

  getStemState(stemName: string): { muted: boolean; volume: number } {
    return { muted: this.muted.has(stemName), volume: this.volumes.get(stemName) ?? 1 };
  }

  dispose(): void {
    this.disposed = true;
    this.stopAllSources();
    if (this.audioContext.state !== "closed") void this.audioContext.close();
  }

  private applyGains(): void {
    for (const [name, gainNode] of this.gainNodes) {
      const isAudible = this.soloed ? name === this.soloed : !this.muted.has(name);
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
}
