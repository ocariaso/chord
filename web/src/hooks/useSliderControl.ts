import { useRef } from "react";

/** How pointer movement maps onto the value: along the track, or vertical drag for a knob. */
export type SliderAxis = "horizontal" | "vertical" | "knob";

interface SliderControlOptions {
  value: number;
  onChange: (value: number) => void;
  axis: SliderAxis;
}

// INSTRUCTIONS §4.3: a knob's full range is 160 px of vertical drag. Rotational drag is unusable with a mouse.
const KNOB_DRAG_PIXELS = 160;
const FINE_STEP = 0.01;
const COARSE_STEP = 0.1;

function clamp(value: number): number {
  // Rounded so repeated arrow steps don't accumulate float noise into aria-valuenow.
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/**
 * Pointer and keyboard handling for a 0…1 control drawn by a `ch-` class through `--v` (INSTRUCTIONS §4.1:
 * ±0.01 on an arrow, ±0.1 with Shift, 0 and 1 on Home and End; Page Up and Down step like Shift).
 */
export function useSliderControl({ value, onChange, axis }: SliderControlOptions) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);

  function valueFromPointer(element: HTMLElement, clientX: number, clientY: number): number {
    const rect = element.getBoundingClientRect();
    if (axis === "vertical") return clamp((rect.bottom - clientY) / rect.height);
    return clamp((clientX - rect.left) / rect.width);
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    // preventDefault above also cancels the focus a press would give; keyboard control should follow a click.
    element.focus({ preventScroll: true });
    dragRef.current = { startY: event.clientY, startValue: value };
    if (axis !== "knob") onChange(valueFromPointer(element, event.clientX, event.clientY));
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (axis === "knob") {
      onChange(clamp(drag.startValue + (drag.startY - event.clientY) / KNOB_DRAG_PIXELS));
    } else {
      onChange(valueFromPointer(event.currentTarget, event.clientX, event.clientY));
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const step = event.shiftKey ? COARSE_STEP : FINE_STEP;
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = value + step;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = value - step;
        break;
      case "PageUp":
        next = value + COARSE_STEP;
        break;
      case "PageDown":
        next = value - COARSE_STEP;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(clamp(next));
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown };
}
