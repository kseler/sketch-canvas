import type * as Y from 'yjs';
import type { Stroke } from '../types';
import { isHexColor } from './color';

// A stroke someone is still drawing, shared through awareness. It gets an id only when the pen
// lifts and it moves into the document.
export type LiveStroke = Omit<Stroke, 'id'>;

// Awareness resends the whole live stroke ~20 times a second, so a long stroke costs a lot of
// bandwidth. Above this size only the newest part is sent (see liveTail); the finished stroke still
// goes to the document in full on pen-up.
export const LIVE_MAX_COORDS = 20_000;

const MAX_WIDTH = 200;

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// Shape checks for data from other players or the shared document: a broken or hostile client
// must not be able to crash or freeze our screen, or inject CSS through a color.
function hasStrokeShape(s: Record<string, unknown>): boolean {
  return (
    (s.kind === undefined || s.kind === 'stroke') &&
    (s.tool === undefined || s.tool === 'pen' || s.tool === 'eraser') &&
    isHexColor(s.color) &&
    isFiniteNumber(s.width) &&
    s.width > 0 &&
    s.width <= MAX_WIDTH &&
    Array.isArray(s.points) &&
    s.points.every(isFiniteNumber)
  );
}

const asRecord = (value: unknown) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null);

// Elements in the shared document. Anything that isn't a valid stroke (including element kinds a
// newer version of the app may add) is skipped, not rendered.
export function isStroke(value: unknown): value is Stroke {
  const s = asRecord(value);
  return s !== null && typeof s.id === 'string' && hasStrokeShape(s);
}

// Valid strokes from the shared document. Unknown or broken elements are skipped, so data from a
// newer app version (or a broken client) can't crash this tab or end up in an exported sketch.
// (Typed Y.Array<Stroke> like the room's array, but its items are still checked: it holds whatever
// any client pushed.)
export function readStrokes(strokes: Y.Array<Stroke>): Stroke[] {
  return strokes.toArray().filter(isStroke);
}

export function isLiveStroke(value: unknown): value is LiveStroke {
  const s = asRecord(value);
  return s !== null && hasStrokeShape(s) && (s.points as unknown[]).length <= LIVE_MAX_COORDS;
}

// The newest part of a long stroke, so the live preview never exceeds LIVE_MAX_COORDS (and never
// vanishes for others). Keeps an even count so x/y pairs stay aligned.
export function liveTail(points: number[]): number[] {
  return points.length <= LIVE_MAX_COORDS ? points : points.slice(points.length - LIVE_MAX_COORDS);
}
