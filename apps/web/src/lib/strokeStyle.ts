import type { LineConfig } from 'konva/lib/shapes/Line';
import type { Stroke } from '../types';

// How a stroke is drawn, shared by the screen (StrokeLine) and the exported sketch (exportSketch),
// so what the vision model sees is exactly what the players see.
// An eraser stroke cuts a transparent hole ('destination-out') through everything drawn before it in
// the same layer; the white paper layer underneath shows through the hole.
export function strokeLineConfig(stroke: Stroke): LineConfig {
  const erasing = stroke.tool === 'eraser';
  return {
    points: stroke.points,
    stroke: erasing ? '#000' : stroke.color,
    strokeWidth: stroke.width,
    globalCompositeOperation: erasing ? 'destination-out' : 'source-over',
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0.3,
  };
}
