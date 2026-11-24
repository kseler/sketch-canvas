import { describe, expect, it } from 'vitest';
import { createApp } from './app';

// The server repeats the web rule isValidRoomId (apps/web/src/lib/roomId.ts) in generate.ts. These are
// the same accept/reject cases as apps/web/src/lib/roomId.test.ts: change one side, and update both.
// Seen through POST /api/generate, since the rule is not exported.

const app = createApp();
const image = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
  8, 0, 0, 0, 0, 0, 0, 0, 0,
]).toString('base64');

const status = async (roomId: string) =>
  (
    await app.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, image }),
    })
  ).status;

describe('server room id rule (parity with the web isValidRoomId)', () => {
  it.each(['abc123', 'a', 'my-room', '0123456789', 'a'.repeat(64)])('accepts %j', async (value) => {
    expect(await status(value)).toBe(200);
  });

  it.each([
    ['empty', ''],
    ['65 characters', 'a'.repeat(65)],
    ['uppercase', 'ABC'],
    ['path traversal', '../admin'],
    ['a path separator', 'room/other'],
    ['a backslash', 'room\\other'],
    ['a query string', 'room?token=x'],
    ['a second hash', 'room#x'],
    ['percent-encoding', 'room%2F..'],
    ['a dot', 'room.json'],
    ['a space', 'my room'],
    ['a trailing newline', 'room\n'],
    ['a leading newline', '\nroom'],
    ['an underscore', 'my_room'],
    ['a non-ASCII look-alike letter', 'rооm'],
    ['an emoji', 'room🦊'],
  ])('rejects %s', async (_label, value) => {
    expect(await status(value)).toBe(400);
  });
});
