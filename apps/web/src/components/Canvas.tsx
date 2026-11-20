import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type * as Y from 'yjs';
import { useElementSize } from '../hooks/useElementSize';
import { appendIfFar, minDistanceFor, withFinalPoint, type Point } from '../lib/points';
import type { Stroke, Tool } from '../types';
import { StrokeLine } from './StrokeLine';

type Props = {
  strokes: Y.Array<Stroke>;
  tool: Tool;
  color: string;
  width: number;
};

// The shared drawing space. Every player and the exported image use these coordinates; the stage
// is only scaled to fit each screen, so a stroke lands in the same place for everyone.
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
const BORDER = 1;

// Largest scale at which the whole 800x600 canvas fits in the available space.
function fitScale(availableWidth: number, availableHeight: number): number {
  return Math.max(0, Math.min(availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT));
}

export function Canvas({ strokes, tool, color, width }: Props) {
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const scale = fitScale(area.width - BORDER * 2, area.height - BORDER * 2);
  const [shared, setShared] = useState<Stroke[]>(() => strokes.toArray());
  const [current, setCurrent] = useState<number[] | null>(null);

  // Re-render whenever any player adds or clears strokes.
  useEffect(() => {
    const sync = () => setShared(strokes.toArray());
    strokes.observe(sync);
    sync();
    return () => strokes.unobserve(sync);
  }, [strokes]);

  // Last raw pointer position, kept even when the distance filter drops it, so the stroke can end there.
  const lastRaw = useRef<Point | null>(null);

  // Relative position = canvas units, so points stay correct if the stage is ever zoomed or panned.
  const pointer = (e: KonvaEventObject<PointerEvent>) => e.target.getStage()?.getRelativePointerPosition() ?? null;

  const start = (e: KonvaEventObject<PointerEvent>) => {
    const p = pointer(e);
    lastRaw.current = null;
    if (p) setCurrent([p.x, p.y]);
  };

  const move = (e: KonvaEventObject<PointerEvent>) => {
    const p = pointer(e);
    if (!p) return;
    lastRaw.current = p;
    const minDistance = minDistanceFor(e.target.getStage()?.scaleX() ?? 1);
    setCurrent((pts) => (pts ? appendIfFar(pts, p, minDistance) : pts));
  };

  // A stroke is shared when the pen lifts; in-progress strokes stay local.
  const end = () => {
    const points = current ? withFinalPoint(current, lastRaw.current) : null;
    if (points && points.length >= 4) {
      strokes.push([{ id: crypto.randomUUID(), tool, color, width, points }]);
    }
    lastRaw.current = null;
    setCurrent(null);
  };

  return (
    // The outer area takes all remaining space; the bordered box inside hugs the scaled canvas.
    <div ref={areaRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start' }}>
      {scale > 0 && (
        <div style={{ border: `${BORDER}px solid #ccc` }}>
          <Stage
            width={Math.floor(CANVAS_WIDTH * scale)}
            height={Math.floor(CANVAS_HEIGHT * scale)}
            scaleX={scale}
            scaleY={scale}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            style={{ touchAction: 'none' }}
          >
            {/* White paper in its own layer, so it is part of the exported image and the eraser
                ('destination-out' only cuts within its own layer) can never cut through it. */}
            <Layer listening={false}>
              <Rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#fff" />
            </Layer>
            <Layer>
              {shared.map((s) => (
                <StrokeLine key={s.id} stroke={s} />
              ))}
              {current && <StrokeLine stroke={{ id: 'current', tool, color, width, points: current }} />}
            </Layer>
          </Stage>
        </div>
      )}
    </div>
  );
}
