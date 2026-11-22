import { useEffect, useState } from 'react';
import { cleanName, isIdentity, type Identity } from '../lib/identity';
import { isPoint, type Point } from '../lib/points';
import { isLiveStroke, type LiveStroke } from '../lib/strokes';
import type { Awareness } from '../sync/room';

// `cursor` is in canvas units, or null when the pointer is off the canvas.
// `drawing` is the stroke they are drawing right now, or null.
export type Peer = Identity & { clientId: number; isSelf: boolean; cursor: Point | null; drawing: LiveStroke | null };

// Everyone currently in the room (including you), seen through a `view` that picks only what the
// component needs, or null to leave a peer out. Awareness changes ~20 times a second per active
// person (cursors, live strokes), so the component re-renders only when its view actually changed:
// a cursor moving does not re-render the avatar list.
//
// `view` must be a stable function (defined outside the component), and should return flat objects:
// items are compared field by field with Object.is.
export function usePeers<T extends object>(awareness: Awareness, view: (peer: Peer) => T | null): T[] {
  const [items, setItems] = useState<T[]>(() => viewPeers(awareness, view));

  useEffect(() => {
    const update = () => setItems((prev) => keepIfSame(prev, viewPeers(awareness, view)));
    awareness.on('change', update);
    update();
    return () => awareness.off('change', update);
  }, [awareness, view]);

  return items;
}

function viewPeers<T>(awareness: Awareness, view: (peer: Peer) => T | null): T[] {
  return readPeers(awareness)
    .map(view)
    .filter((item): item is T => item !== null);
}

// You come first, the rest in join order. Anything malformed from other clients is dropped.
function readPeers(awareness: Awareness): Peer[] {
  const peers: Peer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user: unknown = state.user;
    if (!isIdentity(user)) return; // connected, but hasn't announced itself yet
    const cursor: unknown = state.cursor;
    const drawing: unknown = state.drawing;
    peers.push({
      clientId,
      isSelf: clientId === awareness.clientID,
      name: cleanName(user.name),
      color: user.color,
      cursor: isPoint(cursor) ? cursor : null,
      // Same object as in awareness, so an unchanged stroke keeps its identity between reads.
      drawing: isLiveStroke(drawing) ? drawing : null,
    });
  });
  return peers.sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
}

// Returning the previous array (same reference) makes React skip the re-render.
function keepIfSame<T extends object>(prev: T[], next: T[]): T[] {
  const same = prev.length === next.length && prev.every((item, i) => shallowEqual(item, next[i]!));
  return same ? prev : next;
}

function shallowEqual(a: object, b: object): boolean {
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
