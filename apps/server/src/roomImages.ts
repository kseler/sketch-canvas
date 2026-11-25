import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type * as Y from 'yjs';
import { z } from 'zod';
import { IMAGE_URL_PREFIX } from './imageStore';
import { ROOM_ID } from './roomId';

// The shared record of a generated picture, written into the room's Yjs document by the server, so
// every tab gets it (even if the person who clicked Generate has left). Small on purpose: where the
// picture is and where it belongs on the canvas, never its bytes.
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
// That includes a tab re-sending its old copy after a server restart: the server has already put
// its own copy back (see `open`), so the tab's copy is a duplicate and goes.
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

// One line of the picture log: which room a picture belongs to. Checked on the way back in like
// anything read from disk: a hand-edited or damaged line is skipped, never shared.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LoggedPicture = z.object({
  roomId: z.string().regex(ROOM_ID),
  record: z
    .strictObject({
      kind: z.literal('image'),
      id: z.string().regex(UUID_V4),
      url: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number().positive(),
      h: z.number().positive(),
      createdAt: z.string().max(40),
    })
    .refine((r) => r.url === `${IMAGE_URL_PREFIX}${r.id}.png`),
});

// How many of a room's pictures the server remembers and puts back after a restart: the newest
// ones. The web panel only looks at the last 20 entries (LATEST_SCAN in apps/web/src/lib/images.ts),
// so older ones would only make every tab download a list that grows forever. Their files and log
// lines stay; retention is on the pre-deploy list.
export const KEPT_PER_ROOM = 20;

export type RoomImages = {
  // Reads the picture log. Call once at startup, before the server takes connections.
  load(): Promise<{ loaded: number; skipped: number }>;
  // Guards a room's pictures and, the first time this server process sees the room, puts back the
  // pictures it had before a restart. Call before a tab's first update can arrive.
  open(roomId: string): void;
  // Logs a new picture to disk, then shares it with the room. Throws if it couldn't be logged:
  // a picture that would vanish on the next restart is not shared.
  add(roomId: string, record: ImageRecord): Promise<void>;
};

// `getDoc` is y-websocket's getYDoc: the server's own copy of the room's document, which it syncs
// to every connected tab. That copy lives only in memory, so a restart forgets every room's
// pictures; `logPath` (data/room-images.jsonl) remembers which picture belongs to which room.
export function createRoomImages({ getDoc, logPath }: { getDoc: (roomId: string) => Y.Doc; logPath: string }): RoomImages {
  // A Map, not an object: room ids come from players, and "__proto__" must stay just a key.
  const byRoom = new Map<string, ImageRecord[]>();
  const seeded = new WeakSet<Y.Doc>();

  function remember(roomId: string, record: ImageRecord): void {
    const list = byRoom.get(roomId) ?? [];
    list.push(record);
    if (list.length > KEPT_PER_ROOM) list.splice(0, list.length - KEPT_PER_ROOM);
    byRoom.set(roomId, list);
  }

  function open(roomId: string): void {
    const doc = getDoc(roomId);
    guardImages(doc);
    if (seeded.has(doc)) return;
    seeded.add(doc);
    const records = byRoom.get(roomId) ?? [];
    if (records.length === 0) return;
    for (const r of records) serverIds.get(doc)?.add(r.id);
    doc.transact(() => doc.getArray<ImageRecord>(IMAGES_ARRAY).push(records.map((r) => ({ ...r }))), SERVER_ORIGIN);
  }

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(logPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { loaded: 0, skipped: 0 }; // no pictures yet
        throw error; // unreadable log: better not to start than to show rooms without their pictures
      }
      // A crash mid-write leaves a last line with no newline; end it, or the next entry is glued on.
      if (text !== '' && !text.endsWith('\n')) await appendFile(logPath, '\n');
      let loaded = 0;
      let skipped = 0;
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const parsed = LoggedPicture.safeParse(parseJson(line));
        if (!parsed.success) {
          skipped += 1;
          continue;
        }
        remember(parsed.data.roomId, parsed.data.record);
        loaded += 1;
      }
      return { loaded, skipped };
    },

    open,

    async add(roomId, record) {
      // Seed first: the room's older pictures go in before this one, and only once.
      open(roomId);
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(logPath, `${JSON.stringify({ roomId, record })}\n`);
      remember(roomId, record);
      const doc = getDoc(roomId);
      serverIds.get(doc)?.add(record.id);
      doc.transact(() => doc.getArray<ImageRecord>(IMAGES_ARRAY).push([{ ...record }]), SERVER_ORIGIN);
    },
  };
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
