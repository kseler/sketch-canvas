import { describe, expect, it } from 'vitest';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './canvasSize';
import { exportArea } from './exportSketch';

// exportSketch itself needs a real <canvas> (Konva), which jsdom does not have; not tested here.

describe('exportArea', () => {
  it('is the whole canvas when there is no region', () => {
    expect(exportArea()).toEqual({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  });

  it('keeps a region that lies inside the canvas', () => {
    expect(exportArea({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('keeps a region that is exactly the canvas', () => {
    expect(exportArea({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT })).toEqual({
      x: 0,
      y: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
  });

  it.each([
    ['left', { x: -10, y: 5, width: 30, height: 10 }, { x: 0, y: 5, width: 20, height: 10 }],
    ['top', { x: 5, y: -10, width: 10, height: 30 }, { x: 5, y: 0, width: 10, height: 20 }],
    ['right', { x: CANVAS_WIDTH - 10, y: 5, width: 30, height: 10 }, { x: CANVAS_WIDTH - 10, y: 5, width: 10, height: 10 }],
    ['bottom', { x: 5, y: CANVAS_HEIGHT - 10, width: 10, height: 30 }, { x: 5, y: CANVAS_HEIGHT - 10, width: 10, height: 10 }],
    ['every edge', { x: -50, y: -50, width: CANVAS_WIDTH + 100, height: CANVAS_HEIGHT + 100 }, { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }],
  ])('clips a region that sticks out at the %s', (_label, region, expected) => {
    expect(exportArea(region)).toEqual(expected);
  });

  it('rounds fractional coordinates outward to whole pixels', () => {
    // x 10.5..20.25 -> 10..21, y 1.9..3.1 -> 1..4
    expect(exportArea({ x: 10.5, y: 1.9, width: 9.75, height: 1.2 })).toEqual({ x: 10, y: 1, width: 11, height: 3 });
  });

  it.each([
    ['entirely left of the canvas', { x: -20, y: 0, width: 10, height: 10 }],
    ['entirely above the canvas', { x: 0, y: -20, width: 10, height: 10 }],
    ['entirely right of the canvas', { x: CANVAS_WIDTH + 1, y: 0, width: 10, height: 10 }],
    ['entirely below the canvas', { x: 0, y: CANVAS_HEIGHT + 1, width: 10, height: 10 }],
    ['touching the canvas edge only', { x: CANVAS_WIDTH, y: 0, width: 10, height: 10 }],
    ['zero width', { x: 5, y: 5, width: 0, height: 10 }],
    ['zero height', { x: 5, y: 5, width: 10, height: 0 }],
    ['negative width', { x: 50, y: 5, width: -10, height: 10 }],
    ['negative height', { x: 5, y: 50, width: 10, height: -10 }],
    ['NaN x', { x: NaN, y: 0, width: 10, height: 10 }],
    ['NaN width', { x: 0, y: 0, width: NaN, height: 10 }],
    ['NaN height', { x: 0, y: 0, width: 10, height: NaN }],
  ])('is null for a region %s', (_label, region) => {
    expect(exportArea(region)).toBeNull();
  });
});
