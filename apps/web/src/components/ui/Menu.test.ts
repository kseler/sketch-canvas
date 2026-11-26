import { describe, expect, it } from 'vitest';
import { placeMenu } from './Menu';

const button = (left: number, width = 44, bottom = 60) => ({ left, right: left + width, bottom });

describe('placeMenu', () => {
  it('lines its right edge up with the button when there is room', () => {
    expect(placeMenu(button(1200), 1280)).toEqual({ top: 68, left: 1244 - 280, width: 280 });
  });

  it('moves right to stay on screen when the button is near the left edge', () => {
    expect(placeMenu(button(20), 1280).left).toBe(8);
  });

  it('moves left to stay on screen when the button is at the right edge', () => {
    expect(placeMenu(button(1270), 1280).left).toBe(1280 - 8 - 280);
  });

  it('is never wider than the window', () => {
    expect(placeMenu(button(100), 240)).toEqual({ top: 68, left: 8, width: 224 });
  });
});
