// Stroke points are stored flat: [x1, y1, x2, y2, ...], the format Konva's <Line> expects.

export type Point = { x: number; y: number };

// Minimum on-screen distance between kept points, in screen pixels. Closer points look identical
// but still cost bytes in the shared document.
export const MIN_POINT_DISTANCE = 2;

function lastPoint(points: number[]): Point {
  // Callers only pass strokes that already have their starting point, so both entries exist.
  return { x: points[points.length - 2]!, y: points[points.length - 1]! };
}

// The threshold is in screen pixels, so divide by the zoom: at 2x zoom, 2 screen px = 1 canvas unit.
export function minDistanceFor(zoom: number): number {
  return MIN_POINT_DISTANCE / zoom;
}

// Keep `p` only if it is at least `minDistance` canvas units from the last kept point.
export function appendIfFar(points: number[], p: Point, minDistance: number): number[] {
  const last = lastPoint(points);
  return Math.hypot(p.x - last.x, p.y - last.y) >= minDistance ? [...points, p.x, p.y] : points;
}

// The filter may have dropped the pointer's final position; add it back so the stroke ends
// exactly where the pen lifted.
export function withFinalPoint(points: number[], final: Point | null): number[] {
  if (!final) return points;
  const last = lastPoint(points);
  return last.x === final.x && last.y === final.y ? points : [...points, final.x, final.y];
}
