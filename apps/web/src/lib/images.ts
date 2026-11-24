import type * as Y from 'yjs';

// A generated picture, as the server writes it into the room's Yjs document (`images` array).
// Peers and the server's copy are untrusted input like everything else in the document, so every
// record is checked before it is drawn.
export type ImageRecord = { kind: 'image'; id: string; url: string; x: number; y: number; w: number; h: number; createdAt: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// Only our own server's image path: no other host, no `javascript:`, no `data:`.
export const IMAGE_URL = new RegExp(`^/api/images/${UUID}\\.png$`);
const ID = new RegExp(`^${UUID}$`);

// Bounds that no real picture comes near, so a hostile record can't break the layout with sizes
// like 1e300 (canvas units; the canvas is 800x600).
const MAX_EXTENT = 10_000;
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function isImageRecord(value: unknown): value is ImageRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.kind === 'image' &&
    typeof r.id === 'string' &&
    ID.test(r.id) &&
    typeof r.url === 'string' &&
    IMAGE_URL.test(r.url) &&
    r.url === `/api/images/${r.id}.png` &&
    inRange(r.x, -MAX_EXTENT, MAX_EXTENT) &&
    inRange(r.y, -MAX_EXTENT, MAX_EXTENT) &&
    // At least 1 canvas unit: a near-zero side would make the panel's aspect ratio absurd.
    inRange(r.w, 1, MAX_EXTENT) &&
    inRange(r.h, 1, MAX_EXTENT) &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length <= 40
  );
}

// The room's valid pictures, oldest first. Records of a kind this version doesn't know are skipped
// (CLAUDE.md instant-mode rule 2), never a crash.
export function readImages(images: Y.Array<unknown>): ImageRecord[] {
  return images.toArray().filter(isImageRecord);
}

// How far back from the end the panel looks for a picture. The server removes records peers add,
// but the panel must stay fast even if a flood slips through: it never scans the whole array.
export const LATEST_SCAN = 20;

// The newest valid picture among the last LATEST_SCAN entries, skipping ids in `skip` (pictures
// that failed to load). Null if there is none.
export function latestImage(images: Y.Array<unknown>, skip: ReadonlySet<string> = new Set()): ImageRecord | null {
  const from = Math.max(0, images.length - LATEST_SCAN);
  const tail = images.slice(from);
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const item = tail[i];
    if (isImageRecord(item) && !skip.has(item.id)) return item;
  }
  return null;
}
