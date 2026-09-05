import { useLayoutEffect, useRef, useState } from "react";

interface ZoomOverlayProps {
  /** The clicked element's rect, in viewport coordinates — where the overlay zooms in from and back out to. */
  originRect: DOMRect;
  onClose: () => void;
  children: React.ReactNode;
  /** Target magnification for the settled state (2 = 200%), capped to whatever actually fits the viewport. */
  maxZoomScale?: number;
}

const TRANSITION_MS = 280;

/** Computes the transform that maps `naturalRect` (the card's own unscaled box) onto `originRect`. */
function transformBetween(naturalRect: DOMRect, originRect: DOMRect): string {
  const scaleX = originRect.width / naturalRect.width;
  const scaleY = originRect.height / naturalRect.height;
  const dx = originRect.x + originRect.width / 2 - (naturalRect.x + naturalRect.width / 2);
  const dy = originRect.y + originRect.height / 2 - (naturalRect.y + naturalRect.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
}

/** A "closer look" overlay that zooms its children in from where they were clicked, and back out on close. */
export function ZoomOverlay({ originRect, onClose, children, maxZoomScale = 2 }: ZoomOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const naturalRectRef = useRef<DOMRect | null>(null);
  const [closing, setClosing] = useState(false);
  const [backdropVisible, setBackdropVisible] = useState(false);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "none";
    card.style.transform = "none";
    const naturalRect = card.getBoundingClientRect();
    naturalRectRef.current = naturalRect;

    const restScale = Math.min(
      maxZoomScale,
      (window.innerWidth * 0.9) / naturalRect.width,
      (window.innerHeight * 0.9) / naturalRect.height
    );

    card.style.opacity = "0";
    card.style.transform = transformBetween(naturalRect, originRect);
    // Force a reflow so the browser registers the starting transform before animating away from it.
    void card.getBoundingClientRect();
    requestAnimationFrame(() => {
      card.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${TRANSITION_MS}ms ease`;
      card.style.transform = `scale(${restScale})`;
      card.style.opacity = "1";
      setBackdropVisible(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    const card = cardRef.current;
    const naturalRect = naturalRectRef.current;
    if (card && naturalRect) {
      card.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.4,0,0.6,1), opacity ${TRANSITION_MS}ms ease`;
      card.style.transform = transformBetween(naturalRect, originRect);
      card.style.opacity = "0";
    }
    setBackdropVisible(false);
    setClosing(true);
    window.setTimeout(onClose, TRANSITION_MS);
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto overscroll-contain p-8"
      style={{
        backgroundColor: backdropVisible ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0)",
        transition: `background-color ${TRANSITION_MS}ms ease`,
        pointerEvents: closing ? "none" : "auto",
      }}
      onClick={handleClose}
    >
      <div className="flex min-h-full items-center justify-center">
        <div ref={cardRef} onClick={(e) => e.stopPropagation()} className="relative">
          <button
            onClick={handleClose}
            className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 shadow-lg hover:bg-neutral-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="14" height="14">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
