// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_STORAGE_KEY as KEY, isIdentity, MAX_NAME_LENGTH } from '../lib/identity';
import { useIdentity } from './useIdentity';

const saved = { id: 'aaaa-1111', name: 'Blue Fox', color: '#e76f51' };
const stored = () => JSON.parse(localStorage.getItem(KEY)!);

// Another tab writes the identity, then the browser fires `storage` in this tab.
function otherTabWrites(value: unknown) {
  const newValue = JSON.stringify(value);
  localStorage.setItem(KEY, newValue);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue, storageArea: localStorage }));
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
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'x', storageArea: localStorage }));
    });
    expect(result.current[0]).toBe(before);
  });

  // Found by the reviewer: making a new identity here split one browser into two people (the
  // clearing tab gets no event and keeps the old one). Putting ours back keeps all tabs together.
  it('puts its identity back when another tab clears storage (key null)', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    const before = result.current[0];
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    });
    expect(result.current[0]).toBe(before);
    expect(stored()).toEqual(saved);
  });

  it('keeps its identity and restores storage when another tab writes garbage', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    otherTabWrites({ name: 42, color: 'url(http://evil.test/x)' });
    expect(result.current[0]).toEqual(saved);
    expect(stored()).toEqual(saved);
  });

  it('puts its identity back and keeps it when another tab removes the key', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    const before = result.current[0];
    localStorage.removeItem(KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null, storageArea: localStorage }));
    });
    expect(stored()).toEqual(saved);
    expect(result.current[0]).toBe(before);
  });

  it('rename keeps the id another tab saved a moment ago, with the new name', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    // Another tab changed the id; this tab has not got the event yet.
    localStorage.setItem(KEY, JSON.stringify({ ...saved, id: 'cccc-3333' }));
    act(() => result.current[1]('New Name'));
    const expected = { ...saved, id: 'cccc-3333', name: 'New Name' };
    expect(stored()).toEqual(expected);
    expect(result.current[0]).toEqual(expected);
  });

  it('two tabs: a rename in one reaches the other, and both keep the same id', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const a = renderHook(() => useIdentity());
    const b = renderHook(() => useIdentity());
    act(() => a.result.current[1]('Name From A'));
    // The browser tells B (not A) about the change.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY), storageArea: localStorage }),
      );
    });
    expect(b.result.current[0].name).toBe('Name From A');
    expect(a.result.current[0]).toEqual(b.result.current[0]);
    expect(a.result.current[0].id).toBe(saved.id);
    expect(stored()).toEqual(a.result.current[0]);
  });

  it('keeps the same identity object when a storage event changes nothing', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    const before = result.current[0];
    otherTabWrites({ ...saved });
    expect(result.current[0]).toBe(before);
  });

  it('ignores an event from sessionStorage', () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { result } = renderHook(() => useIdentity());
    const before = result.current[0];
    localStorage.setItem(KEY, JSON.stringify({ ...saved, name: 'Changed' })); // would show if it re-read
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'x', storageArea: sessionStorage }));
    });
    expect(result.current[0]).toBe(before);
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
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{}', storageArea: localStorage }));
    expect(getItem).not.toHaveBeenCalled();
  });
});
