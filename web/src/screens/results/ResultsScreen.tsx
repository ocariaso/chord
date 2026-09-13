import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getChords, stemUrl, type ChordSegment, type Job } from "../../api/client";
import { PlaybackEngine, type MeterReadings, type StemLoadFailure } from "../../audio/playbackEngine";
import { ScreenCard } from "../../components/ScreenCard";
import { failureCopy } from "../../design/copy";
import { PHONE_QUERY } from "../../design/layout";
import { audible, db, masterDb, type ResultView, type StemKey } from "../../design/player";
import { stemHue, stemName, templateStems, tonePivotHz } from "../../design/stems";
import { useLyrics } from "../../hooks/useLyrics";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { detectHasVocals } from "../../utils/hasVocals";
import { dbToGain, PAN_CENTER, panToStereo, TONE_FLAT, toneToShelfDb } from "../../utils/levels";
import { waveformPolygon } from "../../utils/peaks";
import { FailurePanel } from "../failure/FailurePanel";
import { ProcessingScreen } from "../processing/ProcessingScreen";
import { AnalogView } from "./AnalogView";
import { AnalysisBar } from "./AnalysisBar";
import { ChordBar } from "./ChordBar";
import { ConsoleView } from "./ConsoleView";
import { ExportDialog } from "./ExportDialog";
import { LyricsDialog, type LyricsDialogMode } from "./LyricsDialog";
import { MixerView } from "./MixerView";
import { INITIAL_PLAYER, playerReducer } from "./playerReducer";
import { ResultsTopbar } from "./ResultsTopbar";
import { Transport } from "./Transport";
import type { LoopState, StemControls, StemDisplay } from "./types";

interface ResultsScreenProps {
  job: Job;
  onBack: () => void;
  /** From useJobEvents, so the loading screen can time the stages it lists as done, as the design does. */
  stageSnapshots?: Record<number, Job>;
}

/** `loading` is the template's `processing-loading`; `failed` its `results-load-error`. */
type LoadPhase = "loading" | "failed" | "ready";

const VIEW_PANEL_ID = "results-view";
// A second loop press closer than this to the first is a double press, not the end of a loop.
const MIN_LOOP_SECONDS = 0.5;

/**
 * The template's results screen. Holds the engine and the template's PlayerState, plus what the template
 * leaves to the app — load phase, speed, loop, chords, lyrics and dialogs — and hands every view the same
 * stems and callbacks, so switching views never touches playback.
 */
