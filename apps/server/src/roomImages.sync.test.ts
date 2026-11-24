import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { getYDoc } from 'y-websocket/bin/utils';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createRoomImages, IMAGES_ARRAY, type ImageRecord } from './roomImages';
import { attachYjsSync, isRoomOpen } from './sync';

// The real thing, end to end: our sync server on a free port, a real Yjs client over a real
// WebSocket. This is the wiring unit tests with a fake getDoc can't check: the room name, the one
// shared Yjs instance, and that a record written by the server reaches a tab.

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
let url: string;
const providers: WebsocketProvider[] = [];

function join(room: string): { doc: Y.Doc; provider: WebsocketProvider } {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, room, doc, { WebSocketPolyfill: WebSocket as never });
  providers.push(provider);
  return { doc, provider };
}

beforeEach(async () => {
  server = createServer();
  attachYjsSync(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `ws://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe('room pictures over real sync', () => {
  it('a picture the server adds reaches a connected tab', async () => {
    const room = `sync-a-${Date.now()}`;
    const { doc, provider } = join(room);
    await until(() => provider.synced);
    createRoomImages(getYDoc).add(room, record(1));
    await until(() => doc.getArray(IMAGES_ARRAY).length === 1);
    expect(doc.getArray(IMAGES_ARRAY).get(0)).toEqual(record(1));
  });

  it("a record a peer pushes is removed again, on the server and in the peer's own tab", async () => {
    const room = `sync-b-${Date.now()}`;
    const { doc, provider } = join(room);
    await until(() => provider.synced);
    createRoomImages(getYDoc).add(room, record(1));
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
    createRoomImages(getYDoc).add(room, record(1));
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
    createRoomImages(getYDoc).add(room, record(1));
    createRoomImages(getYDoc).add(room, record(2));
    await until(() => second.doc.getArray(IMAGES_ARRAY).length === 2);

    const images = first.doc.getArray(IMAGES_ARRAY);
    images.delete(0, images.length); // a hostile peer wipes the pictures
    await until(() => second.doc.getArray(IMAGES_ARRAY).length === 2 && first.doc.getArray(IMAGES_ARRAY).length === 2);
    const ids = (doc: Y.Doc) => doc.getArray<ImageRecord>(IMAGES_ARRAY).toArray().map((r) => r.id).sort();
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
