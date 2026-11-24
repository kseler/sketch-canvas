// Checks on the sketch a browser sends, before anything is done with it (later: before it is paid
// for). The browser is untrusted: it can send any bytes and claim they are a PNG.

export type PngInfo = { width: number; height: number; bytes: number };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Strict base64. Node's Buffer.from(s, 'base64') silently skips characters it doesn't know, so
// garbage would decode to "something"; this refuses it instead.
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !BASE64.test(text)) return null;
  return Buffer.from(text, 'base64');
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52]; // "IHDR"
const MIN_PNG_BYTES = 8 + 4 + 4 + 13 + 4; // signature + IHDR chunk (length, type, data, CRC)

const startsWith = (data: Uint8Array, bytes: number[], at: number) => bytes.every((b, i) => data[at + i] === b);
const uint32 = (data: Uint8Array, at: number) =>
  ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;

// Width and height from the PNG header, judged by the bytes themselves (the "magic number"), never
// by a name or a declared content type. Null if it isn't a PNG.
// It reads only the header: a file with a valid header and broken image data passes here, and the
// vision API rejects it later. That's fine; this check is about refusing non-images cheaply.
export function readPngInfo(data: Uint8Array): PngInfo | null {
  if (data.length < MIN_PNG_BYTES || !startsWith(data, SIGNATURE, 0) || !startsWith(data, IHDR, 12)) return null;
  const width = uint32(data, 16);
  const height = uint32(data, 20);
  if (width === 0 || height === 0) return null;
  return { width, height, bytes: data.length };
}
