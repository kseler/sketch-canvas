import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { docs } from 'y-websocket/bin/utils';
import { attachYjsSync } from './sync';

// FIN + RSV1 text frame, masked, length 0. RSV1 is invalid without negotiated compression.
const BAD_FRAME = Buffer.from([0xc1, 0x80, 1, 2, 3, 4]);

let server: Server;
let wss: WebSocketServer;
let port: number;
let clients: WebSocket[] = [];
let raws: Socket[] = [];

beforeEach(async () => {
  server = createServer();
  wss = attachYjsSync(server, () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  clients.forEach((c) => c.terminate());
  raws.forEach((s) => s.destroy());
  clients = [];
  raws = [];
  wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
});

function openClient(room: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/${room}`);
  clients.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Upgrades over raw TCP, sends the bad frame, resolves when the server has closed the socket.
async function sendBadFrame(room: string): Promise<void> {
  const socket = connect(port, '127.0.0.1');
  raws.push(socket);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      if (chunk.toString().startsWith('HTTP/1.1 101')) {
        socket.removeAllListeners('data');
        socket.write(BAD_FRAME);
        resolve();
      }
    });
    socket.write(
      `GET /${room} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
        'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );
  });
  socket.on('data', () => {}); // keep draining the close frame so the socket can end
  await closed;
}

describe('attachYjsSync', () => {
  // Direct check of the fix. Without it the crash tests still catch the bug, but only through
  // Vitest's "uncaught exception" report, while the tests themselves show as passed.
  it('opens the room named in the URL path for every connection, ignoring the query', async () => {
    const opened: string[] = [];
    const local = createServer();
    const localWss = attachYjsSync(local, (roomId) => opened.push(roomId));
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    const localPort = (local.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${localPort}/room-9?x=1`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    expect(opened).toEqual(['room-9']);
    ws.terminate();
    localWss.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => localWss.close(() => resolve()));
    await new Promise<void>((resolve) => local.close(() => resolve()));
  });

  it.each([
    ['an uppercase name', 'Room-1'],
    ['a name over 64 characters', 'a'.repeat(65)],
    ['an empty name', ''],
    ['a nested path', 'a/b'],
    ['an encoded name', 'room%2D1'],
  ])('closes a connection to %s before any document is made for it', async (_label, name) => {
    const opened: string[] = [];
    const local = createServer();
    const localWss = attachYjsSync(local, (roomId) => opened.push(roomId));
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${(local.address() as AddressInfo).port}/${name}`);
    ws.on('error', () => {});
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    expect(opened).toEqual([]);
    expect(docs.has(name)).toBe(false);
    localWss.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => localWss.close(() => resolve()));
    await new Promise<void>((resolve) => local.close(() => resolve()));
  });

  it('drops only the connection when opening the room throws, and the server keeps going', async () => {
    const local = createServer();
    let fail = true;
    const localWss = attachYjsSync(local, () => {
      if (fail) throw new Error('boom');
    });
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    const url = `ws://127.0.0.1:${(local.address() as AddressInfo).port}/room-1`;
    const first = new WebSocket(url);
    await new Promise<void>((resolve) => first.once('close', () => resolve()));
    fail = false;
    const second = new WebSocket(url);
    await new Promise((resolve, reject) => {
      second.once('open', resolve);
      second.once('error', reject);
    });
    expect(second.readyState).toBe(WebSocket.OPEN);
    second.terminate();
    localWss.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => localWss.close(() => resolve()));
    await new Promise<void>((resolve) => local.close(() => resolve()));
  });

  it('gives every server-side socket an error listener', async () => {
    await openClient('testroom01');
    expect(wss.clients.size).toBe(1);
    wss.clients.forEach((socket) => expect(socket.listenerCount('error')).toBeGreaterThan(0));
  });

  it('closes a socket that sends a malformed frame and keeps accepting connections', async () => {
    await sendBadFrame('testroom01');

    const sameRoom = await openClient('testroom01');
    const otherRoom = await openClient('testroom02');
    expect(sameRoom.readyState).toBe(WebSocket.OPEN);
    expect(otherRoom.readyState).toBe(WebSocket.OPEN);
  });

  it('leaves a well-behaved client in the same room connected', async () => {
    const good = await openClient('testroom01');

    await sendBadFrame('testroom01');

    expect(good.readyState).toBe(WebSocket.OPEN);
  });
});
