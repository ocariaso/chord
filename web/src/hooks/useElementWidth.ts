import { useCallback, useState } from "react";

/** A callback ref plus the element's current content width, kept up to date by a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [(element: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(0);

  const ref = useCallback((element: T | null) => {
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
