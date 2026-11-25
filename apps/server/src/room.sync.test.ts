import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { docs, getYDoc } from 'y-websocket/bin/utils';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createRoomImages, IMAGES_ARRAY, type ImageRecord, type RoomImages } from './roomImages';
import { createRoomJobs, JOB_KEY, JOB_MAP, type RoomJobs } from './roomJobs';
import { attachYjsSync, isRoomOpen } from './sync';

// The real thing, end to end: our sync server on a free port, real Yjs clients over real
// WebSockets. This is the wiring unit tests with a fake getDoc can't check: the room name, the one
// shared Yjs instance, that what the server writes reaches a tab, and what a restart does.

const record = (n: number): ImageRecord => ({
  kind: 'image',
  id: `0000000${n}-0000-4000-8000-000000000000`,
  url: `/api/images/0000000${n}-0000-4000-8000-000000000000.png`,
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  createdAt: '2026-11-24T12:00:00.000Z',
});

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let server: Server;
let wss: WebSocketServer;
let port: number;
let url: string;
let dir: string;
let images: RoomImages;
let jobs: RoomJobs;
const providers: WebsocketProvider[] = [];

function join(room: string): { doc: Y.Doc; provider: WebsocketProvider } {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, room, doc, { WebSocketPolyfill: WebSocket as never });
  providers.push(provider);
  return { doc, provider };
}

