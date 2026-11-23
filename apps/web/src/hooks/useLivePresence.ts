import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Point } from '../lib/points';
import type { LiveStroke } from '../lib/strokes';
import type { Awareness } from '../sync/room';

// Pointer events fire 60-120 times a second; each awareness change is a message to everyone.
// 50ms (20 updates/s) still looks smooth to others.
export const SEND_EVERY_MS = 50;

type Live = { cursor: Point | null; drawing: LiveStroke | null };

export type LivePresence = {
  setCursor: (cursor: Point | null) => void;
  setDrawing: (drawing: LiveStroke | null) => void;
};

// Shares your cursor and the stroke you're drawing through awareness. Both go out together in one
// throttled message; the latest values are always sent, so nothing stops short. Clearing a value
// (null: pointer left, pen lifted) is sent immediately.
export function useLivePresence(awareness: Awareness): LivePresence {
  const latest = useRef<Live>({ cursor: null, drawing: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
    // One setLocalState call = one message, with every other field (like `user`) kept.
    awareness.setLocalState({ ...awareness.getLocalState(), ...latest.current });
  }, [awareness]);

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const update = useCallback(
    (patch: Partial<Live>, immediately: boolean) => {
      latest.current = { ...latest.current, ...patch };
      if (immediately) flush();
      else if (timer.current === null) timer.current = setTimeout(flush, SEND_EVERY_MS);
    },
    [flush],
  );

  return useMemo(
    () => ({
      setCursor: (cursor) => update({ cursor }, cursor === null),
      setDrawing: (drawing) => update({ drawing }, drawing === null),
    }),
    [update],
  );
}
