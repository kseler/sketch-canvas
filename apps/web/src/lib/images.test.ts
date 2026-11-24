import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { IMAGE_URL, isImageRecord, readImages, type ImageRecord, latestImage, LATEST_SCAN } from './images';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const valid: ImageRecord = {
  kind: 'image',
  id: ID,
  url: `/api/images/${ID}.png`,
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  createdAt: '2026-11-24T12:00:00.000Z',
};
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('isImageRecord', () => {
  it('accepts a valid record', () => {
    expect(isImageRecord(valid)).toBe(true);
  });

  it('accepts negative positions and fractional sizes of at least one unit', () => {
    expect(isImageRecord({ ...valid, x: -20.5, y: -1, w: 1.5, h: 100.25 })).toBe(true);
  });

  it('rejects a side under one canvas unit', () => {
    expect(isImageRecord({ ...valid, w: 0.5 })).toBe(false);
  });

  it.each([
    ['another kind', { kind: 'stroke' }],
    ['a missing kind', { kind: undefined }],
    ['an absolute url on another host', { url: `https://evil.example/api/images/${ID}.png` }],
    ['a protocol-relative url', { url: `//evil.example/api/images/${ID}.png` }],
    ['a javascript: url', { url: 'javascript:alert(1)' }],
    ['a data: url', { url: 'data:image/png;base64,AAAA' }],
    ['a url that does not match the id', { url: `/api/images/${OTHER}.png` }],
    ['a url with a path trick', { url: `/api/images/../images/${ID}.png` }],
    ['a url with a query', { url: `/api/images/${ID}.png?x=1` }],
    ['a url with a trailing newline', { url: `/api/images/${ID}.png\n` }],
    ['a non-string url', { url: 5 }],
    ['a missing url', { url: undefined }],
    ['an uppercase id and url', { id: ID.toUpperCase(), url: `/api/images/${ID.toUpperCase()}.png` }],
    ['a non-v4 id and url', { id: '3f2b8c1e-9a4d-1e6f-8b7a-1c2d3e4f5a6b', url: '/api/images/3f2b8c1e-9a4d-1e6f-8b7a-1c2d3e4f5a6b.png' }],
    ['a non-string id', { id: 5 }],
    ['an empty id', { id: '' }],
    ['a NaN x', { x: Number.NaN }],
    ['an Infinity y', { y: Infinity }],
    ['a string x', { x: '0' }],
    ['a missing x', { x: undefined }],
    ['a NaN w', { w: Number.NaN }],
    ['an Infinity w', { w: Infinity }],
    ['a negative w', { w: -1 }],
    ['a zero w', { w: 0 }],
    ['a NaN h', { h: Number.NaN }],
    ['an Infinity h', { h: -Infinity }],
    ['a negative h', { h: -1 }],
    ['a zero h', { h: 0 }],
    ['a missing createdAt', { createdAt: undefined }],
    ['a numeric createdAt', { createdAt: 1700000000000 }],
  ])('rejects a record with %s', (_label, change) => {
    expect(isImageRecord({ ...valid, ...change })).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [valid]],
    ['a string', 'image'],
    ['a number', 5],
    ['an empty object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isImageRecord(value)).toBe(false);
  });
});

describe('IMAGE_URL', () => {
  it('matches only our own image path', () => {
    expect(IMAGE_URL.test(valid.url)).toBe(true);
    expect(IMAGE_URL.test(`https://evil.example${valid.url}`)).toBe(false);
  });
});

describe('readImages', () => {
  it('returns valid records in order and skips everything else', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<unknown>('images');
    const second = { ...valid, id: OTHER, url: `/api/images/${OTHER}.png` };
    arr.push([valid, { kind: 'hologram', future: true }, { ...valid, w: 0 }, 'junk', null, second]);
    expect(readImages(arr)).toEqual([valid, second]);
  });

  it('returns an empty list for an empty array', () => {
    expect(readImages(new Y.Doc().getArray<unknown>('images'))).toEqual([]);
  });
});

describe('bounds on hostile records', () => {
  it.each([
    ['huge width', { w: 1e300 }],
    ['tiny height', { h: 1e-300 }],
    ['width past the cap', { w: 10_001 }],
    ['x far away', { x: 1e9 }],
    ['negative y past the cap', { y: -10_001 }],
    ['a long createdAt', { createdAt: 'x'.repeat(41) }],
  ])('rejects %s', (_label, change) => {
    expect(isImageRecord({ ...valid, ...change })).toBe(false);
  });
});

describe('latestImage', () => {
  const doc = () => new Y.Doc().getArray<unknown>('images');
  const rec = (n: number) => ({ ...valid, id: `${'0'.repeat(7)}${n}-0000-4000-8000-000000000000`, url: `/api/images/${'0'.repeat(7)}${n}-0000-4000-8000-000000000000.png` });

  it('returns the newest valid record, skipping junk after it', () => {
    const images = doc();
    images.push([rec(1), rec(2), { kind: 'other' }, 'junk']);
    expect(latestImage(images)?.id).toBe(rec(2).id);
  });

  it('skips ids that failed to load, falling back to the one before', () => {
    const images = doc();
    images.push([rec(1), rec(2)]);
    expect(latestImage(images, new Set([rec(2).id]))?.id).toBe(rec(1).id);
  });

  it(`only looks at the last ${LATEST_SCAN} entries, so a flood can't make it slow`, () => {
    const images = doc();
    images.push([rec(1)]);
    images.push(Array.from({ length: 100_000 }, () => 'junk'));
    const started = performance.now();
    expect(latestImage(images)).toBeNull(); // the real one is too far back: no picture rather than a freeze
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('returns null for an empty array', () => {
    expect(latestImage(doc())).toBeNull();
  });
});
