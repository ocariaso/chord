import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { downloadAllUrl, getChords, stemUrl, thumbnailUrl, type ChordSegment, type Job } from "../api/client";
import { PlaybackEngine } from "../audio/playbackEngine";
import { useDominantColor } from "../hooks/useDominantColor";
import { downloadFile } from "../utils/download";
import { ChordTimeline } from "./ChordTimeline";
import { StemChannel } from "./StemChannel";
import { MASTER_WIDTH } from "./studio/constants";
import { DownloadTrayIcon, UploadTrayIcon } from "./studio/icons";
import { StudioCabinet } from "./studio/StudioCabinet";
import { StudioMixer } from "./studio/StudioMixer";
import { TransportBar } from "./TransportBar";

interface StemMixerProps {
  job: Job;
  onBack: () => void;
}

interface ChannelState {
  muted: boolean;
  volume: number;
}

type ViewMode = "simple" | "studio";
const VIEW_MODE_KEY = "chord:viewMode";

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === "studio" ? "studio" : "simple";
  } catch {
    return "simple";
  }
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
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [transpose, setTranspose] = useState(0);
  const accentColor = useDominantColor(job.has_thumbnail ? thumbnailUrl(job.id) : null) ?? "#9333ea";

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Private browsing or storage disabled; the toggle still works for this session.
    }
  }

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

  const duration = engineRef.current?.duration ?? 0;

  const header = (
      <div
        className="mx-auto flex w-full items-start justify-between gap-6 rounded-lg p-4"
        style={{
          ...(viewMode === "studio" ? { maxWidth: MASTER_WIDTH } : {}),
          ...(job.has_thumbnail
            ? {
                backgroundImage: `linear-gradient(90deg, rgba(10,10,10,0.9) 0%, rgba(10,10,10,0.6) 55%, rgba(10,10,10,0.25) 100%), url(${thumbnailUrl(job.id)})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                backgroundColor: "#141018",
                backgroundImage:
                  "radial-gradient(circle at 22% 25%, rgba(147,51,234,0.22), transparent 55%)," +
                  "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1.2px)," +
                  "linear-gradient(135deg, #1b1420 0%, #130f17 55%, #0c0a0e 100%)",
                backgroundSize: "auto, 7px 7px, auto",
              }),
        }}
      >
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-neutral-100">{job.original_filename}</h1>
          {(job.author || job.tempo_bpm != null) && (
            <p className="truncate text-sm text-neutral-500">
              {[job.author, job.tempo_bpm != null ? `${job.tempo_bpm} BPM` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex rounded-md bg-neutral-900 p-0.5 text-sm">
            <button
              onClick={() => changeViewMode("simple")}
              className={`rounded px-3 py-1 ${viewMode === "simple" ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              style={viewMode === "simple" ? { backgroundColor: accentColor } : undefined}
            >
              Simple
            </button>
            <button
              onClick={() => changeViewMode("studio")}
              className={`rounded px-3 py-1 ${viewMode === "studio" ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              style={viewMode === "studio" ? { backgroundColor: accentColor } : undefined}
            >
              Studio
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              title={isDownloadingAll ? "Preparing zip..." : "Download all stems (.zip)"}
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 disabled:text-neutral-600"
            >
              {isDownloadingAll ? (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-[1.5px] border-neutral-500 border-t-transparent" />
              ) : (
                <DownloadTrayIcon />
              )}
            </button>
            <button
              onClick={onBack}
              title="Upload another song"
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            >
              <UploadTrayIcon />
            </button>
          </div>
        </div>
      </div>
  );

  const studioContent = (
    <StudioMixer
      title={job.original_filename}
      author={job.author}
      keyLabel={job.key_estimate}
      bpm={job.tempo_bpm}
      thumbnailUrl={job.has_thumbnail ? thumbnailUrl(job.id) : null}
      transpose={transpose}
      onTransposeChange={setTranspose}
      viewMode={viewMode}
      onChangeViewMode={changeViewMode}
      accentColor={accentColor}
      onDownloadAll={handleDownloadAll}
      isDownloadingAll={isDownloadingAll}
      onUploadAnother={onBack}
      stemNames={job.stem_names}
      getBuffer={(name) => engineRef.current?.getBuffer(name)}
      channelStates={channelStates}
      soloedStems={soloedStems}
      stemUrl={(name) => stemUrl(job.id, name)}
      onToggleMute={toggleMute}
      onToggleSolo={toggleSolo}
      onVolumeChange={changeVolume}
      onWaveSurferReady={(stemName, instance) => waveSurfersRef.current.set(stemName, instance)}
      onWaveSurferRemove={(stemName) => waveSurfersRef.current.delete(stemName)}
      segments={chordSegments}
      currentTime={currentTime}
      duration={duration}
      onSeek={handleSeek}
      isPlaying={isPlaying}
      onPlayPause={handlePlayPause}
      metronomeEnabled={metronomeEnabled}
      onToggleMetronome={job.tempo_bpm != null ? toggleMetronome : undefined}
      masterVolume={masterVolume}
      onMasterVolumeChange={changeMasterVolume}
    />
  );

  if (viewMode === "studio") {
    return (
      <>
        <div
          className="fixed inset-0 z-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% -10%, rgba(180,120,60,0.10), transparent 45%), linear-gradient(180deg, #140d09 0%, #0a0605 60%, #030202 100%)",
          }}
        />
        <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-4 p-8">
          <StudioCabinet>
            <div className="flex flex-col gap-4">{studioContent}</div>
          </StudioCabinet>
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      {header}

      <ChordTimeline
        segments={chordSegments}
        currentTime={currentTime}
        duration={duration}
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
        duration={duration}
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
