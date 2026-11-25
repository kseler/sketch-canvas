import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createRoomImages, IMAGES_ARRAY, KEPT_PER_ROOM, type ImageRecord } from './roomImages';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const record = (n: number): ImageRecord => ({
  kind: 'image',
  id: uuid(n),
  url: `/api/images/${uuid(n)}.png`,
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  createdAt: '2026-11-24T12:00:00.000Z',
});
const ids = (doc: Y.Doc) => doc.getArray<ImageRecord>(IMAGES_ARRAY).toArray().map((r) => r.id);
const line = (roomId: string, r: unknown) => `${JSON.stringify({ roomId, record: r })}\n`;

let dir: string;
let logPath: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'room-images-test-'));
  logPath = path.join(dir, 'data', 'room-images.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// One Y.Doc per room, like y-websocket's getYDoc. `restart()` forgets them, like a new process.
function server() {
  let docs = new Map<string, Y.Doc>();
  const getDoc = vi.fn((roomId: string) => {
    const doc = docs.get(roomId) ?? new Y.Doc();
    docs.set(roomId, doc);
    return doc;
  });
  return {
    getDoc,
    restart: () => {
      docs = new Map();
    },
  };
}

describe('createRoomImages add', () => {
  it("pushes the record onto the 'images' array of the room's document", async () => {
    const s = server();
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-1', record(1));
    expect(s.getDoc).toHaveBeenCalledWith('room-1');
    expect(IMAGES_ARRAY).toBe('images');
    expect(s.getDoc('room-1').getArray(IMAGES_ARRAY).toJSON()).toEqual([record(1)]);
  });

  it('keeps earlier pictures and appends in order', async () => {
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    await rooms.add('room-1', record(1));
    await rooms.add('room-1', record(2));
    expect(ids(s.getDoc('room-1'))).toEqual([uuid(1), uuid(2)]);
  });

  it('does not touch the strokes', async () => {
    const s = server();
    s.getDoc('room-1').getArray('strokes').push([{ id: 's' }]);
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-1', record(1));
    expect(s.getDoc('room-1').getArray('strokes').toJSON()).toEqual([{ id: 's' }]);
  });

  it('writes to the document of the room it was given, not another', async () => {
    const s = server();
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-2', record(1));
    expect(s.getDoc('room-1').getArray(IMAGES_ARRAY).length).toBe(0);
    expect(s.getDoc('room-2').getArray(IMAGES_ARRAY).length).toBe(1);
  });

  it('logs the room and the record as one JSON line, creating the folder', async () => {
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    await rooms.add('room-1', record(1));
    await rooms.add('room-2', record(2));
    expect(await readFile(logPath, 'utf8')).toBe(line('room-1', record(1)) + line('room-2', record(2)));
  });

  it('does not share a picture it could not log (it would vanish on the next restart)', async () => {
    const s = server();
    // A folder where the log file should be: appendFile fails.
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath: dir });
    await expect(rooms.add('room-1', record(1))).rejects.toThrow();
    expect(s.getDoc('room-1').getArray(IMAGES_ARRAY).length).toBe(0);
  });
});

