import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
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

// POST /api/generate: { roomId, image: base64 PNG }.
// Validates the sketch and confirms what it got. Later chunks turn it into a job (brief, then
// image) behind the cost wrapper and budget checks.
export function createGenerateRoute({ locks }: { locks: RoomLocks }) {
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
        // Chunk 3: the brief and the image calls go here, through costs.paidCall.
        // No `status` field yet: that word is reserved for the job states chunk 6 adds
        // (queued, running, done, failed).
        return c.json({ width: png.width, height: png.height, bytes: png.bytes });
      } finally {
        release();
      }
    },
  );
}
