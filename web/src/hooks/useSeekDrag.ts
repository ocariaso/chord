import { useRef } from "react";

/** Click-or-hold-and-drag seeking over a horizontal bar — the element it's attached to defines 0%-100%. */
export function useSeekDrag(duration: number, onSeek: (seconds: number) => void) {
  const draggingRef = useRef(false);

  function seek(target: Element, clientX: number) {
    if (duration <= 0) return;
    const rect = target.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(fraction, 1)) * duration);
  }

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // avoid the browser starting a text/drag selection while seeking
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(e.currentTarget, e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!draggingRef.current) return;
    seek(e.currentTarget, e.clientX);
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
