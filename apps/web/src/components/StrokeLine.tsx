import { Line } from 'react-konva';
import type { Stroke } from '../types';

// An eraser stroke is a line that cuts a transparent hole ('destination-out') through everything
// drawn before it in the same layer. The white paper layer underneath shows through the hole.
export function StrokeLine({ stroke }: { stroke: Stroke }) {
  const erasing = stroke.tool === 'eraser';
  return (
    <Line
      points={stroke.points}
      stroke={erasing ? '#000' : stroke.color}
      strokeWidth={stroke.width}
      globalCompositeOperation={erasing ? 'destination-out' : 'source-over'}
      lineCap="round"
      lineJoin="round"
      tension={0.3}
    />
  );
}
