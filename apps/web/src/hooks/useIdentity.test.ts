// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_STORAGE_KEY as KEY, isIdentity, isPersonId, MAX_NAME_LENGTH } from '../lib/identity';
import { useIdentity } from './useIdentity';

const saved = { id: 'aaaa-1111', name: 'Blue Fox', color: '#e76f51' };
const stored = () => JSON.parse(localStorage.getItem(KEY)!);

// Another tab writes the identity, then the browser fires `storage` in this tab.
function otherTabWrites(value: unknown) {
  const newValue = JSON.stringify(value);
  localStorage.setItem(KEY, newValue);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue }));
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useIdentity', () => {
  it('starts with the identity from storage', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    expect(result.current[0]).toEqual(saved);
  });

  it('creates and saves a valid identity when storage is empty', () => {
    const { result } = renderHook(() => useIdentity());
    expect(isIdentity(result.current[0])).toBe(true);
    expect(stored()).toEqual(result.current[0]);
  });

  it('rename cleans the name, updates state and saves, keeping id and color', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    act(() => result.current[1](`  ${'x'.repeat(MAX_NAME_LENGTH + 5)}  `));
    const expected = { ...saved, name: 'x'.repeat(MAX_NAME_LENGTH) };
    expect(result.current[0]).toEqual(expected);
    expect(stored()).toEqual(expected);
  });

  it('applies a second rename on top of the first', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    act(() => result.current[1]('One'));
    act(() => result.current[1]('Two'));
    expect(result.current[0].name).toBe('Two');
    expect(stored().name).toBe('Two');
  });

  it('takes over an identity renamed in another tab (storage event)', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    otherTabWrites({ ...saved, name: 'Renamed Elsewhere' });
    expect(result.current[0]).toEqual({ ...saved, name: 'Renamed Elsewhere' });
  });

  it('ignores a storage event for another key', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    const before = result.current[0];
    localStorage.setItem(KEY, JSON.stringify({ ...saved, name: 'Changed' })); // would show if it re-read
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'x' }));
    });
    expect(result.current[0]).toBe(before);
  });

  it('gives a fresh valid saved identity when storage is cleared (key null)', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(isIdentity(result.current[0])).toBe(true);
    expect(isPersonId(result.current[0].id)).toBe(true);
    expect(result.current[0].id).not.toBe(saved.id);
    expect(stored()).toEqual(result.current[0]);
  });

  it('falls back to a valid identity when another tab writes garbage', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    otherTabWrites({ name: 42, color: 'url(http://evil.test/x)' });
    expect(isIdentity(result.current[0])).toBe(true);
    expect(result.current[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('removes its storage listener on unmount', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdentity());
    const added = add.mock.calls.find(([type]) => type === 'storage');
    expect(added).toBeDefined();
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', added![1]);
  });

  it('stops reacting to storage events after unmount', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const { unmount } = renderHook(() => useIdentity());
    unmount();
    getItem.mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{}' }));
    expect(getItem).not.toHaveBeenCalled();
  });
});
