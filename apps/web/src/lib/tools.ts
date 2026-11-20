export const COLORS = ['#111111', '#d62828', '#f77f00', '#2a9d8f', '#1d4ed8', '#7c3aed'];
export const SIZES = [2, 4, 10] as const;
export type Size = (typeof SIZES)[number];

// Erasing with a 2px line is painful, so the eraser is always wider than the pen at the same size.
export const ERASER_SCALE = 4;
