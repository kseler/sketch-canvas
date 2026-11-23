import { memo } from 'react';
import { usePeers, type Peer } from '../hooks/usePeers';
import type { LiveStroke } from '../lib/strokes';
import type { Awareness } from '../sync/room';
import { StrokeLine } from './StrokeLine';

// Only peers who are drawing. `drawing` is the same object until that peer sends a new version,
// so other people's cursor moves don't re-render these lines.
type Drawing = { clientId: number; drawing: LiveStroke };
const toDrawing = ({ clientId, isSelf, drawing }: Peer): Drawing | null => (!isSelf && drawing ? { clientId, drawing } : null);

// Strokes other players are drawing right now (from awareness). Rendered inside the drawing layer
// so a live eraser stroke cuts like a finished one. A live stroke draws on top of finished ones
// until the pen lifts; then it takes its place in the document's order.
// memo: Canvas re-renders on every point of your own stroke; with the same awareness this skips
// those renders.
export const LiveStrokes = memo(function LiveStrokes({ awareness }: { awareness: Awareness }) {
  const drawings = usePeers(awareness, toDrawing);
  return (
    <>
      {drawings.map(({ clientId, drawing }) => (
        <StrokeLine key={clientId} stroke={{ ...drawing, id: `live-${clientId}` }} />
      ))}
    </>
  );
});
