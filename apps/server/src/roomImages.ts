import type * as Y from 'yjs';

// The shared record of a generated picture, written into the room's Yjs document by the server, so
// every tab in the room gets it (even if the person who clicked Generate has left). Small on
// purpose: where the picture is and where it belongs on the canvas, never its bytes.
export type ImageRecord = {
  kind: 'image';
  id: string;
  url: string;
  // Where it belongs on the canvas, in canvas units: the area of the sketch it was made from.
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: string;
};

// Pictures go in their own array, next to the strokes, never mixed in or replacing them
// (CLAUDE.md instant-mode rule 3: the strokes stay the source).
export const IMAGES_ARRAY = 'images';

// Marks the server's own writes. Any other origin is a peer (a WebSocket connection).
export const SERVER_ORIGIN = Symbol('sketch-canvas server');

const guarded = new WeakSet<Y.Doc>();
// The ids of the pictures the server added, per room document: the ones it puts back if a peer
// deletes them.
const serverIds = new WeakMap<Y.Doc, Set<string>>();

function idOf(value: unknown): string | null {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null;
}

// Only the server may add or remove pictures. Any peer can write anything into the shared
// document, so without this a hostile client could push fake records (hiding the real picture
// behind a broken one), a million of them (freezing every tab), or delete everyone's pictures
// (which cost money). Whatever a peer inserts into `images` is deleted again at once, and any
// server picture a peer deletes is put back, both by the server, so the fix syncs to everyone.
// Idempotent per document.
export function guardImages(doc: Y.Doc): void {
  if (guarded.has(doc)) return;
  guarded.add(doc);
  const images = doc.getArray<unknown>(IMAGES_ARRAY);
  const ours = serverIds.get(doc) ?? new Set<string>();
  serverIds.set(doc, ours);
  images.observe((event, transaction) => {
    if (transaction.origin === SERVER_ORIGIN) return;
    // Where the inserted items now sit in the array, walking the change from the start.
    const inserted: Array<[index: number, count: number]> = [];
    let index = 0;
    for (const op of event.changes.delta) {
      if (op.retain !== undefined) index += op.retain;
      else if (Array.isArray(op.insert)) {
        inserted.push([index, op.insert.length]);
        index += op.insert.length;
      }
    }
    // Server pictures this change deleted, to put back (at the end; order by createdAt is kept by
    // the panel showing the newest).
    const restore: unknown[] = [];
    for (const item of event.changes.deleted) {
      for (const value of item.content.getContent()) {
        const id = idOf(value);
        if (id !== null && ours.has(id)) restore.push(value);
      }
    }
    if (inserted.length === 0 && restore.length === 0) return;
    // Last first, so earlier indices stay valid.
    doc.transact(() => {
      for (const [at, count] of inserted.reverse()) images.delete(at, count);
      if (restore.length > 0) images.push(restore);
    }, SERVER_ORIGIN);
  });
}

export type RoomImages = { add(roomId: string, record: ImageRecord): void };

// `getDoc` is y-websocket's getYDoc: the server's own copy of the room's document, which it syncs
// to every connected tab.
export function createRoomImages(getDoc: (roomId: string) => Y.Doc): RoomImages {
  return {
    add(roomId, record) {
      const doc = getDoc(roomId);
      guardImages(doc);
      serverIds.get(doc)?.add(record.id);
      doc.transact(() => doc.getArray<ImageRecord>(IMAGES_ARRAY).push([record]), SERVER_ORIGIN);
    },
  };
}
