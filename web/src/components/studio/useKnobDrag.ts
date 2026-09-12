import { useRef } from "react";

/** Vertical drag-to-adjust interaction shared by every knob in the Studio view. */
export function useKnobDrag(value: number, onChange: (value: number) => void, sensitivity = 200) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startValue: value };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const delta = (dragRef.current.startY - e.clientY) / sensitivity;
    const next = Math.max(0, Math.min(1, dragRef.current.startValue + delta));
    onChange(next);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }

  return { onPointerDown, onPointerMove, onPointerUp };
}

/** Maps a 0-1 value to the -135..135 degree sweep a real potentiometer travels. */
export function valueToRotation(value: number): number {
  return -135 + value * 270;
}
