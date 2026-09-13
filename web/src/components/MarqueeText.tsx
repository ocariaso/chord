import { useLayoutEffect, useRef, useState } from "react";

const GAP_PX = 48;
const PX_PER_SECOND = 40;
const MIN_DURATION_S = 4;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface MarqueeTextProps {
  text: string;
  as?: "span" | "h1";
  className?: string;
  style?: React.CSSProperties;
}

/** Plain truncated text, or — once it's wide enough to overflow its container — a looping scroll. */
export function MarqueeText({ text, as: Tag = "span", className, style }: MarqueeTextProps) {
  const containerRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [textWidth, setTextWidth] = useState(0);

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      const measureEl = measureRef.current;
      if (!container || !measureEl) return;
      const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
      setTextWidth(measureEl.scrollWidth);
      setOverflows(!reducedMotion && measureEl.scrollWidth > container.clientWidth);
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [text]);

  const duration = Math.max(MIN_DURATION_S, (textWidth + GAP_PX) / PX_PER_SECOND);

  return (
    <Tag
      ref={containerRef as React.RefObject<HTMLHeadingElement & HTMLSpanElement>}
      className={className}
      style={{ ...style, position: "relative", overflow: "hidden", whiteSpace: "nowrap" }}
    >
      <span ref={measureRef} aria-hidden="true" style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap" }}>
        {text}
      </span>
      {overflows ? (
        <span style={{ display: "inline-flex", animation: `chord-marquee ${duration}s linear infinite` }}>
          <span style={{ paddingRight: GAP_PX, whiteSpace: "nowrap" }}>{text}</span>
          <span aria-hidden="true" style={{ paddingRight: GAP_PX, whiteSpace: "nowrap" }}>{text}</span>
        </span>
      ) : (
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      )}
    </Tag>
  );
}
