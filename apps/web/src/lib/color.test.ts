import { describe, expect, it } from 'vitest';
import { isHexColor } from './color';

describe('isHexColor', () => {
  it('accepts #rrggbb in either case', () => {
    expect(isHexColor('#e76f51')).toBe(true);
    expect(isHexColor('#E76F51')).toBe(true);
  });

  // The reason this guard exists: a color from another player goes into CSS `background`.
  it('rejects CSS that would make the browser fetch a URL', () => {
    expect(isHexColor('url(https://tracker.example/x)')).toBe(false);
    expect(isHexColor('#fff url(https://tracker.example/x)')).toBe(false);
  });

  it.each(['red', '#fff', '#e76f5', '#e76f511', 'e76f51', '#gggggg', ' #e76f51', '#e76f51\n', ''])(
    'rejects %j',
    (value) => {
      expect(isHexColor(value)).toBe(false);
    },
  );

  it.each([undefined, null, 0xe76f51, {}, ['#e76f51']])('rejects non-strings: %j', (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});
