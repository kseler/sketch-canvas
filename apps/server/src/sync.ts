import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

// A broken frame from a client (bad bits, invalid UTF-8, too large) makes the ws library emit
// 'error' on that socket. An 'error' event with no listener throws, and an uncaught throw stops
// the whole Node process: every room goes down because of one client. Neither y-websocket nor ws
// adds a listener, so we do. ws has already started closing the socket; terminate makes sure it
// is gone. Not logged on purpose: a client could send these in a loop and flood the log.
function dropOnError(ws: WebSocket): void {
  ws.on('error', () => ws.terminate());
}

// Yjs sync: one room per URL path, e.g. ws://localhost:1234/abc123
export function attachYjsSync(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => {
    dropOnError(ws); // first, before anything else can emit
    // This runs inside the 'upgrade' event, so a throw here would also stop the process. Drop just
    // this connection instead. (No global uncaughtException handler: after an unknown error the
    // process may be broken, and crashing so a supervisor restarts it is safer.)
    try {
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
