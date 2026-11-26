import Konva from 'konva';
import type { Stroke } from '../types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './canvasSize';
import { strokeLineConfig } from './strokeStyle';

// A rectangle in canvas coordinates (the same units strokes use).
export type Region = { x: number; y: number; width: number; height: number };

// The part of the canvas to export: the region clipped to the canvas, in whole pixels, or the whole
// canvas when there is no region. Null when nothing of the region lies on the canvas.
export function exportArea(region?: Region): Region | null {
  if (!region) return { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(CANVAS_WIDTH, Math.ceil(region.x + region.width));
  const y1 = Math.min(CANVAS_HEIGHT, Math.ceil(region.y + region.height));
  if (!(x1 > x0 && y1 > y0)) return null; // also catches NaN
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Pixels that count as ink: alpha at least half. The eraser cuts ink away (alpha 0); the faint
// anti-aliased fringe it can leave along an erased edge doesn't count.
const INK_ALPHA = 128;
// A visible mark is more than a few such pixels; a single dot with the smallest pen is about 4.
const MIN_INK_PIXELS = 4;

// Whether RGBA pixel data (4 bytes per pixel) holds any visible ink: enough pixels with real alpha.
export function hasInk(rgba: ArrayLike<number>): boolean {
  let found = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! >= INK_ALPHA && ++found >= MIN_INK_PIXELS) return true;
  }
  return false;
}

// The sketch as a PNG for the vision model: the document's strokes on white paper, at canvas
// resolution (1 canvas unit = 1 pixel), whatever the size of the screen.
// It draws the strokes again on a hidden stage instead of copying the visible canvas, so cursors,
// other players' half-finished strokes and the screen's zoom never end up in the image.
// PNG, not JPEG: tokens depend on pixels, not bytes, and JPEG would blur the thin lines.
// Null when nothing is left to see: every pen stroke erased (the eraser is a stroke too, so the
// strokes alone can't tell), or no strokes in the area. Such a sketch is never sent (it costs money).
export async function exportSketch(strokes: readonly Stroke[], { region }: { region?: Region } = {}): Promise<Blob | null> {
  const area = exportArea(region);
  if (!area) throw new Error('The export region is outside the canvas.');

  const stage = new Konva.Stage({ container: document.createElement('div'), width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  try {
    // White paper in its own layer, as on screen: transparent pixels could read as black to a model,
    // and the eraser only cuts holes within the strokes layer above it.
    const paper = new Konva.Layer();
    paper.add(new Konva.Rect({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, fill: '#fff' }));
    const ink = new Konva.Layer();
    for (const stroke of strokes) ink.add(new Konva.Line(strokeLineConfig(stroke)));
    stage.add(paper, ink);
    if (!inkIn(ink, area)) return null;
    const blob: Blob | null = await stage.toBlob({ ...area, pixelRatio: 1, mimeType: 'image/png' });
    // Typed as Blob, but a browser that fails to encode the canvas hands back null.
    if (!blob) throw new Error('The browser could not encode the sketch as PNG.');
    return blob;
  } finally {
    stage.destroy();
  }
}

// Reads the ink layer's pixels (strokes with the eraser's cuts applied, before the white paper) in
// the export area. The layer's canvas may be denser than canvas units (the screen's pixel ratio).
function inkIn(ink: Konva.Layer, area: Region): boolean {
  ink.draw();
  const canvas = ink.getNativeCanvasElement();
  const ratio = canvas.width / CANVAS_WIDTH;
  const context = canvas.getContext('2d');
  if (!context) return true; // can't look: send it rather than block Generate
  const { data } = context.getImageData(
    Math.floor(area.x * ratio),
    Math.floor(area.y * ratio),
    Math.max(1, Math.floor(area.width * ratio)),
    Math.max(1, Math.floor(area.height * ratio)),
  );
  return hasInk(data);
}
