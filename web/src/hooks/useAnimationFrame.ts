import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Calls `onFrame` every animation frame while `active`. For displays that write straight to the DOM
 * (meters, needles): a custom-property write per frame is cheap, a React re-render per frame is not.
 */
export function useAnimationFrame(active: boolean, onFrame: (now: number) => void): void {
  const onFrameRef = useRef(onFrame);

  useLayoutEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    if (!active) return;
    let handle = 0;
    function tick(now: number) {
      onFrameRef.current(now);
      handle = requestAnimationFrame(tick);
    }
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [active]);
}
