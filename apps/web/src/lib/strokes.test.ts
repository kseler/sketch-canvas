import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Stroke } from '../types';
import { isLiveStroke, isStroke, LIVE_MAX_COORDS, liveTail, readStrokes } from './strokes';

// A valid stroke; each test breaks exactly one thing, so a failure points at one rule.
const valid = { kind: 'stroke', id: 'a1', tool: 'pen', color: '#111111', width: 4, points: [0, 0, 10, 10] };

describe('isStroke (elements in the shared document)', () => {
  it('accepts a valid stroke', () => {
    expect(isStroke(valid)).toBe(true);
  });

  it('accepts older strokes without kind or tool', () => {
    const { kind: _kind, tool: _tool, ...old } = valid;
    expect(isStroke(old)).toBe(true);
  });

  it('skips element kinds it does not know, like a future image', () => {
    expect(isStroke({ ...valid, kind: 'image' })).toBe(false);
  });

  it('needs a string id', () => {
    const { id: _id, ...noId } = valid;
    expect(isStroke(noId)).toBe(false);
    expect(isStroke({ ...valid, id: 7 })).toBe(false);
  });

  it.each([
    ['unknown tool', { tool: 'laser' }],
    ['CSS-injection color', { color: 'url(https://tracker.example/x)' }],
    ['zero width', { width: 0 }],
    ['negative width', { width: -4 }],
    ['huge width', { width: 10_000 }],
    ['NaN width', { width: Number.NaN }],
    ['points not an array', { points: '0,0,10,10' }],
    ['NaN in points', { points: [0, 0, Number.NaN, 10] }],
    ['Infinity in points', { points: [0, 0, Infinity, 10] }],
    ['string in points', { points: [0, 0, '10', 10] }],
  ])('rejects %s', (_label, change) => {
    expect(isStroke({ ...valid, ...change })).toBe(false);
  });

  it.each([null, undefined, 'stroke', 42, []])('rejects non-objects: %j', (value) => {
    expect(isStroke(value)).toBe(false);
  });
});

describe('isLiveStroke (strokes in progress, from awareness)', () => {
  const { id: _id, ...live } = valid;

  it('accepts a valid live stroke (no id needed)', () => {
    expect(isLiveStroke(live)).toBe(true);
  });

  it('accepts exactly LIVE_MAX_COORDS coordinates, rejects one pair more', () => {
    expect(isLiveStroke({ ...live, points: new Array(LIVE_MAX_COORDS).fill(1) })).toBe(true);
    expect(isLiveStroke({ ...live, points: new Array(LIVE_MAX_COORDS + 2).fill(1) })).toBe(false);
  });

  it('applies the same color rule as finished strokes', () => {
    expect(isLiveStroke({ ...live, color: 'url(https://tracker.example/x)' })).toBe(false);
  });
});

describe('liveTail', () => {
  it('returns short strokes unchanged (same array)', () => {
    const points = [1, 2, 3, 4];
    expect(liveTail(points)).toBe(points);
  });

  it('keeps only the newest LIVE_MAX_COORDS coordinates of a long stroke', () => {
    const points = Array.from({ length: LIVE_MAX_COORDS + 10 }, (_, i) => i);
    const tail = liveTail(points);
    expect(tail).toHaveLength(LIVE_MAX_COORDS);
    expect(tail.at(-1)).toBe(points.at(-1)); // ends where the stroke ends
    expect(tail[0]).toBe(10); // dropped the oldest 10
  });

  it('keeps x/y pairs aligned (tail always starts on an x)', () => {
    const points = Array.from({ length: LIVE_MAX_COORDS + 6 }, (_, i) => i);
    expect(liveTail(points)[0]! % 2).toBe(0);
  });

  it('is accepted by isLiveStroke even when the stroke is longer than the limit', () => {
    const { id: _id, ...live } = valid;
    const long = new Array(LIVE_MAX_COORDS * 2).fill(5);
    expect(isLiveStroke({ ...live, points: liveTail(long) })).toBe(true);
  });
});

describe('readStrokes', () => {
  // A Y.Array in a real doc, filled with whatever "clients" pushed (cast: the array is typed, the data is not).
  const arrayOf = (...items: unknown[]) => {
    const array = new Y.Doc().getArray<Stroke>('strokes');
    array.push(items as Stroke[]);
    return array;
  };

  it('returns valid strokes in order', () => {
    const second = { ...valid, id: 'a2' };
    expect(readStrokes(arrayOf(valid, second))).toEqual([valid, second]);
  });

  it('returns an empty list for an empty array', () => {
    expect(readStrokes(arrayOf())).toEqual([]);
  });

  it('skips broken and unknown elements instead of throwing', () => {
    const hostile = { ...valid, id: 'x', color: 'red; background: url(//evil)' };
    const image = { kind: 'image', id: 'i', url: '/u.png', x: 0, y: 0, w: 1, h: 1 };
    const noId = { ...valid, id: undefined };
    expect(readStrokes(arrayOf(hostile, valid, image, noId, 'text', 5, null))).toEqual([valid]);
  });
});