describe('createRoomImages after a restart', () => {
  it('puts each room’s pictures back, in order, when the room is opened again', async () => {
    const s = server();
    const before = createRoomImages({ getDoc: s.getDoc, logPath });
    await before.add('room-1', record(1));
    await before.add('room-2', record(2));
    await before.add('room-1', record(3));

    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    expect(await after.load()).toEqual({ loaded: 3, skipped: 0 });
    after.open('room-1');
    after.open('room-2');
    expect(ids(s.getDoc('room-1'))).toEqual([uuid(1), uuid(3)]);
    expect(ids(s.getDoc('room-2'))).toEqual([uuid(2)]);
  });

  it('puts them back only once, however often the room is opened', async () => {
    const s = server();
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-1', record(1));
    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    await after.load();
    after.open('room-1');
    after.open('room-1');
    expect(ids(s.getDoc('room-1'))).toEqual([uuid(1)]);
  });

  it('puts the older pictures back before a new one when the first thing after a restart is a new picture', async () => {
    const s = server();
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-1', record(1));
    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    await after.load();
    await after.add('room-1', record(2));
    expect(ids(s.getDoc('room-1'))).toEqual([uuid(1), uuid(2)]);
  });

  it('treats restored pictures as the server’s own: a peer deleting one gets it put back', async () => {
    const s = server();
    await createRoomImages({ getDoc: s.getDoc, logPath }).add('room-1', record(1));
    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    await after.load();
    after.open('room-1');
    const doc = s.getDoc('room-1');
    doc.transact(() => doc.getArray(IMAGES_ARRAY).delete(0, 1), 'peer');
    expect(ids(doc)).toEqual([uuid(1)]);
  });

  it(`puts back only the newest ${KEPT_PER_ROOM} pictures of a room, oldest first`, async () => {
    const s = server();
    const before = createRoomImages({ getDoc: s.getDoc, logPath });
    for (let n = 1; n <= KEPT_PER_ROOM + 5; n += 1) await before.add('room-1', record(n));
    await before.add('room-2', record(99));

    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    expect(await after.load()).toEqual({ loaded: KEPT_PER_ROOM + 6, skipped: 0 }); // every line is read
    after.open('room-1');
    after.open('room-2');
    expect(ids(s.getDoc('room-1'))).toEqual(Array.from({ length: KEPT_PER_ROOM }, (_, i) => uuid(i + 6)));
    expect(ids(s.getDoc('room-2'))).toEqual([uuid(99)]);
  });

  it('opens a room with no pictures without adding anything', async () => {
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    expect(await rooms.load()).toEqual({ loaded: 0, skipped: 0 }); // no log yet
    rooms.open('room-1');
    expect(s.getDoc('room-1').getArray(IMAGES_ARRAY).length).toBe(0);
  });

  it('keeps a room id like __proto__ as a plain key', async () => {
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    await rooms.load();
    rooms.open('__proto__');
    rooms.open('constructor');
    expect(s.getDoc('__proto__').getArray(IMAGES_ARRAY).length).toBe(0);
    expect(s.getDoc('constructor').getArray(IMAGES_ARRAY).length).toBe(0);
  });
});

describe('createRoomImages load', () => {
  const write = async (text: string) => {
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, text);
  };
  const loadInto = async () => {
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    const counts = await rooms.load();
    rooms.open('room-1');
    return { counts, ids: ids(s.getDoc('room-1')) };
  };

  it.each([
    ['not JSON', '{oops\n'],
    ['an invalid room id', line('Room 1', record(1))],
    ['another kind', line('room-1', { ...record(1), kind: 'stroke' })],
    ['an id that is not a UUID v4', line('room-1', { ...record(1), id: 'abc', url: '/api/images/abc.png' })],
    ['a url that does not match the id', line('room-1', { ...record(1), url: `/api/images/${uuid(2)}.png` })],
    ['a url on another site', line('room-1', { ...record(1), url: `https://evil.example/api/images/${uuid(1)}.png` })],
    ['a zero width', line('room-1', { ...record(1), w: 0 })],
    ['a string x', line('room-1', { ...record(1), x: '0' })],
    ['an extra field', line('room-1', { ...record(1), onload: 'x' })],
    ['a long createdAt', line('room-1', { ...record(1), createdAt: 'x'.repeat(41) })],
    ['no record', `${JSON.stringify({ roomId: 'room-1' })}\n`],
  ])('skips a line with %s and keeps the good ones', async (_label, bad) => {
    await write(line('room-1', record(1)) + bad + line('room-1', record(2)));
    const { counts, ids: got } = await loadInto();
    expect(counts).toEqual({ loaded: 2, skipped: 1 });
    expect(got).toEqual([uuid(1), uuid(2)]);
  });

  it('ends a torn last line so the next picture is not glued onto it', async () => {
    await write(line('room-1', record(1)) + '{"roomId":"room-1","rec');
    const s = server();
    const rooms = createRoomImages({ getDoc: s.getDoc, logPath });
    expect(await rooms.load()).toEqual({ loaded: 1, skipped: 1 });
    await rooms.add('room-1', record(2));

    s.restart();
    const after = createRoomImages({ getDoc: s.getDoc, logPath });
    expect(await after.load()).toEqual({ loaded: 2, skipped: 1 });
    after.open('room-1');
    expect(ids(s.getDoc('room-1'))).toEqual([uuid(1), uuid(2)]);
  });

  it('refuses to start when the log exists but cannot be read', async () => {
    const rooms = createRoomImages({ getDoc: server().getDoc, logPath: dir }); // a folder: EISDIR
    await expect(rooms.load()).rejects.toThrow();
  });
});
