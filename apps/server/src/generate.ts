import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { BudgetExceededError } from './budget';
import { NotBilledError, PaidCallTimeoutError } from './cost';
import type { BriefOutcome, DescribeSketch } from './describeSketch';
import { ImageBlockedError, InvalidImageError } from './generateImage';
import { ContentFlaggedError, ModerationUnavailableError } from './moderation';
import { PictureStorageError, type MakePicture } from './picture';
import { decodeBase64, readPngInfo } from './png';
import { ROOM_ID } from './roomId';
import type { JobOutcome, RoomJobs } from './roomJobs';
import type { RoomLocks } from './roomLocks';

// Limits for an uploaded sketch. An 800x600 line drawing is typically 10-100 KB.
export const MAX_SKETCH_BYTES = 1_000_000;
// Claude's high-resolution vision tier downscales anything with a longer edge, so a bigger sketch
// would cost upload time and give the model nothing extra.
export const MAX_SKETCH_SIDE = 2576;
// base64 is 4/3 of the bytes, plus a little JSON around it.
const MAX_BASE64_LENGTH = Math.ceil(MAX_SKETCH_BYTES / 3) * 4;
const MAX_BODY_BYTES = MAX_BASE64_LENGTH + 1_000;

const GenerateRequest = z.object({
  roomId: z.string().regex(ROOM_ID),
  image: z.string().min(1).max(MAX_BASE64_LENGTH),
});

// Error messages stay short and generic: they say what to fix, not how the server works.
const tooLarge = { error: 'The sketch is too large.' };

type SketchImage = { base64: string; width: number; height: number };

// No job may hold a room longer than this. The paid calls have their own timeouts (brief 30 s,
// moderation 10 s, picture 120 s); this also covers the steps that have none (saving the picture,
// writing the picture log), so a hung disk can't grey out Generate in a room for good.
export const JOB_TIMEOUT_MS = 200_000;
// Jobs running at once on the whole server. The answer no longer waits for the work, so without
// this a script could start a job in many rooms at once, each holding its sketch (up to ~1.3 MB)
// in memory. The daily caps still bound the money; this bounds memory and open AI calls.
export const MAX_RUNNING_JOBS = 8;

export type JobLimits = { jobTimeoutMs: number; maxRunningJobs: number };
const DEFAULT_JOB_LIMITS: JobLimits = { jobTimeoutMs: JOB_TIMEOUT_MS, maxRunningJobs: MAX_RUNNING_JOBS };

// The whole job ran past JOB_TIMEOUT_MS.
export class JobTimeoutError extends Error {
  constructor() {
    super('The job took too long.');
    this.name = 'JobTimeoutError';
  }
}

const FALLBACK_FAILURE = 'Could not reach the AI service. Try again later.';

// Why there is no brief, in words for the player. Fixed strings only: nothing from the model,
// the provider or the request is echoed.
const OUTCOME_FAILURES: Record<Exclude<BriefOutcome, { ok: true }>['reason'], string> = {
  refused: 'The AI declined to describe this sketch. Try drawing something else.',
  truncated: "The AI's answer was unusable. Try again.",
  invalid: "The AI's answer was unusable. Try again.",
};

// A thrown error as a message for the room. Logs only the error's name (and HTTP status): SDK errors can carry
// request details, and the request holds the player's sketch.
function failureFor(error: unknown): string {
  if (error instanceof BudgetExceededError) {
    return error.scope === 'room'
      ? "This room has used today's AI budget. Try again tomorrow."
      : "Today's AI budget is used up. Try again tomorrow.";
  }
  if (error instanceof PaidCallTimeoutError) return 'The AI took too long. Try again.';
  // Flagged by our moderation check or by the image service's own: the same answer, no categories.
  // Logged (name only, never the prompt), so repeated abuse is visible.
  if (error instanceof ContentFlaggedError || error instanceof ImageBlockedError) {
    console.warn(`generate: picture refused (${error.name})`);
    return "That sketch can't be turned into a picture. Try drawing something else.";
  }
  const name = error instanceof Error ? error.name : typeof error;
  const detail = error instanceof NotBilledError ? ` ${error.status}${error.code ? ` ${error.code}` : ''}` : '';
  console.error(`generate: failed (${name}${detail})`);
  // Fail closed: no check, no picture.
  if (error instanceof ModerationUnavailableError) {
    return "Couldn't check the picture request. Try again in a minute.";
  }
  if (error instanceof JobTimeoutError) return 'The AI took too long. Try again.';
  if (error instanceof InvalidImageError) return 'The picture came back broken. Try again.';
  if (error instanceof PictureStorageError) return 'The picture was made but could not be saved. Try again.';
  // The provider's own rate limit (429) or overload (529): busy, worth another try soon.
  if (error instanceof NotBilledError && (error.status === 429 || error.status === 529)) {
    return 'The AI service is busy. Try again in a minute.';
  }
  return FALLBACK_FAILURE;
}

// An error's name for the log, never its message (it could carry the sketch or a key), and never
// a throw (a hostile `name` getter).
function nameOf(error: unknown): string {
  try {
    return error instanceof Error ? String(error.name) : typeof error;
  } catch {
    return 'unknown';
  }
}

