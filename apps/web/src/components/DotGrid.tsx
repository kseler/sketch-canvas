import styles from './DotGrid.module.css';

// The "generating" picture everyone in the room sees while a job runs: a soft 4:3 card with a
// grid of accent-purple dots that swell and fade in soft, drifting waves. No steps and no percentage: the
// server can't know how far the image model is. The animation is in DotGrid.module.css; with
// reduced motion the dots stay still.

const COLUMNS = 16;
const ROWS = 12;
const PERIOD_S = 2.8;

// Each dot starts its swell at a different moment. Delays from a few overlapping waves (not a
// straight diagonal) give the blob-like look; the same for every render, so no flicker.
function delayFor(x: number, y: number): number {
  const wave = Math.sin(x * 0.55) + Math.cos(y * 0.7) + Math.sin((x + y) * 0.32) + Math.cos((x - y) * 0.21);
  return -((wave + 4) / 8) * PERIOD_S;
}

const DOTS = Array.from({ length: COLUMNS * ROWS }, (_, i) => delayFor(i % COLUMNS, Math.floor(i / COLUMNS)));

export function DotGrid() {
  return (
    <div
      role="status"
      aria-label="Generating the picture"
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}
    >
      {DOTS.map((delay, i) => (
        // Only the delay differs per dot; it shifts each dot's place in the shared swell.
        <span key={i} data-dot="" className={styles.dot} style={{ animationDelay: `${delay.toFixed(2)}s`, animationDuration: `${PERIOD_S}s` }} />
      ))}
    </div>
  );
}
