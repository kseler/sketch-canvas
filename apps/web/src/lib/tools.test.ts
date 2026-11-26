import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, COLORS, SIZES, stepSize } from './tools';

describe('stepSize', () => {
  it('moves through the sizes in order', () => {
    expect(stepSize(2, 1)).toBe(4);
    expect(stepSize(4, 1)).toBe(10);
    expect(stepSize(10, -1)).toBe(4);
    expect(stepSize(4, -1)).toBe(2);
  });

  it('stays at the ends', () => {
    expect(stepSize(SIZES[0], -1)).toBe(SIZES[0]);
    expect(stepSize(SIZES[SIZES.length - 1]!, 1)).toBe(SIZES[SIZES.length - 1]);
  });
});

describe('COLORS', () => {
  it('has a name for every color (read out by screen readers)', () => {
    for (const color of COLORS) expect(COLOR_NAMES[color]).toBeTruthy();
  });

  it('are #rrggbb values, which every peer accepts', () => {
    for (const color of COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
