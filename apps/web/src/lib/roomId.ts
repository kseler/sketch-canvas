// Rooms have no login: anyone with the link can join, so ids made here are unguessable:
// 10 characters from a cryptographic random source = 36^10 (~3.6 quadrillion) possible rooms.
// That only holds for ids from newRoomId. A hand-typed link like #a is a valid but guessable room,
// and the server enforces no minimum yet (planned with the other server limits).
const ID_LENGTH = 10;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  // 256 is not a multiple of 36, so a few characters are very slightly more likely. Fine for a
  // room link; it would not be fine for a password.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

// The hash comes from the URL, so it's user input, and it ends up in the WebSocket URL path.
// Accept only a short, plain, lowercase id; anything else gets a fresh room. (Callers lowercase
// first, so #ABC and #abc are the same room.)
export function isValidRoomId(value: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(value);
}
