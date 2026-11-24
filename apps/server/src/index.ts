import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { attachYjsSync } from './sync';

const PORT = Number(process.env.PORT ?? 1234);

const server = serve({ fetch: createApp().fetch, port: PORT }) as Server;

attachYjsSync(server);

console.log(`server listening on http://localhost:${PORT}`);
