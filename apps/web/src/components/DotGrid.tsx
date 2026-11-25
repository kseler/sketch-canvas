// The "generating" picture everyone in the room sees while a job runs: a dark 4:3 square with a
// grid of blue dots that swell and fade in soft, drifting waves. No steps and no percentage: the
// server can't know how far the image model is. Pure CSS; with reduced motion the dots stay still.

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

const STYLE = `
@keyframes dotgrid-swell {
  0%, 100% { transform: scale(0.25); opacity: 0.25; }
  50% { transform: scale(1); opacity: 1; }
}
.dotgrid-dot { animation: dotgrid-swell ${PERIOD_S}s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dotgrid-dot { animation: none; transform: scale(0.5); opacity: 0.6; }
}
`;

export function DotGrid() {
  return (
    <div
      role="status"
      aria-label="Generating the picture"
      style={{
        aspectRatio: '4 / 3',
        width: '100%',
        boxSizing: 'border-box',
        background: '#0b1020',
        padding: '6%',
        display: 'grid',
        gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        placeItems: 'center',
      }}
    >
      <style>{STYLE}</style>
      {DOTS.map((delay, i) => (
        <span
          key={i}
          className="dotgrid-dot"
          style={{
            width: '70%',
            aspectRatio: '1',
            borderRadius: '50%',
            background: '#3b82f6',
            animationDelay: `${delay.toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}
