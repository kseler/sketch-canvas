import { describe, expect, it } from 'vitest';
import { appendIfFar, isPoint, MIN_POINT_DISTANCE, minDistanceFor, withFinalPoint } from './points';

// A valid cursor position; each test breaks exactly one thing, so a failure points at one rule.
const valid = { x: 10, y: 20 };

describe('isPoint (cursor positions from other players)', () => {
  it('accepts a valid point', () => {
    expect(isPoint(valid)).toBe(true);
  });

  it('accepts negative, zero and fractional coordinates (the canvas extends in every direction)', () => {
    expect(isPoint({ x: -5.5, y: 0 })).toBe(true);
  });

  it('accepts a point with extra fields', () => {
    expect(isPoint({ ...valid, pressure: 0.5 })).toBe(true);
  });

  // NaN / Infinity would end up in Konva positions and break rendering for every viewer.
  it.each([
    ['NaN x', { x: Number.NaN }],
    ['NaN y', { y: Number.NaN }],
    ['Infinity x', { x: Infinity }],
    ['-Infinity y', { y: -Infinity }],
    ['string x', { x: '10' }],
    ['null y', { y: null }],
    ['missing x', { x: undefined }],
    ['object x', { x: { valueOf: (): number => 10 } }],
  ])('rejects %s', (_label, change) => {
    expect(isPoint({ ...valid, ...change })).toBe(false);
  });

  it.each([null, undefined, 'x:10,y:20', 42, [10, 20], {}])('rejects non-points: %j', (value) => {
    expect(isPoint(value)).toBe(false);
  });
});

describe('minDistanceFor', () => {
  it('is MIN_POINT_DISTANCE canvas units at 1x zoom', () => {
    expect(minDistanceFor(1)).toBe(MIN_POINT_DISTANCE);
  });

  it('shrinks when zoomed in, so the threshold stays the same on screen', () => {
    expect(minDistanceFor(2)).toBe(MIN_POINT_DISTANCE / 2);
  });

  it('grows when zoomed out', () => {
    expect(minDistanceFor(0.5)).toBe(MIN_POINT_DISTANCE * 2);
  });
});

describe('appendIfFar', () => {
  const start = [0, 0];

  it('keeps a point that is far enough from the last kept point', () => {
    expect(appendIfFar(start, { x: 3, y: 4 }, 2)).toEqual([0, 0, 3, 4]);
  });

  it('keeps a point at exactly the minimum distance', () => {
    expect(appendIfFar(start, { x: 3, y: 4 }, 5)).toEqual([0, 0, 3, 4]);
  });

  it('drops a point closer than the minimum and returns the same array (no re-render)', () => {
    expect(appendIfFar(start, { x: 1, y: 1 }, 2)).toBe(start);
  });

  it('measures from the last point, not the first', () => {
    const points = [0, 0, 100, 100];
    expect(appendIfFar(points, { x: 101, y: 100 }, 2)).toBe(points);
    expect(appendIfFar(points, { x: 0, y: 0 }, 2)).toEqual([0, 0, 100, 100, 0, 0]);
  });

  it('uses straight-line distance, not per-axis distance', () => {
    // 1.5 on each axis is under 2, but the diagonal is ~2.12.
    expect(appendIfFar(start, { x: 1.5, y: 1.5 }, 2)).toEqual([0, 0, 1.5, 1.5]);
  });

  it('does not mutate the input', () => {
    const points = [0, 0];
    appendIfFar(points, { x: 10, y: 10 }, 2);
    expect(points).toEqual([0, 0]);
  });
});

describe('withFinalPoint', () => {
  it('adds the pen-lift position when the filter dropped it', () => {
    expect(withFinalPoint([0, 0, 10, 10], { x: 11, y: 10 })).toEqual([0, 0, 10, 10, 11, 10]);
  });

  it('returns the same array when the stroke already ends there', () => {
    const points = [0, 0, 10, 10];
    expect(withFinalPoint(points, { x: 10, y: 10 })).toBe(points);
  });

  it('returns the same array when there is no final position', () => {
    const points = [0, 0, 10, 10];
    expect(withFinalPoint(points, null)).toBe(points);
  });

  it('compares with the last point, not the first', () => {
    expect(withFinalPoint([5, 5, 10, 10], { x: 5, y: 5 })).toEqual([5, 5, 10, 10, 5, 5]);
  });

  it('adds the point when only one coordinate matches', () => {
    expect(withFinalPoint([0, 0, 10, 10], { x: 10, y: 11 })).toEqual([0, 0, 10, 10, 10, 11]);
  });

  it('does not mutate the input', () => {
    const points = [0, 0];
    withFinalPoint(points, { x: 1, y: 1 });
    expect(points).toEqual([0, 0]);
  });
});