// What a new server process does: read the picture log, then take connections.
async function start(listenOn = 0): Promise<void> {
  images = createRoomImages({ getDoc: getYDoc, logPath: path.join(dir, 'room-images.jsonl') });
  await images.load();
  jobs = createRoomJobs({ getDoc: getYDoc });
  server = createServer();
  wss = attachYjsSync(server, (roomId) => {
    images.open(roomId);
    jobs.open(roomId);
  });
  await new Promise<void>((resolve) => server.listen(listenOn, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}`;
}

async function stop(): Promise<void> {
  wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// The process stops and a new one starts on the same port. The tabs stay open and reconnect on
// their own, bringing their old copy of the room with them. y-websocket's rooms live in memory
// only, so the new process starts with none of them.
async function restart(rooms: string[]): Promise<void> {
  await stop();
  for (const room of rooms) docs.delete(room);
  await start(port);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'room-sync-test-'));
  await start();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await stop();
  await rm(dir, { recursive: true, force: true });
});

describe('room pictures over real sync', () => {
  it('a picture the server adds reaches a connected tab', async () => {
    const room = `sync-a-${Date.now()}`;
    const { doc, provider } = join(room);
    await until(() => provider.synced);
    await images.add(room, record(1));
    await until(() => doc.getArray(IMAGES_ARRAY).length === 1);
    expect(doc.getArray(IMAGES_ARRAY).get(0)).toEqual(record(1));
  });

  it("a record a peer pushes is removed again, on the server and in the peer's own tab", async () => {
    const room = `sync-b-${Date.now()}`;
    const { doc, provider } = join(room);
    await until(() => provider.synced);
    await images.add(room, record(1));
    await until(() => doc.getArray(IMAGES_ARRAY).length === 1);

    doc.getArray(IMAGES_ARRAY).push([record(2), record(3)]); // a hostile peer
    // The server deletes the inserts and the deletion syncs back.
    await until(() => doc.getArray(IMAGES_ARRAY).length === 1);
    expect(doc.getArray(IMAGES_ARRAY).toArray()).toEqual([record(1)]);
    expect(getYDoc(room).getArray(IMAGES_ARRAY).toArray()).toEqual([record(1)]);
  });

  it('a second tab joining later sees only the server picture', async () => {
    const room = `sync-c-${Date.now()}`;
    const first = join(room);
    await until(() => first.provider.synced);
    await images.add(room, record(1));
    first.doc.getArray(IMAGES_ARRAY).push([record(2)]);
    await until(() => getYDoc(room).getArray(IMAGES_ARRAY).length === 1);

    const second = join(room);
    await until(() => second.provider.synced && second.doc.getArray(IMAGES_ARRAY).length >= 1);
    expect(second.doc.getArray(IMAGES_ARRAY).toArray()).toEqual([record(1)]);
  });

  it('removes a fake record even in a room where the server never added a picture', async () => {
    // The guard must be on from the first connection, not only after the server's first picture.
    const room = `sync-e-${Date.now()}`;
    const { doc, provider } = join(room);
    await until(() => provider.synced);
    doc.getArray(IMAGES_ARRAY).push([record(4)]);
    await until(() => doc.getArray(IMAGES_ARRAY).length === 0);
    expect(getYDoc(room).getArray(IMAGES_ARRAY).length).toBe(0);
  });

  it("puts the server's pictures back when a peer deletes them, for everyone", async () => {
    const room = `sync-f-${Date.now()}`;
    const first = join(room);
    const second = join(room);
    await until(() => first.provider.synced && second.provider.synced);
    await images.add(room, record(1));
    await images.add(room, record(2));
    await until(() => second.doc.getArray(IMAGES_ARRAY).length === 2);

    const shared = first.doc.getArray(IMAGES_ARRAY);
    shared.delete(0, shared.length); // a hostile peer wipes the pictures
    await until(() => second.doc.getArray(IMAGES_ARRAY).length === 2 && first.doc.getArray(IMAGES_ARRAY).length === 2);
    expect(ids(first.doc)).toEqual([record(1).id, record(2).id]);
    expect(ids(second.doc)).toEqual([record(1).id, record(2).id]);
    expect(ids(getYDoc(room))).toEqual([record(1).id, record(2).id]);
  });

  it('knows whether a room has someone in it', async () => {
    const room = `sync-d-${Date.now()}`;
    expect(isRoomOpen(room)).toBe(false);
    const { provider } = join(room);
    await until(() => provider.synced);
    expect(isRoomOpen(room)).toBe(true);
    provider.destroy();
    await until(() => !isRoomOpen(room));
  });
});

const ids = (doc: Y.Doc) => doc.getArray<ImageRecord>(IMAGES_ARRAY).toArray().map((r) => r.id).sort();
const jobOf = (doc: Y.Doc) => doc.getMap<unknown>(JOB_MAP).get(JOB_KEY) as { id: string; status: string } | undefined;

describe('a server restart', () => {
  it("keeps the room's pictures, once each, for a tab that was open and for one that joins later", async () => {
    const room = `restart-a-${Date.now()}`;
    const tab = join(room);
    await until(() => tab.provider.synced);
    await images.add(room, record(1));
    await images.add(room, record(2));
    await until(() => tab.doc.getArray(IMAGES_ARRAY).length === 2);

    await restart([room]);
    // The tab reconnects and sends its old copy; the server already put its own back.
    await until(() => isRoomOpen(room), 10_000);
    await until(() => tab.doc.getArray(IMAGES_ARRAY).length === 2 && getYDoc(room).getArray(IMAGES_ARRAY).length === 2, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 200)); // let any duplicate arrive, if there were one
    expect(ids(tab.doc)).toEqual([record(1).id, record(2).id]);
    expect(ids(getYDoc(room))).toEqual([record(1).id, record(2).id]);

    const later = join(room);
    await until(() => later.provider.synced && later.doc.getArray(IMAGES_ARRAY).length >= 2);
    expect(ids(later.doc)).toEqual([record(1).id, record(2).id]);
  }, 20_000);

  it("ends a job that was running: the tab's stale copy is deleted, so Generate comes back", async () => {
    const room = `restart-b-${Date.now()}`;
    const tab = join(room);
    await until(() => tab.provider.synced);
    const id = jobs.start(room);
    await until(() => jobOf(tab.doc)?.id === id);
    expect(jobOf(tab.doc)?.status).toBe('running');

    await restart([room]);
    await until(() => isRoomOpen(room), 10_000);
    await until(() => jobOf(tab.doc) === undefined, 10_000);
    expect(jobOf(getYDoc(room))).toBeUndefined();
  }, 20_000);
});

describe('the room job over real sync', () => {
  it('reaches every tab while running and when it ends', async () => {
    const room = `job-a-${Date.now()}`;
    const first = join(room);
    const second = join(room);
    await until(() => first.provider.synced && second.provider.synced);
    const id = jobs.start(room);
    await until(() => jobOf(first.doc)?.status === 'running' && jobOf(second.doc)?.status === 'running');
    jobs.finish(room, id, { status: 'failed', error: 'The AI took too long. Try again.' });
    await until(() => jobOf(first.doc)?.status === 'failed' && jobOf(second.doc)?.status === 'failed');
    expect(jobOf(second.doc)).toMatchObject({ id, error: 'The AI took too long. Try again.' });
  });

  it("undoes a peer's fake job, for everyone, even before the server ever wrote one", async () => {
    const room = `job-b-${Date.now()}`;
    const hostile = join(room);
    const other = join(room);
    await until(() => hostile.provider.synced && other.provider.synced);
    hostile.doc.getMap(JOB_MAP).set(JOB_KEY, { kind: 'job', id: 'x', status: 'running', startedAt: '2026-11-25T00:00:00.000Z' });
    await until(() => jobOf(hostile.doc) === undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(jobOf(other.doc)).toBeUndefined();
    expect(jobOf(getYDoc(room))).toBeUndefined();
  });

  it("puts the server's job back when a peer overwrites or deletes it, and removes extra keys", async () => {
    const room = `job-c-${Date.now()}`;
    const hostile = join(room);
    const other = join(room);
    await until(() => hostile.provider.synced && other.provider.synced);
    const id = jobs.start(room);
    await until(() => jobOf(hostile.doc)?.id === id && jobOf(other.doc)?.id === id);

    const map = hostile.doc.getMap<unknown>(JOB_MAP);
    map.set(JOB_KEY, { kind: 'job', id, status: 'failed', startedAt: 'x', finishedAt: 'x', error: 'Fake news' });
    map.set('extra', 'junk');
    await until(() => jobOf(hostile.doc)?.status === 'running' && !map.has('extra'));
    map.delete(JOB_KEY);
    await until(() => jobOf(hostile.doc)?.status === 'running');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(jobOf(other.doc)).toMatchObject({ id, status: 'running' });
    expect(other.doc.getMap(JOB_MAP).has('extra')).toBe(false);
  });
});
