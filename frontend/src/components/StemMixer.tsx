import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { stemUrl, type Job } from "../api/client";
import { PlaybackEngine } from "../audio/playbackEngine";
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
  const [soloedStem, setSoloedStem] = useState<string | null>(null);
  const [channelStates, setChannelStates] = useState<Record<string, ChannelState>>({});

  useEffect(() => {
    const engine = new PlaybackEngine();
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
    const next = soloedStem === name ? null : name;
    engineRef.current?.setSolo(next);
    setSoloedStem(next);
  }

  function changeVolume(name: string, volume: number) {
    engineRef.current?.setVolume(name, volume);
    setChannelStates((prev) => ({ ...prev, [name]: { ...prev[name], volume } }));
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
        <h1 className="truncate text-xl font-semibold text-neutral-100">{job.original_filename}</h1>
        <button onClick={onBack} className="text-sm text-neutral-400 hover:text-neutral-200">
          &larr; Upload another
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {job.stem_names.map((name) => (
          <StemChannel
            key={name}
            name={name}
            buffer={engineRef.current!.getBuffer(name)!}
            muted={channelStates[name]?.muted ?? false}
            isSoloed={soloedStem === name}
            volume={channelStates[name]?.volume ?? 1}
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
      />
    </div>
  );
}
