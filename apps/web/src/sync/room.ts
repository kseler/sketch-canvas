import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { JOB_MAP } from '../lib/jobs';
import type { Stroke } from '../types';

// Awareness: short-lived per-person state (name, cursor, stroke in progress). Unlike the document,
// it has no history and disappears when the person leaves.
export type Awareness = WebsocketProvider['awareness'];

export type Room = {
  name: string;
  doc: Y.Doc;
  strokes: Y.Array<Stroke>;
  // Generated pictures, written by the server. Unknown until checked (see lib/images.ts).
  images: Y.Array<unknown>;
  // The room's generation job, written by the server. Unknown until checked (see lib/jobs.ts).
  job: Y.Map<unknown>;
  awareness: Awareness;
  destroy: () => void;
};

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234';

// Join (or create) a room. Everyone in the same room shares one Yjs document.
export function joinRoom(name: string): Room {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, name, doc);
  const strokes = doc.getArray<Stroke>('strokes');
  const images = doc.getArray<unknown>('images');
  const job = doc.getMap<unknown>(JOB_MAP);

  // y-websocket does not announce leaving when a browser page closes, so others would keep seeing
  // us for up to 30s (the awareness timeout). Clearing our state on pagehide tells them right away.
  // If the page comes back from the back/forward cache, re-announce the state we had.
  let beforeLeaving: ReturnType<typeof provider.awareness.getLocalState> = null;
  const leave = () => {
    beforeLeaving = provider.awareness.getLocalState();
    provider.awareness.setLocalState(null);
  };
  const comeBack = (e: PageTransitionEvent) => {
    if (e.persisted && beforeLeaving) provider.awareness.setLocalState(beforeLeaving);
  };
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', comeBack);

  return {
    name,
    doc,
    strokes,
    images,
    job,
    awareness: provider.awareness,
    destroy: () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', comeBack);
      provider.destroy();
      doc.destroy();
    },
  };
}
