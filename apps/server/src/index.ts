import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { readAllowedOrigins, readBudgetLimits } from './config';
import { createCostTracker } from './cost';
import { ANTHROPIC_API_URL, anthropicBriefClient, createDescribeSketch } from './describeSketch';
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
// the caps.
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

// The key is only read here, on the server, and never logged (CLAUDE.md rule 1). Without it the
// canvas still works and Generate answers 503.
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const describeSketch = apiKey
  ? createDescribeSketch({ client: anthropicBriefClient(new Anthropic({ apiKey, baseURL: ANTHROPIC_API_URL })), costs })
  : undefined;
if (!describeSketch) console.warn('ANTHROPIC_API_KEY is not set: Generate is off.');
// The SDK's debug log prints whole requests, including every player's sketch. Fine for a quick
// local look, never for a server other people use.
const sdkLog = process.env.ANTHROPIC_LOG?.trim().toLowerCase();
// Fails closed: allowed only when NODE_ENV says development or test, so a deploy that forgot to
// set NODE_ENV refuses to start rather than logging sketches.
if (sdkLog === 'debug' || sdkLog === 'info') {
  const env = process.env.NODE_ENV;
  if (env !== 'development' && env !== 'test') {
    throw new Error('ANTHROPIC_LOG=debug/info logs every sketch; allowed only with NODE_ENV=development or test.');
  }
  console.warn(`ANTHROPIC_LOG=${sdkLog}: the SDK will log request bodies, including sketches.`);
}

const app = createApp({ allowedOrigins: readAllowedOrigins(process.env), describeSketch });
const server = serve({ fetch: app.fetch, port: PORT }) as Server;

attachYjsSync(server);

console.log(`server listening on http://localhost:${PORT}`);
