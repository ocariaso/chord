import { useLayoutEffect, useRef } from "react";
import { useAnimationFrame } from "./useAnimationFrame";

/**
 * A ref for an element whose `--p` follows the playback clock. `progress` (0…1) is written straight to the element's
 * style every animation frame, as the meters are, so a moving playhead re-renders nothing. The element must not set
 * `--p` itself.
 */
export function usePlayhead<T extends HTMLElement>(progress: () => number) {
  const ref = useRef<T>(null);

  function write() {
    const element = ref.current;
    const value = progress().toFixed(4);
    // While paused nothing moves, and nothing needs restyling.
    if (element && element.style.getPropertyValue("--p") !== value) element.style.setProperty("--p", value);
  }

  // After every render too, so a playhead mounted while paused is in place before it is first painted.
  useLayoutEffect(write);
  useAnimationFrame(true, write);
  return ref;
}
