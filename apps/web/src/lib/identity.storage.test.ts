// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHexColor } from './color';
import { IDENTITY_STORAGE_KEY as KEY, isIdentity, loadIdentity, MAX_NAME_LENGTH, saveIdentity } from './identity';

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
