import { useState } from "react";
import { useAnimationFrame } from "./useAnimationFrame";

/**
 * Something a component shows from the playback clock — a whole-second readout, the current chord — re-read every
 * animation frame but rendered only when it changes. The clock moves every frame; what's shown from it rarely does.
 */
export function useClockValue<T extends string | number>(read: () => T): T {
  const [value, setValue] = useState(read);
  // Given the value it already holds, a state setter bails out without rendering.
  useAnimationFrame(true, () => setValue(read()));
  return value;
}
