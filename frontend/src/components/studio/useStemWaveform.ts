import { useEffect, type RefObject } from "react";
import WaveSurfer from "wavesurfer.js";

/** Renders a themed, non-interactive waveform for one stem inside a Studio amp, driven by the shared playback clock. */
export function useStemWaveform(
  containerRef: RefObject<HTMLDivElement | null>,
  name: string,
  buffer: AudioBuffer,
  url: string,
  waveColor: string,
  progressColor: string,
  height: number,
  onReady: (name: string, instance: WaveSurfer) => void
) {
  useEffect(() => {
    if (!containerRef.current) return;

    const instance = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor,
      progressColor,
      cursorColor: "#f5f5f5",
      cursorWidth: 1.5,
      interact: false,
      // A real media element (loaded from the same stem URL) gives WaveSurfer a genuine
      // duration to compute cursor/progress position from; `peaks` still skips re-decoding
      // for the waveform itself, since PlaybackEngine already owns audible playback.
      url,
      peaks: [buffer.getChannelData(0)],
      duration: buffer.duration,
    });
    onReady(name, instance);

    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);
}
