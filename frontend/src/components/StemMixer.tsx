import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { downloadAllUrl, getChords, stemUrl, type ChordSegment, type Job } from "../api/client";
import { PlaybackEngine } from "../audio/playbackEngine";
import { downloadFile } from "../utils/download";
import { ChordTimeline } from "./ChordTimeline";
import { StemChannel } from "./StemChannel";
import { TransportBar } from "./TransportBar";

interface StemMixerProps {
  job: Job;
  onBack: () => void;
}

interface ChannelState {
  muted: boolean;
  volume: number;
}

export function StemMixer({ job, onBack }: StemMixerProps) {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const waveSurfersRef = useRef(new Map<string, WaveSurfer>());
  const rafRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [soloedStems, setSoloedStems] = useState<Set<string>>(new Set());
  const [channelStates, setChannelStates] = useState<Record<string, ChannelState>>({});
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [masterVolume, setMasterVolume] = useState(1);
  const [chordSegments, setChordSegments] = useState<ChordSegment[]>([]);

  async function handleDownloadAll() {
    setIsDownloadingAll(true);
    try {
      const baseName = job.original_filename.replace(/\.mp3$/i, "");
      await downloadFile(downloadAllUrl(job.id), `${baseName}_stems.zip`);
    } catch {
      // The download simply won't start; nothing else to recover here.
    } finally {
      setIsDownloadingAll(false);
    }
  }

  useEffect(() => {
    const engine = new PlaybackEngine();
    engine.setTempoBpm(job.tempo_bpm);
    engineRef.current = engine;
    let cancelled = false;

    engine
      .load(job.stem_names.map((name) => ({ name, url: stemUrl(job.id, name) })))
      .then(() => {
        if (cancelled) return;
        setChannelStates(
          Object.fromEntries(job.stem_names.map((name) => [name, { muted: false, volume: 1 }]))
        );
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message ?? "Failed to load stems");
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      engine.dispose();
    };
  }, [job.id, job.stem_names]);

  useEffect(() => {
    let cancelled = false;
    getChords(job.id)
      .then((segments) => {
        if (!cancelled) setChordSegments(segments);
      })
      .catch(() => {
        // Chord analysis may not be available for this job; leave the timeline hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    function tick() {
      const engine = engineRef.current;
      if (engine) {
        const time = engine.getCurrentTime();
        setCurrentTime(time);
        for (const ws of waveSurfersRef.current.values()) {
          ws.setTime(time);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function handlePlayPause() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      void engine.play().then(() => setIsPlaying(true));
    }
  }

  function handleSeek(seconds: number) {
    const engine = engineRef.current;
    if (!engine) return;
    void engine.seek(seconds).then(() => {
      setCurrentTime(seconds);
      setIsPlaying(engine.isPlaying);
    });
  }

  function toggleMute(name: string) {
    const next = !channelStates[name]?.muted;
    engineRef.current?.setMuted(name, next);
    setChannelStates((prev) => ({ ...prev, [name]: { ...prev[name], muted: next } }));
  }

  function toggleSolo(name: string) {
    const isSoloed = soloedStems.has(name);
    engineRef.current?.setSolo(name, !isSoloed);
    setSoloedStems((prev) => {
      const next = new Set(prev);
      if (isSoloed) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function changeVolume(name: string, volume: number) {
    engineRef.current?.setVolume(name, volume);
    setChannelStates((prev) => ({ ...prev, [name]: { ...prev[name], volume } }));
  }

  function toggleMetronome() {
    const next = !metronomeEnabled;
    engineRef.current?.setMetronomeEnabled(next);
    setMetronomeEnabled(next);
  }

  function changeMasterVolume(volume: number) {
    engineRef.current?.setMasterVolume(volume);
    setMasterVolume(volume);
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-red-400">{loadError}</p>
        <button onClick={onBack} className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-500">
          Back to upload
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-neutral-400">Loading stems...</div>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-neutral-100">{job.original_filename}</h1>
          {job.tempo_bpm != null && <p className="text-sm text-neutral-500">{job.tempo_bpm} BPM</p>}
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleDownloadAll}
            disabled={isDownloadingAll}
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200 disabled:text-neutral-500"
          >
            {isDownloadingAll && (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-[1.5px] border-neutral-500 border-t-transparent" />
            )}
            {isDownloadingAll ? "Preparing zip..." : "Download all (.zip)"}
          </button>
          <button onClick={onBack} className="text-sm text-neutral-400 hover:text-neutral-200">
            &larr; Upload another
          </button>
        </div>
      </div>

      <ChordTimeline
        segments={chordSegments}
        currentTime={currentTime}
        duration={engineRef.current?.duration ?? 0}
        keyLabel={job.key_estimate}
        onSeek={handleSeek}
      />

      <div className="flex flex-col gap-2">
        {job.stem_names.map((name) => (
          <StemChannel
            key={name}
            name={name}
            buffer={engineRef.current!.getBuffer(name)!}
            muted={channelStates[name]?.muted ?? false}
            isSoloed={soloedStems.has(name)}
            volume={channelStates[name]?.volume ?? 1}
            downloadHref={stemUrl(job.id, name)}
            onToggleMute={() => toggleMute(name)}
            onToggleSolo={() => toggleSolo(name)}
            onVolumeChange={(v) => changeVolume(name, v)}
            onWaveSurferReady={(stemName, instance) => waveSurfersRef.current.set(stemName, instance)}
          />
        ))}
      </div>

      <TransportBar
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={engineRef.current?.duration ?? 0}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        metronomeEnabled={metronomeEnabled}
        onToggleMetronome={job.tempo_bpm != null ? toggleMetronome : undefined}
        masterVolume={masterVolume}
        onMasterVolumeChange={changeMasterVolume}
      />
    </div>
  );
}
