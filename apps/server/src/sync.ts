import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { docs, setupWSConnection } from 'y-websocket/bin/utils';
import { ROOM_ID } from './roomId';

// A broken frame from a client (bad bits, invalid UTF-8, too large) makes the ws library emit
// 'error' on that socket. An 'error' event with no listener throws, and an uncaught throw stops
// the whole Node process: every room goes down because of one client. Neither y-websocket nor ws
// adds a listener, so we do. ws has already started closing the socket; terminate makes sure it
// is gone. Not logged on purpose: a client could send these in a loop and flood the log.
function dropOnError(ws: WebSocket): void {
  ws.on('error', () => ws.terminate());
}

export function roomNameFromUrl(url: string | undefined): string {
  return (url ?? '').slice(1).split('?')[0] ?? '';
}

// Whether anyone is in the room right now (an open WebSocket). Generate only spends money for a
// room someone is looking at; otherwise any made-up room id could buy pictures nobody sees.
export function isRoomOpen(roomId: string): boolean {
  return (docs.get(roomId)?.conns.size ?? 0) > 0;
}

// Yjs sync: one room per URL path, e.g. ws://localhost:1234/abc123
// `openRoom` runs for every new connection, before the tab's first update can arrive: it guards
// the parts of the room only the server may write (pictures, the job) and puts back what the
// server had before a restart.
export function attachYjsSync(server: Server, openRoom: (roomId: string) => void): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => {
    dropOnError(ws); // first, before anything else can emit
    // This runs inside the 'upgrade' event, so a throw here would also stop the process. Drop just
    // this connection instead. (No global uncaughtException handler: after an unknown error the
    // process may be broken, and crashing so a supervisor restarts it is safer.)
    try {
      // The same room name setupWSConnection uses: the URL path without the leading slash or query.
      // Only room names the web app makes (and /api/generate accepts). Anything else would still
      // get its own document in memory, kept for good: refuse it before one is made.
      const roomId = roomNameFromUrl(req.url);
      if (!ROOM_ID.test(roomId)) {
        ws.terminate();
        return;
      }
      openRoom(roomId);
      setupWSConnection(ws, req);
    } catch {
      ws.terminate();
    }
  });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return wss;
}
