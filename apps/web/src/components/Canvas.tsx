import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type * as Y from 'yjs';
import { useElementSize } from '../hooks/useElementSize';
import { useLivePresence } from '../hooks/useLivePresence';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../lib/canvasSize';
import { appendIfFar, minDistanceFor, withFinalPoint, type Point } from '../lib/points';
import { liveTail, readStrokes } from '../lib/strokes';
import type { Awareness } from '../sync/room';
import type { Stroke, Tool } from '../types';
import styles from './Canvas.module.css';
import { CursorsLayer } from './CursorsLayer';
import { LiveStrokes } from './LiveStrokes';
import { StrokeLine } from './StrokeLine';

type Props = {
  strokes: Y.Array<Stroke>;
  awareness: Awareness;
  tool: Tool;
  color: string;
  width: number;
};

const BORDER = 1;

// Largest scale at which the whole 800x600 canvas fits in the available space.
function fitScale(availableWidth: number, availableHeight: number): number {
  return Math.max(0, Math.min(availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT));
}

export function Canvas({ strokes, awareness, tool, color, width }: Props) {
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const live = useLivePresence(awareness);
  const scale = fitScale(area.width - BORDER * 2, area.height - BORDER * 2);
  const [shared, setShared] = useState<Stroke[]>(() => readStrokes(strokes));

  // The stroke being drawn. The ref is the source of truth (always the newest points, even between
  // renders); the state copy makes React re-render it on screen.
  const currentRef = useRef<number[] | null>(null);
  const [current, setCurrent] = useState<number[] | null>(null);
  const updateCurrent = (points: number[] | null) => {
    currentRef.current = points;
    setCurrent(points);
    if (points) live.setDrawing({ kind: 'stroke', tool, color, width, points: liveTail(points) });
  };

  // Re-render whenever any player adds or clears strokes.
  useEffect(() => {
    const sync = () => setShared(readStrokes(strokes));
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
    if (p) updateCurrent([p.x, p.y]);
  };

  const move = (e: KonvaEventObject<PointerEvent>) => {
    const p = pointer(e);
    if (!p) return;
    live.setCursor(p);
    const points = currentRef.current;
    if (!points) return; // just hovering
    lastRaw.current = p;
    const next = appendIfFar(points, p, minDistanceFor(e.target.getStage()?.scaleX() ?? 1));
    if (next !== points) updateCurrent(next);
  };

  // When the pen lifts, the stroke moves from awareness (live, temporary) into the document (kept).
  // Document first, then clear the live copy: both travel over one WebSocket in order, so others
  // briefly see the stroke twice (harmless) instead of a gap where it vanishes (a flicker).
  const end = () => {
    const points = currentRef.current ? withFinalPoint(currentRef.current, lastRaw.current) : null;
    if (points && points.length >= 4) {
      strokes.push([{ kind: 'stroke', id: crypto.randomUUID(), tool, color, width, points }]);
    }
    if (points) live.setDrawing(null);
    lastRaw.current = null;
    currentRef.current = null;
    setCurrent(null);
  };

  // Leaving the canvas finishes any stroke and hides your cursor for everyone.
  const leave = () => {
    end();
    live.setCursor(null);
  };

  return (
    // The outer area takes all remaining space; the paper inside hugs the scaled canvas.
    <div ref={areaRef} className={styles.area}>
      {scale > 0 && (
        <div className={styles.paper}>
          <Stage
            width={Math.floor(CANVAS_WIDTH * scale)}
            height={Math.floor(CANVAS_HEIGHT * scale)}
            scaleX={scale}
            scaleY={scale}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={leave}
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
              <LiveStrokes awareness={awareness} />
              {current && <StrokeLine stroke={{ id: 'current', tool, color, width, points: current }} />}
            </Layer>
            <CursorsLayer awareness={awareness} scale={scale} />
          </Stage>
        </div>
      )}
    </div>
  );
}
