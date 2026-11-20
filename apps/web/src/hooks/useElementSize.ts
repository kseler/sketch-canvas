import { useLayoutEffect, useRef, useState } from 'react';

export type ElementSize = { width: number; height: number };

// Tracks an element's inner size as the window resizes.
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  // Layout effect + an immediate read: the first size is known before the browser paints, so
  // there is no blank frame. ResizeObserver alone reports only on the next rendering frame,
  // which never comes in a hidden tab.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
