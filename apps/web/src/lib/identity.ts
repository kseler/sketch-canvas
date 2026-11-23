import { isHexColor } from './color';

// Who you are in a room: a person id shared by all your tabs (one browser = one person), plus a
// display name and a color for your avatar and cursor.
export type Identity = { id: string; name: string; color: string };

// What other players (or older saved data) send: `id` is missing from tabs made before person ids.
export type IdentityData = Omit<Identity, 'id'> & { id?: string };

export const MAX_NAME_LENGTH = 24;
export const IDENTITY_STORAGE_KEY = 'sketch-canvas:identity';

const ADJECTIVES = ['Blue', 'Swift', 'Quiet', 'Brave', 'Sunny', 'Clever', 'Lucky', 'Gentle'];
const ANIMALS = ['Fox', 'Otter', 'Panda', 'Owl', 'Koala', 'Tiger', 'Heron', 'Lynx'];
const PEER_COLORS = ['#e76f51', '#2a9d8f', '#e9a23b', '#8338ec', '#3a86ff', '#ff006e', '#43aa8b', '#f3722c'];

// People see characters (graphemes), not UTF-16 units: 🦊 is 2 units, 🇭🇷 is 4, 👩‍💻 is 5. Cutting
// or picking by units can split one in half and show a broken glyph.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

// At least one character a person can see: not only spaces, control characters or invisible
// format characters such as the zero-width space (U+200B), which trim() leaves in place.
export function hasVisibleText(text: string): boolean {
  return /[^\p{Z}\p{Cc}\p{Cf}]/u.test(text);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

// A person id groups one browser's tabs. It is a display hint, not a login. Ids, names and colors
// are all broadcast, so a peer can copy yours: it then merges into your avatar ("· 2 tabs"), lowers
// "N online", can make your avatar show its name for others, and its cursor is hidden from you.
// Preventing that needs identity checked by the server (login); until then an id must only ever
// affect how presence is DISPLAYED, never what anyone may do. From other players it's untrusted:
// short and plain only.
export function newPersonId(): string {
  return crypto.randomUUID();
}

export function isPersonId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}

export function randomIdentity(): Identity {
  return { id: newPersonId(), name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEER_COLORS) };
}

// Anything that arrives from other players (or from storage) is untrusted until checked.
// `id` may be missing (older tabs), but if present it must be a valid person id.
export function isIdentity(value: unknown): value is IdentityData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  // Checked on the name as it will be shown: "24 zero-width spaces + x" is visible before cutting
  // and invisible after.
  return (
    typeof v.name === 'string' &&
    hasVisibleText(cleanName(v.name)) &&
    isHexColor(v.color) &&
    (v.id === undefined || isPersonId(v.id))
  );
}

// Names from other players can be any size and are cleaned on every awareness update. Splitting a
// 5 MB name into graphemes takes ~200 ms, so it is first cut cheaply to a size no real 24-character
// name exceeds (even 24 long joined emoji fit).
const MAX_RAW_NAME_UNITS = MAX_NAME_LENGTH * 16;

// Trimmed and at most MAX_NAME_LENGTH characters, never cutting a character in half, and trimmed
// again so the cut can't leave a trailing space.
export function cleanName(name: string): string {
  const capped = name.trim().slice(0, MAX_RAW_NAME_UNITS).replace(/[\uD800-\uDBFF]$/, ''); // no half emoji at the cap
  return graphemes(capped).slice(0, MAX_NAME_LENGTH).join('').trim();
}

// The identity currently saved, if it is valid and complete (has an id). Never writes, never makes
// a new one: for merging a change into what another tab may have saved meanwhile.
export function readStoredIdentity(): Identity | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) ?? 'null');
    if (isIdentity(stored) && stored.id) return { id: stored.id, name: cleanName(stored.name), color: stored.color };
  } catch {
    // unreadable or blocked: nothing usable is saved
  }
  return null;
}

// Storage can be blocked (private mode, disabled site data), so every access is guarded and the
// app still works with a fresh identity.
export function loadIdentity(): Identity {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) ?? 'null');
    if (isIdentity(stored)) {
      const identity = { id: stored.id ?? newPersonId(), name: cleanName(stored.name), color: stored.color };
      if (!stored.id) saveIdentity(identity); // saved before person ids existed: keep the new id
      return identity;
    }
  } catch {
    // fall through to a new identity
  }
  const identity = randomIdentity();
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // not saved; the name lasts for this visit only
  }
}

// First character of the first two words: "Blue Fox" → "BF", "Fox 🦊" → "F🦊".
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => upperOne(graphemes(word)[0] ?? ''))
    .join('');
}

// Uppercase one character, unless that turns it into two ("ß" → "SS" would give three initials).
function upperOne(char: string): string {
  const upper = char.toUpperCase();
  return graphemes(upper).length === 1 ? upper : char;
}
