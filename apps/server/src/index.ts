import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const PORT = Number(process.env.PORT ?? 1234);

const app = new Hono();
app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

// Generate pipeline: not built yet.
app.post('/api/generate', (c) => c.json({ status: 'not-implemented' }, 501));

const server = serve({ fetch: app.fetch, port: PORT }) as Server;

// Yjs sync: one room per URL path, e.g. ws://localhost:1234/abc123
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req) => setupWSConnection(ws, req));
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

console.log(`server listening on http://localhost:${PORT}`);
