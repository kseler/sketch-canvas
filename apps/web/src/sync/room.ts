import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { Stroke } from '../types';

export type Room = {
  doc: Y.Doc;
  strokes: Y.Array<Stroke>;
  destroy: () => void;
};

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234';

// Join (or create) a room. Everyone in the same room shares one Yjs document.
export function joinRoom(name: string): Room {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, name, doc);
  const strokes = doc.getArray<Stroke>('strokes');
  return {
    doc,
    strokes,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}
