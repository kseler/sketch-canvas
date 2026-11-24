import { describe, expect, it } from 'vitest';
import { decodeBase64, readPngInfo } from './png';

// A PNG header built by hand: signature, IHDR chunk (length 13, type, width, height, 5 more bytes, CRC).
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    ...SIGNATURE,
    ...be32(13),
    0x49, 0x48, 0x44, 0x52, // IHDR
    ...be32(width),
    ...be32(height),
    8, 0, 0, 0, 0, // bit depth, colour type, compression, filter, interlace
    0, 0, 0, 0, // CRC (not checked)
  ]);
}

const list = (data: Uint8Array | null) => (data ? Array.from(data) : data);

describe('decodeBase64', () => {
  it('decodes valid base64 with and without padding', () => {
    expect(list(decodeBase64('SGk='))).toEqual([72, 105]);
    expect(list(decodeBase64('SGVs'))).toEqual([72, 101, 108]);
    expect(list(decodeBase64('SA=='))).toEqual([72]);
  });

  it('decodes the empty string to no bytes', () => {
    expect(list(decodeBase64(''))).toEqual([]);
  });

  it('decodes the + and / characters', () => {
    expect(list(decodeBase64('+/+/'))).toEqual([251, 255, 191]);
  });

  it.each([
    ['a space inside', 'SGk =='],
    ['a newline', 'SGVs\nbG8='],
    ['a bad character Buffer would skip', 'SG!k'],
    ['a data: URL prefix', 'data:image/png;base64,SGk='],
    ['URL-safe alphabet', 'SG-_'],
    ['a length not divisible by 4', 'SGVsb'],
    ['too much padding', 'S==='],
    ['padding in the middle', 'SG==SGVs'],
    ['a non-ASCII letter', 'SGVé'],
  ])('rejects %s', (_label, text) => {
    expect(decodeBase64(text)).toBeNull();
  });
});

describe('readPngInfo', () => {
  it('reads width, height and size from a PNG header', () => {
    const data = pngHeader(800, 600);
    expect(readPngInfo(data)).toEqual({ width: 800, height: 600, bytes: data.length });
  });

  it('reads width and height as big-endian (not swapped or little-endian)', () => {
    expect(readPngInfo(pngHeader(1, 256))).toMatchObject({ width: 1, height: 256 });
    expect(readPngInfo(pngHeader(0x01020304, 0x0a0b0c0d))).toMatchObject({ width: 0x01020304, height: 0x0a0b0c0d });
  });

  it('reads sizes above 2^31 as unsigned', () => {
    expect(readPngInfo(pngHeader(0x80000000, 0xffffffff))).toMatchObject({ width: 2 ** 31, height: 2 ** 32 - 1 });
  });

  it('accepts a real 1x1 PNG', () => {
    const real = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(readPngInfo(real)).toEqual({ width: 1, height: 1, bytes: real.length });
  });

  it.each([
    ['zero width', pngHeader(0, 10)],
    ['zero height', pngHeader(10, 0)],
    ['empty data', new Uint8Array()],
    ['only the signature', Uint8Array.from(SIGNATURE)],
    ['a header one byte too short', pngHeader(1, 1).slice(0, -1)],
    ['a JPEG header', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])],
    ['a GIF header', Uint8Array.from([...Buffer.from('GIF89a'), ...new Array(40).fill(0)])],
    ['text', Uint8Array.from(Buffer.from('<html>' + ' '.repeat(40)))],
  ])('returns null for %s', (_label, data) => {
    expect(readPngInfo(data)).toBeNull();
  });

  it('returns null when the signature is right but the first chunk is not IHDR', () => {
    const data = pngHeader(10, 10);
    data.set([0x74, 0x45, 0x58, 0x74], 12); // "tEXt"
    expect(readPngInfo(data)).toBeNull();
  });

  it('returns null when one signature byte is wrong', () => {
    const data = pngHeader(10, 10);
    data[1] = 0x51;
    expect(readPngInfo(data)).toBeNull();
  });
});
