import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';
import styles from './Menu.module.css';

const WIDTH = 280;
const EDGE = 8; // keep this far from the window's edges
const GAP = 8; // between the button and the panel

type Place = { top: number; left: number; width: number };

// Where the panel goes: under the button, its right edge lined up with the button's, moved in to
// stay on screen at either edge, and never wider than the window.
export function placeMenu(button: Pick<DOMRect, 'left' | 'right' | 'bottom'>, windowWidth: number): Place {
  const width = Math.min(WIDTH, windowWidth - 2 * EDGE);
  const left = Math.min(Math.max(button.right - width, EDGE), windowWidth - EDGE - width);
  return { top: button.bottom + GAP, left, width };
}

// A "⋯" button that opens a small panel below it. Closes on a click outside, Escape, or a resize
// (rather than staying where the button used to be).
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [place, setPlace] = useState<Place | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = place !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    // Capture phase, so the menu (on top) takes Escape before the result panel behind it does.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect();
    setPlace(open || !rect ? null : placeMenu(rect, window.innerWidth));
  };

  return (
    <div ref={root}>
      <IconButton ref={button} label={label} round aria-expanded={open} onClick={toggle}>
        <MoreHorizontal size={20} />
      </IconButton>
      {place && (
        <div className={styles.panel} role="group" aria-label={label} style={{ top: place.top, left: place.left, width: place.width }}>
          {children}
        </div>
      )}
    </div>
  );
}