export function ResultsScreen({ job, onBack, stageSnapshots }: ResultsScreenProps) {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const rafRef = useRef<number>(0);
  const reducedMotionRef = useRef(false);

  const [player, dispatch] = useReducer(playerReducer, INITIAL_PLAYER);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [failures, setFailures] = useState<StemLoadFailure[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [envelopes, setEnvelopes] = useState<Partial<Record<StemKey, string>>>({});
  const [speed, setSpeed] = useState(1);
  const [supportsSpeed, setSupportsSpeed] = useState(false);
  const [loop, setLoop] = useState<LoopState | null>(null);
  const [chordSegments, setChordSegments] = useState<ChordSegment[] | null | undefined>(undefined);
  const [hasVocals, setHasVocals] = useState(true);
  const [lyrics, setLyrics] = useLyrics(job.id);
  const [exportOpen, setExportOpen] = useState(false);
  const [lyricsDialog, setLyricsDialog] = useState<LyricsDialogMode | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  function applyLoad(engine: PlaybackEngine, loadFailures: StemLoadFailure[]) {
    const keys = templateStems(engine.stemNames);
    const vocals = engine.getBuffer("vocals");
    // A vocals stem that failed to load says nothing about the song, so it isn't treated as silent.
    const vocalsHeard = vocals ? detectHasVocals(vocals) : true;
    const vocalsAlreadyMixed = player.stems.some((stem) => stem.key === "vocals");
    // An instrumental's vocals stem is kept, marked and muted, rather than hidden.
    if (vocals && !vocalsHeard && !vocalsAlreadyMixed) engine.setMuted("vocals", true);

    dispatch({
      type: "stemsLoaded",
      duration: engine.duration,
      stems: keys.map((key) => ({
        key,
        gain: 1,
        muted: key === "vocals" && !vocalsHeard,
        solo: false,
        tone: TONE_FLAT,
        pan: PAN_CENTER,
      })),
    });
    setEnvelopes(Object.fromEntries(keys.map((key) => [key, waveformPolygon(engine.getBuffer(key)!)])));
    setHasVocals(vocalsHeard);
    setFailures(loadFailures);
    setPhase(loadFailures.length > 0 ? "failed" : "ready");
  }

  // By value: a job update carries a new stem_names array even when it holds the same stems.
  const stemList = templateStems(job.stem_names).join(",");

  useEffect(() => {
    const engine = new PlaybackEngine();
    engine.setTempoBpm(job.tempo_bpm);
    engineRef.current = engine;
    setSupportsSpeed(engine.supportsTimeStretch);
    let cancelled = false;

    const inputs = templateStems(job.stem_names).map((key) => ({ name: key, url: stemUrl(job.id, key), tonePivotHz: tonePivotHz(key) }));
    void engine.load(inputs).then((loadFailures) => {
      if (!cancelled) applyLoad(engine, loadFailures);
    });

    return () => {
      cancelled = true;
      engine.dispose();
    };
    // applyLoad only dispatches and sets state; re-running this effect for its identity would re-download every stem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, stemList]);

  useEffect(() => {
    let cancelled = false;
    setChordSegments(undefined);
    getChords(job.id)
      .then((segments) => {
        if (!cancelled) setChordSegments(segments);
      })
      .catch(() => {
        // No chord analysis for this job (detection switched off, or it never ran); the chord bar says so.
        if (!cancelled) setChordSegments(null);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    function tick() {
      const engine = engineRef.current;
      if (engine) {
        if (engine.hasEnded) {
          engine.pause();
          dispatch({ type: "playingChanged", playing: false });
        }
        const time = engine.getCurrentTime();
        // With reduced motion the playhead steps once a second instead of gliding every frame (design.md#accessibility).
        dispatch({ type: "timeChanged", time: reducedMotionRef.current ? Math.floor(time) : time });
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const readMeters = useCallback((target: MeterReadings, now: number) => {
    engineRef.current?.readMeters(target, now);
  }, []);

  async function handleRetryStems() {
    const engine = engineRef.current;
    if (!engine) return;
    setIsRetrying(true);
    // Every input was a template stem key, so every failure's name is one too.
    const retry = failures.map((failure) => ({
      name: failure.name,
      url: failure.url,
      tonePivotHz: tonePivotHz(failure.name as StemKey),
    }));
    const stillFailing = await engine.load(retry);
    setIsRetrying(false);
    applyLoad(engine, stillFailing);
  }

  function handlePlayPause() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      dispatch({ type: "playingChanged", playing: false });
    } else {
      void engine.play().then(() => {
        dispatch({ type: "playingChanged", playing: engine.isPlaying });
        setSpeed(engine.playbackRate);
        setSupportsSpeed(engine.supportsTimeStretch);
      });
    }
  }

  function handleSeek(seconds: number) {
    const engine = engineRef.current;
    if (!engine) return;
    // Seeking out of a set loop ends it; staying inside just moves within it.
    if (loop && loop.end !== null && (seconds < loop.start || seconds >= loop.end)) {
      engine.clearLoop();
      setLoop(null);
    }
    void engine.seek(seconds).then(() => {
      dispatch({ type: "timeChanged", time: engine.getCurrentTime() });
      dispatch({ type: "playingChanged", playing: engine.isPlaying });
    });
  }

  function stemState(key: StemKey) {
    return player.stems.find((stem) => stem.key === key);
  }

  const controls: StemControls = {
    onGainChange(key, gain) {
      engineRef.current?.setVolume(key, dbToGain(db(gain)));
      dispatch({ type: "stemChanged", key, change: { gain } });
    },
    onToggleMute(key) {
      const muted = !stemState(key)?.muted;
      engineRef.current?.setMuted(key, muted);
      dispatch({ type: "stemChanged", key, change: { muted } });
    },
    onToggleSolo(key) {
      const solo = !stemState(key)?.solo;
      engineRef.current?.setSolo(key, solo);
      dispatch({ type: "stemChanged", key, change: { solo } });
    },
    onToneChange(key, tone) {
      engineRef.current?.setTone(key, toneToShelfDb(tone));
      dispatch({ type: "stemChanged", key, change: { tone } });
    },
    onPanChange(key, pan) {
      engineRef.current?.setPan(key, panToStereo(pan));
      dispatch({ type: "stemChanged", key, change: { pan } });
    },
  };

  function handleMasterChange(master: number) {
    engineRef.current?.setMasterVolume(dbToGain(masterDb(master)));
    dispatch({ type: "masterChanged", master });
  }

  function handleToggleMetronome() {
    const metronome = !player.metronome;
    engineRef.current?.setMetronomeEnabled(metronome);
    dispatch({ type: "metronomeChanged", metronome });
  }

  function handleSpeedChange(rate: number) {
    const engine = engineRef.current;
    if (!engine) return;
    setSpeed(rate);
    void engine.setPlaybackRate(rate).then(() => {
      setSpeed(engine.playbackRate);
      dispatch({ type: "playingChanged", playing: engine.isPlaying });
      setSupportsSpeed(engine.supportsTimeStretch);
    });
  }

  /** A-B loop: the first press marks A, the second marks B and starts looping, a third ends the loop. */
  function handleLoopPress() {
    const engine = engineRef.current;
    if (!engine) return;
    const now = engine.getCurrentTime();
    if (!loop) {
      setLoop({ start: now, end: null });
      return;
    }
    if (loop.end === null) {
      const start = Math.min(loop.start, now);
      const end = Math.max(loop.start, now);
      if (end - start < MIN_LOOP_SECONDS) return;
      setLoop({ start, end });
      void engine.setLoop({ start, end }).then(() => dispatch({ type: "playingChanged", playing: engine.isPlaying }));
      return;
    }
    engine.clearLoop();
    setLoop(null);
  }

  if (phase === "loading") {
    return <ProcessingScreen job={job} onCancel={onBack} stageSnapshots={stageSnapshots} loading />;
  }

  if (phase === "failed") {
    const copy = failureCopy["results-load-error"];
    return (
      <FailurePanel
        tone="danger"
        title={copy.title}
        body={copy.body(failures.length)}
        log={failures.map((failure) => copy.log(failure.url, failure.message)).join("\n")}
        primary={{ label: isRetrying ? copy.retrying : copy.primary, onClick: () => void handleRetryStems(), disabled: isRetrying }}
        secondary={{ label: copy.secondary, onClick: () => setPhase("ready"), disabled: isRetrying }}
      />
    );
  }

  const anySolo = player.stems.some((stem) => stem.solo);
  const stems: StemDisplay[] = player.stems.map((state) => ({
    state,
    name: stemName(state.key),
    hue: stemHue(state.key),
    audible: audible(state, anySolo),
    silent: state.key === "vocals" && !hasVocals,
    envelope: envelopes[state.key] ?? null,
  }));
  // Below 720px the results lock to the Mixer and the view tabs aren't rendered (design.md#responsive).
  const view: ResultView = isPhone ? "mixer" : player.view;

  return (
    <>
      <ScreenCard fill>
        <ResultsTopbar
          job={job}
          duration={player.duration}
          stemCount={stems.length}
          view={view}
          panelId={VIEW_PANEL_ID}
          onViewChange={isPhone ? undefined : (next) => dispatch({ type: "viewChanged", view: next })}
          onExport={() => setExportOpen(true)}
          onNewTrack={onBack}
        />
        <AnalysisBar
          keyEstimate={job.key_estimate}
          keyConfidence={job.key_confidence}
          transpose={player.transpose}
          onTransposeChange={(transpose) => dispatch({ type: "transposeChanged", transpose })}
          tempoBpm={job.tempo_bpm}
          master={player.master}
          onMasterChange={handleMasterChange}
        />
        <ChordBar
          segments={chordSegments}
          time={player.time}
          duration={player.duration}
          transpose={player.transpose}
          onSeek={handleSeek}
          lyrics={lyrics}
          onOpenLyricSheet={() => setLyricsDialog("sheet")}
          onAddLyrics={() => setLyricsDialog("edit")}
          instrumental={stems.some((stem) => stem.silent)}
        />
        {/* The view takes whatever height the bars leave. The page never scrolls; on a phone six stacked stem rows
            can't fit beside the transport, so this panel alone may. */}
        <div
          id={VIEW_PANEL_ID}
          className="flex min-h-0 flex-1 flex-col"
          style={{ overflowY: isPhone ? "auto" : "hidden" }}
          role={isPhone ? undefined : "tabpanel"}
          aria-labelledby={isPhone ? undefined : `${VIEW_PANEL_ID}-${view}-tab`}
        >
          {view === "mixer" && (
            <MixerView stems={stems} controls={controls} playhead={player.duration > 0 ? Math.min(1, player.time / player.duration) : 0} />
          )}
          {view === "console" && (
            <ConsoleView
              stems={stems}
              controls={controls}
              master={player.master}
              onMasterChange={handleMasterChange}
              metronome={player.metronome}
              onExport={() => setExportOpen(true)}
              readMeters={readMeters}
            />
          )}
          {view === "analog" && <AnalogView stems={stems} controls={controls} readMeters={readMeters} />}
        </div>
        <Transport
          playing={player.playing}
          onPlayPause={handlePlayPause}
          time={player.time}
          duration={player.duration}
          onSeek={handleSeek}
          speed={speed}
          onSpeedChange={supportsSpeed ? handleSpeedChange : undefined}
          loop={loop}
          onLoopPress={handleLoopPress}
          metronome={player.metronome}
          onToggleMetronome={job.tempo_bpm ? handleToggleMetronome : undefined}
          compact={isPhone}
        />
      </ScreenCard>
      {exportOpen && <ExportDialog jobId={job.id} trackTitle={job.original_filename} stems={stems} onClose={() => setExportOpen(false)} />}
      {lyricsDialog && (
        <LyricsDialog
          jobId={job.id}
          mode={lyricsDialog}
          lyrics={lyrics}
          onSaved={(saved) => {
            setLyrics(saved);
            setLyricsDialog(null);
          }}
          onClose={() => setLyricsDialog(null)}
        />
      )}
    </>
  );
}
