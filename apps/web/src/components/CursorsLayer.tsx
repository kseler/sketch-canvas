import { memo } from 'react';
import { Group, Label, Layer, Line, Tag, Text } from 'react-konva';
import { usePeers, type Peer } from '../hooks/usePeers';
import type { Awareness } from '../sync/room';

type Props = { awareness: Awareness; scale: number };

// Flat, so usePeers can tell when nothing changed. Your own cursor is left out.
type RemoteCursor = { clientId: number; name: string; color: string; x: number; y: number };
const toRemoteCursor = ({ clientId, isSelf, name, color, cursor }: Peer): RemoteCursor | null =>
  !isSelf && cursor ? { clientId, name, color, x: cursor.x, y: cursor.y } : null;

// Other players' cursors, on top of the drawing. Its own layer so cursor moves re-render only
// this layer, and listening={false} so cursors never catch your pointer events.
// memo: Canvas re-renders on every point of your own stroke; with unchanged props
// (awareness, scale) this layer skips those renders.
export const CursorsLayer = memo(function CursorsLayer({ awareness, scale }: Props) {
  const cursors = usePeers(awareness, toRemoteCursor);
  return (
    <Layer listening={false}>
      {cursors.map((cursor) => (
        <Cursor key={cursor.clientId} cursor={cursor} scale={scale} />
      ))}
    </Layer>
  );
});

// Positioned in canvas units, but counter-scaled so the arrow and label keep the same on-screen
// size on a phone and a big monitor.
function Cursor({ cursor, scale }: { cursor: RemoteCursor; scale: number }) {
  return (
    <Group x={cursor.x} y={cursor.y} scaleX={1 / scale} scaleY={1 / scale}>
      <Line points={[0, 0, 0, 16, 4.5, 12, 11, 11]} closed fill={cursor.color} stroke="#fff" strokeWidth={1.5} />
      <Label x={10} y={16}>
        <Tag fill={cursor.color} cornerRadius={4} />
        <Text text={cursor.name} fill="#fff" fontSize={12} padding={4} />
      </Label>
    </Group>
  );
}
