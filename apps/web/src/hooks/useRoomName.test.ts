// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidRoomId } from '../lib/roomId';
import { goToNewRoom, useRoomName } from './useRoomName';

beforeEach(() => {
  history.replaceState(null, '', '#');
});
afterEach(() => {
  // Unmount first: a hook left mounted keeps its hashchange listener and would react to later tests.
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '#');
});

function changeHash(hash: string) {
  act(() => {
    location.hash = hash; // jsdom fires hashchange asynchronously
  });
}

const hashChanged = () => new Promise<void>((r) => window.addEventListener('hashchange', () => r(), { once: true }));

describe('useRoomName', () => {
  it('uses a valid hash as the room', () => {
    history.replaceState(null, '', '#my-room-1');
    const { result } = renderHook(() => useRoomName());
    expect(result.current).toBe('my-room-1');
    expect(location.hash).toBe('#my-room-1');
  });

  it('lowercases an uppercase hash and fixes the URL without a new history entry', () => {
    history.replaceState(null, '', '#AbC123');
    const lengthBefore = history.length;
    const pushSpy = vi.spyOn(history, 'pushState');
    const { result } = renderHook(() => useRoomName());
    expect(result.current).toBe('abc123');
    expect(location.hash).toBe('#abc123');
    expect(history.length).toBe(lengthBefore);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('fixes the URL with replaceState, not by assigning location.hash', () => {
    history.replaceState(null, '', '#ABC');
    const replace = vi.spyOn(history, 'replaceState');
    renderHook(() => useRoomName());
    expect(replace).toHaveBeenCalledWith(null, '', '#abc');
  });

  it.each([
    ['empty', ''],
    ['a path-like value', '#../etc/passwd'],
    ['a space', '#a%20b'],
    ['a too long id', `#${'a'.repeat(65)}`],
  ])('gives a fresh valid room for %s hash', (_label, hash) => {
    history.replaceState(null, '', hash || '#');
    const { result } = renderHook(() => useRoomName());
    expect(isValidRoomId(result.current)).toBe(true);
    expect(location.hash).toBe(`#${result.current}`);
  });

  it('switches rooms on hashchange', async () => {
    history.replaceState(null, '', '#room-one');
    const { result } = renderHook(() => useRoomName());
    const changed = hashChanged();
    changeHash('#room-two');
    await act(async () => {
      await changed;
    });
    expect(result.current).toBe('room-two');
  });

  it('removes the hashchange listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useRoomName());
    const added = add.mock.calls.find(([type]) => type === 'hashchange');
    expect(added).toBeDefined();
    unmount();
    expect(remove).toHaveBeenCalledWith('hashchange', added![1]);
  });
});

describe('goToNewRoom', () => {
  it('sets a new valid room id as the hash', () => {
    goToNewRoom();
    const room = location.hash.slice(1);
    expect(isValidRoomId(room)).toBe(true);
  });

  it('gives a different room each time', () => {
    goToNewRoom();
    const first = location.hash;
    goToNewRoom();
    expect(location.hash).not.toBe(first);
  });

  it('moves a mounted hook to the new room', async () => {
    history.replaceState(null, '', '#old-room');
    const { result } = renderHook(() => useRoomName());
    const changed = hashChanged();
    act(() => goToNewRoom());
    await act(async () => {
      await changed;
    });
    expect(result.current).not.toBe('old-room');
    expect(result.current).toBe(location.hash.slice(1));
  });
});
