// The pen colors, as in the design: black, red, orange, yellow, green, blue, purple. Strokes store
// the hex value, so older strokes keep whatever color they were drawn in.
export const COLORS = ['#111111', '#e03131', '#f76707', '#f59f00', '#2f9e44', '#1c7ed6', '#7048e8'];
export const COLOR_NAMES: Record<string, string> = {
  '#111111': 'Black',
  '#e03131': 'Red',
  '#f76707': 'Orange',
  '#f59f00': 'Yellow',
  '#2f9e44': 'Green',
  '#1c7ed6': 'Blue',
  '#7048e8': 'Purple',
};

export const SIZES = [2, 4, 10] as const;
export type Size = (typeof SIZES)[number];

// The next size up or down, staying at the ends (the toolbar's − and + buttons).
export function stepSize(size: Size, step: -1 | 1): Size {
  const i = SIZES.indexOf(size);
  return SIZES[Math.min(SIZES.length - 1, Math.max(0, i + step))] ?? size;
}

// Erasing with a 2px line is painful, so the eraser is always wider than the pen at the same size.
export const ERASER_SCALE = 4;
