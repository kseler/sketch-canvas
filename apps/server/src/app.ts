import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { DEFAULT_ALLOWED_ORIGINS } from './config';
import type { DescribeSketch } from './describeSketch';
import type { ImageStore } from './imageStore';
import type { MakePicture } from './picture';
import { createGenerateRoute, type JobLimits } from './generate';
import type { RoomJobs } from './roomJobs';
import { createRoomLocks, type RoomLocks } from './roomLocks';

export type AppOptions = {
  // Web pages that may call the API from a browser. In development the web app goes through
  // Vite's proxy, which keeps the page's Origin (http://localhost:5173), so that must be listed.
  allowedOrigins?: string[];
  locks?: RoomLocks;
  // Writes each generation's status into the room's shared document (roomJobs.ts).
  jobs: RoomJobs;
  // The vision step. Without one (no API key), Generate answers 503 and the canvas still works.
  describeSketch?: DescribeSketch;
  // The image step. Without one (no image key), Generate stops after the brief.
  makePicture?: MakePicture;
  // Where generated pictures are stored, for GET /api/images/:file.
  images?: ImageStore;
  // Whether someone has the room open (sync.ts isRoomOpen). Tests default to "yes".
  isRoomOpen?: (roomId: string) => boolean;
  // The job deadline and how many jobs may run at once; defaults in generate.ts.
  jobLimits?: JobLimits;
};

// CORS alone does not stop a request: it only stops the browser from reading the answer, and it
// asks first (a preflight) only for "non-simple" requests. A page on another site can still send
// `fetch(ourUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: json })`
// with no preflight, and the server would do the work (and, from chunk 3, spend money).
// So every request that can change something must come from an allowed page (or from no page at
// all, like curl), and must say it is JSON. Browsers always send Origin on a cross-site POST and
// can't fake it. Deny by default: only the read-only methods skip the check, so a PUT or DELETE
// route added later is covered without anyone remembering to add it here.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function postGuard(allowedOrigins: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    if (READ_ONLY_METHODS.has(c.req.method)) return next();
    const origin = c.req.header('Origin');
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return c.json({ error: 'This page may not use the API.' }, 403);
    }
    // Only application/json, which is never a "simple" type, so a browser can't send it from
    // another site without the preflight that CORS then refuses.
    const type = c.req.header('Content-Type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(type)) {
      return c.json({ error: 'Send the request as JSON.' }, 415);
    }
    return next();
  };
}

// The HTTP routes, without starting a server, so tests can call them with app.request().
export function createApp({
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  locks = createRoomLocks(),
  jobs,
  describeSketch,
  makePicture,
  images,
  isRoomOpen = () => true,
  jobLimits,
}: AppOptions): Hono {
  const app = new Hono();
  // Lets the listed origins read our answers. Other sites can't read them, and can't send JSON
  // without a preflight, which fails for them. CORS only binds browsers: curl or a script ignores
  // it, which is what the rate limits and the invite code are for (Nov 30).
  app.use('/api/*', cors({ origin: [...allowedOrigins] }));
  // Covers /api/* only: every route that changes something must live under /api.
  app.use('/api/*', postGuard(allowedOrigins));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/generate', createGenerateRoute({ locks, jobs, describeSketch, makePicture, isRoomOpen, ...(jobLimits ? { limits: jobLimits } : {}) }));
  // A stored picture. Only names our store writes can match (UUID + .png), so no other file can be
  // read. nosniff: browsers must treat it as the PNG we say it is, never guess another type.
  app.get('/api/images/:file', async (c) => {
    const png = images ? await images.read(c.req.param('file')) : null;
    if (!png) return c.json({ error: 'Not found.' }, 404);
    // A plain copy: Hono wants a Uint8Array backed by an ArrayBuffer, not Node's shared Buffer pool.
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      // Opened directly, the file may do nothing but be shown.
      'Content-Security-Policy': "default-src 'none'",
      // A picture never changes once stored (a new one gets a new name).
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });
  // Anything a route didn't handle: a fixed reply, and only the error's name in the log.
  app.onError((error, c) => {
    console.error(`unhandled error: ${error.name}`);
    return c.json({ error: 'Something went wrong.' }, 500);
  });
  return app;
}
