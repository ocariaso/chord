import { MetronomeIcon, PauseIcon, PlayIcon } from "../../components/icons";
import { resultsCopy } from "../../design/copy";
import { usePopover } from "../../hooks/usePopover";
import { useSeekDrag } from "../../hooks/useSeekDrag";
import { formatTime } from "../../utils/time";
import type { LoopState } from "./types";

const SPEED_OPTIONS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25];
const SEEK_STEP_SECONDS = 5;
const SEEK_LARGE_STEP_SECONDS = 30;
// Nocturne's disabled treatment (45% opacity), which its classes carry for .btn but .ch-chip doesn't.
const DISABLED_CHIP_STYLE = { opacity: 0.45 };

interface TransportProps {
  playing: boolean;
  onPlayPause: () => void;
  time: number;
  duration: number;
  onSeek: (seconds: number) => void;
  speed: number;
  /** Absent where pitch-preserving speed isn't available (AudioWorklet needs HTTPS or localhost). */
  onSpeedChange?: (rate: number) => void;
  loop: LoopState | null;
  onLoopPress: () => void;
  metronome: boolean;
  /** Absent when the job has no detected tempo to click at. */
  onToggleMetronome?: () => void;
  /** Below 720px: the template's `.ch-m-bar` — play, seek and Click. */
  compact: boolean;
}

function formatSpeed(rate: number): string {
  return `${Number.isInteger(rate * 10) ? rate.toFixed(1) : rate.toFixed(2)}×`;
}

function loopLabel(loop: LoopState | null): string {
  if (!loop) return resultsCopy.loopOff;
  if (loop.end === null) return resultsCopy.loopA(formatTime(loop.start));
  return resultsCopy.loopRange(formatTime(loop.start), formatTime(loop.end));
}

function SeekSlider({ time, duration, onSeek }: Pick<TransportProps, "time" | "duration" | "onSeek">) {
  const seekDrag = useSeekDrag(duration, onSeek);

  // role="slider" without key handling fails an accessibility audit (design.md#accessibility).
  function handleKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const step = event.shiftKey ? SEEK_LARGE_STEP_SECONDS : SEEK_STEP_SECONDS;
    let target: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        target = time + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        target = time - step;
        break;
      case "PageUp":
        target = time + SEEK_LARGE_STEP_SECONDS;
        break;
      case "PageDown":
        target = time - SEEK_LARGE_STEP_SECONDS;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = duration;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSeek(Math.max(0, Math.min(duration, target)));
  }

  return (
    // A 4px bar is a hard target; the transparent wrapper gives the pointer room without changing the look.
    <span className="flex min-w-0 flex-1 items-center self-stretch" style={{ cursor: "pointer", touchAction: "none" }} {...seekDrag}>
      <span
        className="ch-seek"
        style={{ "--p": duration > 0 ? Math.min(1, time / duration) : 0 } as React.CSSProperties}
        tabIndex={0}
        role="slider"
        aria-label={resultsCopy.seek}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={resultsCopy.seekText(formatTime(time), formatTime(duration))}
        onKeyDown={handleKeyDown}
      />
    </span>
  );
}

function SpeedChip({ speed, onSpeedChange }: Pick<TransportProps, "speed" | "onSpeedChange">) {
  const { open, setOpen, containerRef } = usePopover<HTMLSpanElement>();
  return (
    <span ref={containerRef} className="relative flex-none">
      <button
        type="button"
        className="ch-chip"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={resultsCopy.speedLabel(formatSpeed(speed))}
        title={onSpeedChange ? undefined : resultsCopy.speedUnavailable}
        disabled={!onSpeedChange}
        style={onSpeedChange ? undefined : DISABLED_CHIP_STYLE}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {formatSpeed(speed)}
      </button>
      {open && onSpeedChange && (
        <span
          className="ch-panel absolute flex flex-col"
          style={{ bottom: "calc(100% + var(--space-3))", right: 0, zIndex: 20, padding: "var(--space-4)", gap: "var(--space-3)" }}
          role="group"
          aria-label={resultsCopy.speedGroup}
        >
          <span className="ch-label">{resultsCopy.speedGroup}</span>
          <span className="grid" style={{ gridTemplateColumns: "repeat(3, auto)", gap: "var(--space-2)" }}>
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                type="button"
                className={rate === speed ? "ch-chip is-on" : "ch-chip"}
                aria-pressed={rate === speed}
                onClick={() => {
                  onSpeedChange(rate);
                  setOpen(false);
                }}
              >
                {formatSpeed(rate)}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** The transport: `.ch-transport` on the web, the template's `.ch-m-bar` below 720px. Both close the results card. */
export function Transport({
  playing,
  onPlayPause,
  time,
  duration,
  onSeek,
  speed,
  onSpeedChange,
  loop,
  onLoopPress,
  metronome,
  onToggleMetronome,
  compact,
}: TransportProps) {
  const metronomeClass = metronome ? "ch-chip is-on" : "ch-chip";
  const metronomeTitle = onToggleMetronome ? undefined : resultsCopy.noTempo;
  const metronomeStyle = onToggleMetronome ? undefined : DISABLED_CHIP_STYLE;
  const playLabel = playing ? resultsCopy.pause : resultsCopy.play;

  if (compact) {
    return (
      <div className="ch-m-bar">
        <button type="button" className="ch-play" onClick={onPlayPause} aria-label={playLabel}>
          {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>
        <SeekSlider time={time} duration={duration} onSeek={onSeek} />
        <button
          type="button"
          className={metronomeClass}
          aria-pressed={metronome}
          aria-label={resultsCopy.metronomeClick}
          title={metronomeTitle}
          disabled={!onToggleMetronome}
          style={metronomeStyle}
          onClick={onToggleMetronome}
        >
          {resultsCopy.click}
        </button>
      </div>
    );
  }

  return (
    <div className="ch-transport">
      <button type="button" className="ch-play" onClick={onPlayPause} aria-label={playLabel}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="ch-time">{formatTime(time)}</span>
      <SeekSlider time={time} duration={duration} onSeek={onSeek} />
      <span className="ch-time" style={{ color: "var(--color-neutral-600)" }}>
        {formatTime(duration)}
      </span>
      <SpeedChip speed={speed} onSpeedChange={onSpeedChange} />
      <button type="button" className={loop ? "ch-chip is-on" : "ch-chip"} aria-pressed={loop?.end != null} onClick={onLoopPress}>
        {loopLabel(loop)}
      </button>
      <button
        type="button"
        className={metronomeClass}
        aria-pressed={metronome}
        title={metronomeTitle}
        disabled={!onToggleMetronome}
        style={metronomeStyle}
        onClick={onToggleMetronome}
      >
        <MetronomeIcon />
        {metronome ? resultsCopy.metronomeOn : resultsCopy.metronomeOff}
      </button>
    </div>
  );
}
