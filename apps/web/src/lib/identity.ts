import { isHexColor } from './color';

// Who you are in a room: a display name and a color for your avatar and cursor.
export type Identity = { name: string; color: string };

export const MAX_NAME_LENGTH = 24;

const ADJECTIVES = ['Blue', 'Swift', 'Quiet', 'Brave', 'Sunny', 'Clever', 'Lucky', 'Gentle'];
const ANIMALS = ['Fox', 'Otter', 'Panda', 'Owl', 'Koala', 'Tiger', 'Heron', 'Lynx'];
const PEER_COLORS = ['#e76f51', '#2a9d8f', '#e9a23b', '#8338ec', '#3a86ff', '#ff006e', '#43aa8b', '#f3722c'];
const STORAGE_KEY = 'sketch-canvas:identity';

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function randomIdentity(): Identity {
  return { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEER_COLORS) };
}

// Anything that arrives from other players (or from storage) is untrusted until checked.
export function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && cleanName(v.name) !== '' && isHexColor(v.color);
}

export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

// Storage can be blocked (private mode, disabled site data), so every access is guarded and the
// app still works with a fresh identity.
export function loadIdentity(): Identity {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (isIdentity(stored)) return { name: cleanName(stored.name), color: stored.color };
  } catch {
    // fall through to a new identity
  }
  const identity = randomIdentity();
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // not saved; the name lasts for this visit only
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => Array.from(word)[0] ?? '') // Array.from keeps emoji whole (word[0] would split them)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
