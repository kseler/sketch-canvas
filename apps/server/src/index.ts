import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { getYDoc } from 'y-websocket/bin/utils';
import { createApp } from './app';
import { readAllowedOrigins, readBudgetLimits } from './config';
import { createCostTracker } from './cost';
import { createDescribeSketchForKey } from './describeSketch';
import { createPictureCallsForKey } from './generateImage';
import { createImageStore } from './imageStore';
import { createMakePicture, type MakePicture } from './picture';
import { createRoomImages } from './roomImages';
import { createRoomJobs } from './roomJobs';
import { attachYjsSync, isRoomOpen } from './sync';

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
  ? createDescribeSketchForKey(apiKey, costs)
  : undefined;
if (!describeSketch) console.warn('ANTHROPIC_API_KEY is not set: Generate is off.');
// The SDKs' debug logs print whole requests: every player's sketch (ANTHROPIC_LOG), every image
// prompt and picture (OPENAI_LOG). Fine for a quick local look, never for a server other people
// use. Fails closed: allowed only when NODE_ENV says development or test, so a deploy that forgot
// to set NODE_ENV refuses to start rather than logging sketches.
for (const name of ['ANTHROPIC_LOG', 'OPENAI_LOG']) {
  const sdkLog = process.env[name]?.trim().toLowerCase();
  if (sdkLog !== 'debug' && sdkLog !== 'info') continue;
  const env = process.env.NODE_ENV;
  if (env !== 'development' && env !== 'test') {
    throw new Error(`${name}=debug/info logs every request; allowed only with NODE_ENV=development or test.`);
  }
  console.warn(`${name}=${sdkLog}: the SDK will log request bodies, including sketches.`);
}

// Which picture belongs to which room, read back from data/room-images.jsonl, so a restart doesn't
// empty the rooms' picture panels. Read before the server takes connections.
const roomImages = createRoomImages({
  getDoc: getYDoc,
  logPath: fileURLToPath(new URL('../data/room-images.jsonl', import.meta.url)),
});
const pictures = await roomImages.load();
console.log(`pictures: ${pictures.loaded} known` + (pictures.skipped > 0 ? `; skipped ${pictures.skipped} unreadable log line(s)` : ''));
const jobs = createRoomJobs({ getDoc: getYDoc });

// The image step needs the OpenAI key (IMAGE_API_KEY, Images + Moderations). Without it, Generate
// stops after the brief. The API host is pinned like Anthropic's; SDK retries are off per call.
const images = createImageStore(fileURLToPath(new URL('../data/images', import.meta.url)));
const imageKey = process.env.IMAGE_API_KEY?.trim();
let makePicture: MakePicture | undefined;
if (imageKey) {
  makePicture = createMakePicture({
    ...createPictureCallsForKey(imageKey, costs),
    store: images,
    rooms: roomImages,
  });
} else {
  console.warn('IMAGE_API_KEY is not set: Generate stops after the brief.');
}

const app = createApp({ allowedOrigins: readAllowedOrigins(process.env), jobs, describeSketch, makePicture, images, isRoomOpen });
const server = serve({ fetch: app.fetch, port: PORT }) as Server;

attachYjsSync(server, (roomId) => {
  roomImages.open(roomId);
  jobs.open(roomId);
});

console.log(`server listening on http://localhost:${PORT}`);
