export type Tool = 'pen' | 'eraser';

// One finished stroke as stored in the shared document. Points are flat: [x1, y1, x2, y2, ...].
// `tool` is optional because strokes made before the eraser existed have none; missing means pen.
export type Stroke = { id: string; tool?: Tool; color: string; width: number; points: number[] };
