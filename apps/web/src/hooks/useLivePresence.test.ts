// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveStroke } from '../lib/strokes';
import type { Awareness } from '../sync/room';
import { SEND_EVERY_MS, useLivePresence } from './useLivePresence';


const user = { name: 'Blue Fox', color: '#e76f51' };
const stroke = (n: number): LiveStroke => ({ color: '#000000', width: 4, points: [n, n, n + 1, n + 1] });

function setup() {
  let state: Record<string, unknown> | null = { user };
  const setLocalState = vi.fn((s: Record<string, unknown> | null) => {
    state = s;
  });
  const awareness = { getLocalState: vi.fn(() => state), setLocalState } as unknown as Awareness;
  const hook = renderHook(() => useLivePresence(awareness));
  return { ...hook, setLocalState };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLivePresence', () => {
  it('sends nothing until the throttle time has passed', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 2 });
    vi.advanceTimersByTime(SEND_EVERY_MS - 1);
    expect(setLocalState).not.toHaveBeenCalled();
  });

  it('sends ONE message with the latest values for a burst within the window', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 1 });
    result.current.setDrawing(stroke(1));
    vi.advanceTimersByTime(10);
    result.current.setCursor({ x: 2, y: 2 });
    result.current.setCursor({ x: 3, y: 3 });
    result.current.setDrawing(stroke(3));
    vi.advanceTimersByTime(SEND_EVERY_MS);
    expect(setLocalState).toHaveBeenCalledTimes(1);
    expect(setLocalState).toHaveBeenCalledWith({ user, cursor: { x: 3, y: 3 }, drawing: stroke(3) });
  });

  it('starts a new message for the next burst after the timer fired', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 1 });
    vi.advanceTimersByTime(SEND_EVERY_MS);
    result.current.setCursor({ x: 9, y: 9 });
    result.current.setCursor({ x: 10, y: 10 });
    expect(setLocalState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SEND_EVERY_MS);
    expect(setLocalState).toHaveBeenCalledTimes(2);
    expect(setLocalState).toHaveBeenLastCalledWith({ user, cursor: { x: 10, y: 10 }, drawing: null });
  });

  it('sends a null cursor immediately and cancels the pending timer', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 1 });
    result.current.setCursor(null);
    expect(setLocalState).toHaveBeenCalledTimes(1);
    expect(setLocalState).toHaveBeenCalledWith({ user, cursor: null, drawing: null });
    vi.advanceTimersByTime(SEND_EVERY_MS * 4);
    expect(setLocalState).toHaveBeenCalledTimes(1);
  });

  it('sends a null drawing immediately (pen lifted) without losing the cursor', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 5, y: 5 });
    result.current.setDrawing(stroke(1));
    result.current.setDrawing(null);
    expect(setLocalState).toHaveBeenCalledTimes(1);
    expect(setLocalState).toHaveBeenCalledWith({ user, cursor: { x: 5, y: 5 }, drawing: null });
    vi.advanceTimersByTime(SEND_EVERY_MS * 4);
    expect(setLocalState).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh throttle window after an immediate send', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor(null);
    result.current.setCursor({ x: 4, y: 4 });
    vi.advanceTimersByTime(SEND_EVERY_MS);
    expect(setLocalState).toHaveBeenCalledTimes(2);
  });

  it('keeps other local state fields such as user', () => {
    const { result, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 1 });
    vi.advanceTimersByTime(SEND_EVERY_MS);
    expect(setLocalState.mock.calls[0]![0]).toMatchObject({ user });
  });

  it('does not send after unmount', () => {
    const { result, unmount, setLocalState } = setup();
    result.current.setCursor({ x: 1, y: 1 });
    unmount();
    vi.advanceTimersByTime(SEND_EVERY_MS * 4);
    expect(setLocalState).not.toHaveBeenCalled();
  });

  it('keeps the same functions between renders for the same awareness', () => {
    const { result, rerender } = setup();
    const first = result.current;
    act(() => rerender());
    expect(result.current).toBe(first);
  });
});
