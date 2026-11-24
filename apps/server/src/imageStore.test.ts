import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImageStore, IMAGE_FILE_NAME, IMAGE_URL_PREFIX } from './imageStore';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'image-store-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BYTES = new Uint8Array([1, 2, 3, 250]);
const V4 = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('createImageStore save', () => {
  it('writes <uuid>.png in the directory and returns the id and its url', async () => {
    const saved = await createImageStore(dir).save(BYTES);
    expect(saved.url).toBe(`${IMAGE_URL_PREFIX}${saved.id}.png`);
    expect(`${saved.id}.png`).toMatch(IMAGE_FILE_NAME);
    expect(await readdir(dir)).toEqual([`${saved.id}.png`]);
    expect(new Uint8Array(await readFile(path.join(dir, `${saved.id}.png`)))).toEqual(BYTES);
  });

  it('creates the directory when it does not exist yet', async () => {
    const nested = path.join(dir, 'a', 'b');
    const saved = await createImageStore(nested).save(BYTES);
    expect(await readdir(nested)).toEqual([`${saved.id}.png`]);
  });

  it('gives two saves different ids and keeps both files', async () => {
    const store = createImageStore(dir);
    const a = await store.save(BYTES);
    const b = await store.save(new Uint8Array([9]));
    expect(a.id).not.toBe(b.id);
    expect(await readdir(dir)).toHaveLength(2);
  });
});

describe('createImageStore read', () => {
  it('returns the bytes of a saved picture', async () => {
    const store = createImageStore(dir);
    const { id } = await store.save(BYTES);
    expect(new Uint8Array((await store.read(`${id}.png`))!)).toEqual(BYTES);
  });

  it('returns null for a well-formed name that does not exist', async () => {
    expect(await createImageStore(dir).read(`${V4}.png`)).toBeNull();
  });

  it.each([
    ['a path going up', '../x.png'],
    ['a path going up from a real-looking name', `../${V4}.png`],
    ['a name that is not a uuid', 'x.png'],
    ['only the extension', '.png'],
    ['an empty name', ''],
    ['an uppercase uuid', `${V4.toUpperCase()}.png`],
    ['a path with a slash', `sub/${V4}.png`],
    ['an absolute path', `/etc/${V4}.png`],
    ['a backslash path', `..\\${V4}.png`],
    ['a uuid v1 (version digit is not 4)', '3f2b8c1e-9a4d-1e6f-8b7a-1c2d3e4f5a6b.png'],
    ['a bad variant digit', '3f2b8c1e-9a4d-4e6f-0b7a-1c2d3e4f5a6b.png'],
    ['an extra suffix', `${V4}.png.txt`],
    ['another extension', `${V4}.jpg`],
    ['a trailing newline', `${V4}.png\n`],
    ['a null byte', `${V4}.png\0`],
  ])('refuses %s', async (_label, name) => {
    // A decoy named x.png would be returned if the check were skipped.
    await writeFile(path.join(dir, 'x.png'), 'secret');
    expect(await createImageStore(dir).read(name)).toBeNull();
  });

  it('does not read a file outside the directory through ..', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'image-store-parent-'));
    try {
      const inner = path.join(parent, 'inner');
      await writeFile(path.join(parent, 'x.png'), 'secret');
      expect(await createImageStore(inner).read('../x.png')).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('never overwrites a stored picture', () => {
  it('refuses to save over an existing file with the same id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const store = createImageStore(dir, () => id);
    await store.save(new Uint8Array([1, 2, 3]));
    await expect(store.save(new Uint8Array([9, 9, 9]))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(Array.from((await store.read(`${id}.png`)) ?? [])).toEqual([1, 2, 3]);
  });
});

describe('no half-written leftovers', () => {
  it('leaves no .partial file after a successful save', async () => {
    const store = createImageStore(dir);
    await store.save(new Uint8Array([1, 2, 3]));
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).filter((name) => name.endsWith('.partial'))).toEqual([]);
  });

  it('cleans up and keeps the real error when the final name already exists', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const store = createImageStore(dir, () => id);
    await store.save(new Uint8Array([1]));
    await expect(store.save(new Uint8Array([2]))).rejects.toMatchObject({ code: 'EEXIST' });
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).filter((name) => name.endsWith('.partial'))).toEqual([]);
  });
});