// failureFor, made total: a thrown value whose `name` getter throws (or a log that fails) must
// not stop the job from being recorded and the room from being freed.
function safeFailureFor(error: unknown): string {
  try {
    return failureFor(error);
  } catch {
    return FALLBACK_FAILURE;
  }
}

// POST /api/generate: { roomId, image: base64 PNG } → 202 { jobId }.
// Checks the request, takes the room's lock and starts a job, then answers at once. The work runs
// on after the answer: the brief, then (when the server has an image key) the picture. How it
// went is written into the room's Yjs document (roomJobs.ts), so everyone in the room sees it,
// not only the person who clicked. Problems with the request itself (bad sketch, room not open,
// room busy) are still answered to the person who sent it.
export function createGenerateRoute({
  locks,
  jobs,
  describeSketch,
  makePicture,
  isRoomOpen,
  limits = DEFAULT_JOB_LIMITS,
}: {
  locks: RoomLocks;
  jobs: RoomJobs;
  // The vision step. Without one (no API key), Generate answers 503 and the canvas still works.
  describeSketch?: DescribeSketch;
  // Without an image key the server stops after the brief.
  makePicture?: MakePicture;
  // Whether someone has the room open (sync.ts). Nothing is paid for a room nobody is in.
  isRoomOpen: (roomId: string) => boolean;
  // Tests use small values; the server uses the defaults above.
  limits?: JobLimits;
}) {
  let running = 0;

  // The work of one job. Never rejects: every way it can end is written into the job, and the
  // room's lock (and its place among the running jobs) is given back however it ends.
  async function run(describe: DescribeSketch, job: { roomId: string; id: string; image: SketchImage }, release: () => void): Promise<void> {
    let outcome: JobOutcome = { status: 'failed', error: FALLBACK_FAILURE };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new JobTimeoutError()), limits.jobTimeoutMs);
        });
        // After the deadline the work may still finish (its paid calls end at their own timeouts),
        // and a picture that arrives that late is still shared; the job already says it failed,
        // and the room is free again. Promise.race also handles a late rejection.
        outcome = await Promise.race([makeOutcome(describe, job), deadline]);
      } catch (error) {
        outcome = { status: 'failed', error: safeFailureFor(error) };
      } finally {
        clearTimeout(timer);
      }
      jobs.finish(job.roomId, job.id, outcome);
    } catch (error) {
      console.error(`generate: could not record the job (${nameOf(error)})`);
      // Once more with a plain failure, so the room's job doesn't say "running" (and grey out
      // Generate for everyone) until the next job.
      try {
        jobs.finish(job.roomId, job.id, { status: 'failed', error: FALLBACK_FAILURE });
      } catch {
        // Nothing more to try; the lock is still given back below.
      }
    } finally {
      running -= 1;
      release();
    }
  }

  async function makeOutcome(describe: DescribeSketch, { roomId, image }: { roomId: string; image: SketchImage }): Promise<JobOutcome> {
    const outcome = await describe({ roomId, image });
    if (!outcome.ok) return { status: 'failed', error: OUTCOME_FAILURES[outcome.reason] };
    if (!makePicture) return { status: 'done', brief: outcome.brief, picture: false };
    // The sketch was exported at canvas size (1 canvas unit = 1 pixel), so the picture belongs
    // over the area the sketch covers. With a region (instant mode) x and y will come from it.
    await makePicture({ roomId, brief: outcome.brief, area: { x: 0, y: 0, w: image.width, h: image.height } });
    return { status: 'done', brief: outcome.brief, picture: true };
  }

  return new Hono().post(
    '/',
    // Refuses oversized bodies before reading them into memory (413 Payload Too Large).
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      if (!describeSketch) return c.json({ error: 'Generate is not set up on this server.' }, 503);
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = GenerateRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Invalid request.' }, 400);

      const bytes = decodeBase64(parsed.data.image);
      const png = bytes && readPngInfo(bytes);
      if (!png) return c.json({ error: 'The sketch must be a PNG image.' }, 400);
      if (png.bytes > MAX_SKETCH_BYTES || png.width > MAX_SKETCH_SIDE || png.height > MAX_SKETCH_SIDE) {
        return c.json(tooLarge, 413);
      }

      const { roomId } = parsed.data;
      if (running >= limits.maxRunningJobs) return c.json({ error: 'The server is busy. Try again in a minute.' }, 503);
      // Generate is for a room someone is drawing in. A made-up room id would otherwise buy
      // pictures nobody sees (and dodge the per-room cap by inventing rooms).
      if (!isRoomOpen(roomId)) return c.json({ error: 'Open the room before generating.' }, 409);

      // One generation at a time per room. Taken only for a valid request, and given back when
      // the job ends (run's finally), not when this answer goes out.
      const release = locks.tryAcquire(roomId);
      if (!release) return c.json({ error: 'A picture is already being generated in this room.' }, 409);
      let jobId: string;
      try {
        jobId = jobs.start(roomId);
      } catch (error) {
        release();
        throw error; // app.onError: a fixed 500, the error's name in the log
      }
      running += 1;
      // Not awaited: the answer goes out now. run never rejects; the catch is a last guard, because
      // an unhandled rejection would stop the whole server.
      run(describeSketch, { roomId, id: jobId, image: { base64: parsed.data.image, width: png.width, height: png.height } }, release).catch(() => {});
      return c.json({ jobId }, 202);
    },
  );
}
