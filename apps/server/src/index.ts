import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { readAllowedOrigins, readBudgetLimits } from './config';
import { createCostTracker } from './cost';
import { attachYjsSync } from './sync';

// Keys and budget settings live in .env at the repo root (see .env.example). Node reads it
// itself, so no extra dependency. A missing file is fine; values may come from the real
// environment instead, and those win over the file.
try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const PORT = Number(process.env.PORT ?? 1234);

// Rebuild today's spending from the log before taking any request, so a restart doesn't reset
// the caps. Chunk 3 hands `costs` to the generate route, which makes the first paid call.
const limits = readBudgetLimits(process.env);
const costs = createCostTracker({
  limits,
  logPath: fileURLToPath(new URL('../cost-log.jsonl', import.meta.url)),
});
const { skipped } = await costs.loadToday();
console.log(
  `budget: $${costs.spentUsd().toFixed(4)} of $${limits.dailyUsd.toFixed(2)} spent today` +
    ` (per room: $${limits.roomDailyUsd.toFixed(2)})` +
    (skipped > 0 ? `; skipped ${skipped} unreadable log line(s)` : ''),
);

const app = createApp({ allowedOrigins: readAllowedOrigins(process.env) });
const server = serve({ fetch: app.fetch, port: PORT }) as Server;

attachYjsSync(server);

console.log(`server listening on http://localhost:${PORT}`);
