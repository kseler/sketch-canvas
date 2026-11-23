import { useEffect, useState } from 'react';
import { peersFromStates, type Peer } from '../lib/people';
import type { Awareness } from '../sync/room';

export type { Peer };

// Every tab currently in the room (including you), seen through a `view` that picks only what the
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
  return peersFromStates(awareness.getStates(), awareness.clientID)
    .map(view)
    .filter((item): item is T => item !== null);
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
