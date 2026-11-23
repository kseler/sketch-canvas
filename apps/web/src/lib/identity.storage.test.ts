// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHexColor } from './color';
import { IDENTITY_STORAGE_KEY as KEY, isIdentity, isPersonId, loadIdentity, MAX_NAME_LENGTH, readStoredIdentity, saveIdentity } from './identity';

const valid = { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', name: 'Blue Fox', color: '#e76f51' };

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function expectFreshSaved(result: ReturnType<typeof loadIdentity>) {
  expect(isIdentity(result)).toBe(true);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(result);
}

describe('loadIdentity', () => {
  it('loads a saved valid identity', () => {
    localStorage.setItem(KEY, JSON.stringify(valid));
    expect(loadIdentity()).toEqual(valid);
  });

  it('cleans the saved name (trimmed and cut to the maximum length)', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...valid, name: `  ${'x'.repeat(MAX_NAME_LENGTH + 10)}  ` }));
    expect(loadIdentity().name).toBe('x'.repeat(MAX_NAME_LENGTH));
  });

  it('keeps a saved person id', () => {
    localStorage.setItem(KEY, JSON.stringify(valid));
    expect(loadIdentity().id).toBe(valid.id);
    expect(JSON.parse(localStorage.getItem(KEY)!).id).toBe(valid.id);
  });

  it('gives an identity saved without an id a valid one, and saves it so the next load returns the same id', () => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'Blue Fox', color: '#e76f51' }));
    const first = loadIdentity();
    expect(isPersonId(first.id)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(first);
    expect(loadIdentity()).toEqual(first);
  });

  it('replaces a saved invalid id (hostile or corrupt) with a fresh saved identity', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...valid, id: 'tab:1' }));
    const result = loadIdentity();
    expect(isPersonId(result.id)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(result);
  });

  it('creates and saves a fresh identity when nothing is stored', () => {
    expectFreshSaved(loadIdentity());
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"Blue Fox"'],
    ['a missing color', JSON.stringify({ name: 'Blue Fox' })],
    ['a non-string name', JSON.stringify({ name: 42, color: '#e76f51' })],
    ['a blank name', JSON.stringify({ name: '   ', color: '#e76f51' })],
    ['a color that is not hex', JSON.stringify({ name: 'Blue Fox', color: 'red' })],
    ['CSS that would make the browser fetch a URL', JSON.stringify({ name: 'Blue Fox', color: 'url(http://evil.test/x)' })],
  ])('falls back to a fresh saved identity for %s', (_label, raw) => {
    localStorage.setItem(KEY, raw);
    const result = loadIdentity();
    expectFreshSaved(result);
    expect(isHexColor(result.color)).toBe(true);
  });

  it('returns a usable identity when reading storage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(isIdentity(loadIdentity())).toBe(true);
  });

  it('returns a usable identity when writing storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(isIdentity(loadIdentity())).toBe(true);
  });
});

describe('readStoredIdentity', () => {
  it('returns the saved identity', () => {
    localStorage.setItem(KEY, JSON.stringify(valid));
    expect(readStoredIdentity()).toEqual(valid);
  });

  it('returns a cleaned copy: trimmed, cut to the maximum length, extra fields dropped', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...valid, name: `  ${'x'.repeat(MAX_NAME_LENGTH + 10)}  `, extra: 1 }));
    expect(readStoredIdentity()).toEqual({ ...valid, name: 'x'.repeat(MAX_NAME_LENGTH) });
  });

  it.each([
    ['nothing saved', null],
    ['an empty string', ''],
    ['corrupt JSON', '{not json'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a saved identity without an id (incomplete)', JSON.stringify({ name: 'Blue Fox', color: '#e76f51' })],
    ['an invalid id', JSON.stringify({ ...valid, id: 'tab:1' })],
    ['a blank name', JSON.stringify({ ...valid, name: '   ' })],
    ['CSS that would make the browser fetch a URL', JSON.stringify({ ...valid, color: 'url(http://evil.test/x)' })],
  ])('returns null for %s', (_label, raw) => {
    if (raw !== null) localStorage.setItem(KEY, raw);
    expect(readStoredIdentity()).toBeNull();
  });

  it('returns null when reading storage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readStoredIdentity()).toBeNull();
  });

  it.each([
    ['nothing saved', null],
    ['garbage', '{not json'],
    ['an identity without an id', JSON.stringify({ name: 'Blue Fox', color: '#e76f51' })],
    ['a valid identity', JSON.stringify(valid)],
  ])('never writes to storage (%s)', (_label, raw) => {
    if (raw !== null) localStorage.setItem(KEY, raw);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    readStoredIdentity();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(raw);
  });
});

describe('saveIdentity', () => {
  it('stores the identity so loadIdentity returns it', () => {
    saveIdentity(valid);
    expect(loadIdentity()).toEqual(valid);
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => saveIdentity(valid)).not.toThrow();
  });
});
