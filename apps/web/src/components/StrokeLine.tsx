import { memo } from 'react';
import { Line } from 'react-konva';
import { strokeLineConfig } from '../lib/strokeStyle';
import type { Stroke } from '../types';

// One stroke on screen; the look (including how the eraser cuts) lives in strokeLineConfig.
// memo: finished strokes are the same objects between reads, so they skip re-rendering while you
// draw (the canvas re-renders on every new point of your own stroke).
export const StrokeLine = memo(function StrokeLine({ stroke }: { stroke: Stroke }) {
  return <Line {...strokeLineConfig(stroke)} />;
});
