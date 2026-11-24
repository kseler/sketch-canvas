import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { BudgetExceededError } from './budget';
import { NotBilledError, PaidCallTimeoutError } from './cost';
import type { BriefOutcome, DescribeSketch } from './describeSketch';
import { decodeBase64, readPngInfo } from './png';
import type { RoomLocks } from './roomLocks';

// Limits for an uploaded sketch. An 800x600 line drawing is typically 10-100 KB.
export const MAX_SKETCH_BYTES = 1_000_000;
// Claude's high-resolution vision tier downscales anything with a longer edge, so a bigger sketch
// would cost upload time and give the model nothing extra.
export const MAX_SKETCH_SIDE = 2576;
// base64 is 4/3 of the bytes, plus a little JSON around it.
const MAX_BASE64_LENGTH = Math.ceil(MAX_SKETCH_BYTES / 3) * 4;
const MAX_BODY_BYTES = MAX_BASE64_LENGTH + 1_000;

// Same rule as the web app's isValidRoomId (apps/web/src/lib/roomId.ts); the server can't import it,
// so it is repeated here. Kept in sync by the tests on both sides.
const ROOM_ID = /^[a-z0-9-]{1,64}$/;

const GenerateRequest = z.object({
  roomId: z.string().regex(ROOM_ID),
  image: z.string().min(1).max(MAX_BASE64_LENGTH),
});

// Error replies stay short and generic: they say what to fix, not how the server works.
const tooLarge = { error: 'The sketch is too large.' };

// Thrown when the server has no API key, so Generate can't work (the canvas still does).
export class NotConfiguredError extends Error {
  constructor() {
    super('Generate is not configured on this server.');
    this.name = 'NotConfiguredError';
  }
}

type Failure = { status: 422 | 429 | 502 | 503 | 504; error: string };

// Why there is no brief, in words for the player. Fixed strings only: nothing from the model,
// the provider or the request is echoed.
const OUTCOME_FAILURES: Record<Exclude<BriefOutcome, { ok: true }>['reason'], Failure> = {
  refused: { status: 422, error: 'The AI declined to describe this sketch. Try drawing something else.' },
  truncated: { status: 502, error: "The AI's answer was unusable. Try again." },
  invalid: { status: 502, error: "The AI's answer was unusable. Try again." },
};

// A thrown error as a reply. Logs only the error's name (and HTTP status): SDK errors can carry
// request details, and the request holds the player's sketch.
function failureFor(error: unknown): Failure {
  if (error instanceof BudgetExceededError) {
    return error.scope === 'room'
      ? { status: 429, error: "This room has used today's AI budget. Try again tomorrow." }
      : { status: 429, error: "Today's AI budget is used up. Try again tomorrow." };
  }
  if (error instanceof PaidCallTimeoutError) return { status: 504, error: 'The AI took too long. Try again.' };
  if (error instanceof NotConfiguredError) return { status: 503, error: 'Generate is not set up on this server.' };
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`generate: brief failed (${name}${error instanceof NotBilledError ? ` ${error.status}` : ''})`);
  // The provider's own rate limit (429) or overload (529): busy, worth another try soon.
  if (error instanceof NotBilledError && (error.status === 429 || error.status === 529)) {
    return { status: 503, error: 'The AI service is busy. Try again in a minute.' };
  }
  return { status: 502, error: 'Could not reach the AI service. Try again later.' };
}

// POST /api/generate: { roomId, image: base64 PNG } → { brief }.
// Validates the sketch, takes the room's lock, and asks the vision model for a brief through the
// cost wrapper. Later chunks add the image and turn this into a job.
export function createGenerateRoute({ locks, describeSketch }: { locks: RoomLocks; describeSketch: DescribeSketch }) {
  return new Hono().post(
    '/',
    // Refuses oversized bodies before reading them into memory (413 Payload Too Large).
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = GenerateRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Invalid request.' }, 400);

      const bytes = decodeBase64(parsed.data.image);
      const png = bytes && readPngInfo(bytes);
      if (!png) return c.json({ error: 'The sketch must be a PNG image.' }, 400);
      if (png.bytes > MAX_SKETCH_BYTES || png.width > MAX_SKETCH_SIDE || png.height > MAX_SKETCH_SIDE) {
        return c.json(tooLarge, 413);
      }

      // One generation at a time per room. Taken only for a valid request, and released however
      // the work ends (success, error or a thrown exception).
      const release = locks.tryAcquire(parsed.data.roomId);
      if (!release) return c.json({ error: 'A picture is already being generated in this room.' }, 409);
      try {
        const outcome = await describeSketch({
          roomId: parsed.data.roomId,
          image: { base64: parsed.data.image, width: png.width, height: png.height },
        });
        if (!outcome.ok) {
          const failure = OUTCOME_FAILURES[outcome.reason];
          return c.json({ error: failure.error }, failure.status);
        }
        // No `status` field: that word is reserved for the job states chunk 6 adds
        // (queued, running, done, failed).
        return c.json({ brief: outcome.brief });
      } catch (error) {
        const failure = failureFor(error);
        return c.json({ error: failure.error }, failure.status);
      } finally {
        release();
      }
    },
  );
}
