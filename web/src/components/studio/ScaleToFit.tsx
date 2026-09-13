import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Measures its child's natural (unconstrained) size and shrinks it — via a CSS transform, never
 * reflowing the child itself — to fit whatever width is actually available. Never scales up past
 * 1, so on desktop (where the design's native pixel widths already fit) this is a no-op.
 */
export function ScaleToFit({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    function recompute() {
      // offsetWidth/Height reflect the element's own layout box, unaffected by the transform below.
      const naturalWidth = inner!.offsetWidth;
      const naturalHeight = inner!.offsetHeight;
      const availableWidth = outer!.clientWidth;
      setNaturalSize({ width: naturalWidth, height: naturalHeight });
      setScale(naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1);
    }

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="w-full">
      <div
        style={{
          width: naturalSize.width * scale,
          height: naturalSize.height * scale,
          overflow: "hidden",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <div ref={innerRef} style={{ display: "inline-block", transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
