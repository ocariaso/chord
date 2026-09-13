import { useLayoutEffect, useRef, useState } from "react";

interface FitToPanelProps {
  /** Off below 720px, where the panel scrolls instead: scaling would shrink the 44px touch targets. */
  enabled: boolean;
  /** The narrowest width the view lays out at before its controls collapse — its stylesheet floors, summed. */
  minWidth?: number;
  children: React.ReactNode;
}

// A change smaller than this is measurement noise; chasing it would re-render on every observer callback.
const SCALE_EPSILON = 0.005;

/**
 * Fills the results view panel and, only when the view doesn't fit it, scales the view down uniformly, so a page that
 * never scrolls crops nothing either. `transform` rather than `zoom`: the layout box keeps its natural size, so the view
 * can be measured at any scale, and pointer maths through getBoundingClientRect already follows the transform.
 */
export function FitToPanel({ enabled, minWidth = 0, children }: FitToPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!enabled || !panel || !content) return;

    function fit() {
      const width = panel!.clientWidth;
      const height = panel!.clientHeight;
      if (width === 0 || height === 0) return;
      // Unscaled, the content grows to fill the panel, so it is taller than the panel only when the view is; scaled, it
      // keeps the view's own height. Either way panel over content is the scale that fits — offsetHeight ignores the
      // transform.
      const next = Math.min(1, height / content!.offsetHeight, minWidth > 0 ? width / minWidth : 1);
      setScale((current) => (Math.abs(current - next) < SCALE_EPSILON ? current : next));
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(panel);
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, minWidth]);

  const scaled = enabled && scale < 1;
  return (
    <div ref={panelRef} className="flex min-h-0 flex-1 flex-col" style={{ overflow: enabled ? "hidden" : undefined }}>
      <div
        ref={contentRef}
        className="flex flex-col"
        style={{
          // Scaled content keeps its natural height, and is widened by the inverse scale so it still spans the panel.
          flex: scaled ? "none" : "1 0 auto",
          width: scaled ? `${100 / scale}%` : undefined,
          transform: scaled ? `scale(${scale})` : undefined,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
