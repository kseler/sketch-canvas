import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidRoomId, newRoomId } from './roomId';

afterEach(() => {
  vi.restoreAllMocks();
});

// Replaces crypto.getRandomValues with one that fills the array from `bytes`.
function fakeRandomBytes(bytes: number[]) {
  return vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint8Array) array.set(bytes.slice(0, array.length));
    return array;
  });
}

describe('newRoomId', () => {
  // The id length is the room's only protection (no login): 10 chars of 36 = 36^10 possible rooms.
  it('is 10 characters of lowercase letters and digits', () => {
    expect(newRoomId()).toMatch(/^[a-z0-9]{10}$/);
  });

  it('passes isValidRoomId, so a new room is never replaced by another fresh one', () => {
    expect(isValidRoomId(newRoomId())).toBe(true);
  });

  it('uses crypto.getRandomValues, not Math.random (ids must be unguessable)', () => {
    const cryptoSpy = vi.spyOn(crypto, 'getRandomValues');
    const mathSpy = vi.spyOn(Math, 'random');
    newRoomId();
    expect(cryptoSpy).toHaveBeenCalledTimes(1);
    expect(mathSpy).not.toHaveBeenCalled();
  });

  it('maps each random byte to one character of the alphabet', () => {
    fakeRandomBytes([0, 1, 2, 25, 26, 35, 36, 71, 255, 9]);
    // 36 wraps to 'a', 71 = 36 + 35 wraps to '9', 255 % 36 = 3 is 'd'.
    expect(newRoomId()).toBe('abcz09a9dj');
  });

  it('can produce every character of the alphabet, and nothing else', () => {
    const seen = new Set<string>();
    for (let start = 0; start < 256; start += 10) {
      fakeRandomBytes(Array.from({ length: 10 }, (_, i) => (start + i) % 256));
      for (const char of newRoomId()) seen.add(char);
    }
    expect([...seen].sort().join('')).toBe('0123456789abcdefghijklmnopqrstuvwxyz');
  });

  it('gives different ids on different calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRoomId()));
    expect(ids.size).toBe(100);
  });
});

describe('isValidRoomId (the URL hash, which ends up in the WebSocket URL path)', () => {
  it.each(['abc123', 'a', 'my-room', '0123456789'])('accepts %j', (value) => {
    expect(isValidRoomId(value)).toBe(true);
  });

  it('accepts exactly 64 characters, rejects 65', () => {
    expect(isValidRoomId('a'.repeat(64))).toBe(true);
    expect(isValidRoomId('a'.repeat(65))).toBe(false);
  });

  it('rejects the empty hash', () => {
    expect(isValidRoomId('')).toBe(false);
  });

  // Callers lowercase first; uppercase here means a caller skipped that, and #ABC would be a different room.
  it('rejects uppercase', () => {
    expect(isValidRoomId('ABC')).toBe(false);
  });

  it.each([
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
    ['a non-ASCII look-alike letter', 'rооm'], // Cyrillic о
    ['an emoji', 'room🦊'],
  ])('rejects %s', (_label, value) => {
    expect(isValidRoomId(value)).toBe(false);
  });
});
