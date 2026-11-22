export type Tool = 'pen' | 'eraser';

// One finished stroke as stored in the shared document. Points are flat: [x1, y1, x2, y2, ...].
// Optional fields keep older data valid: a missing `kind` means 'stroke', a missing `tool` means pen.
// `kind` lets the shared canvas hold other element types later (see CLAUDE.md, instant mode).
export type Stroke = { kind?: 'stroke'; id: string; tool?: Tool; color: string; width: number; points: number[] };
