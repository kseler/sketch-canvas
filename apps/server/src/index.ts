import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { attachYjsSync } from './sync';

const PORT = Number(process.env.PORT ?? 1234);

const app = new Hono();
app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

// Generate pipeline: not built yet.
app.post('/api/generate', (c) => c.json({ status: 'not-implemented' }, 501));

const server = serve({ fetch: app.fetch, port: PORT }) as Server;

attachYjsSync(server);

console.log(`server listening on http://localhost:${PORT}`);
