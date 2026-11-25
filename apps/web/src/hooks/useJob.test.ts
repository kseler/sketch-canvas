// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { JOB_KEY, JOB_MAP } from '../lib/jobs';
import { useJob } from './useJob';

// A real Yjs map (no fake needed): the hook only uses get/observe/unobserve.
const newMap = () => new Y.Doc().getMap<unknown>(JOB_MAP);
const running = { kind: 'job', id: 'job-1', status: 'running' };

afterEach(cleanup);

describe('useJob', () => {
  it('starts with the job already in the map (a tab that joins mid-generation)', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result } = renderHook(() => useJob(map));
    expect(result.current).toEqual({ id: 'job-1', status: 'running' });
  });

  it('is null for a room that has no job yet', () => {
    const { result } = renderHook(() => useJob(newMap()));
    expect(result.current).toBeNull();
  });

  it('is null when there is no map yet', () => {
    const { result } = renderHook(() => useJob(undefined));
    expect(result.current).toBeNull();
  });

  it('follows the server: a new job, then a new status', () => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    act(() => map.set(JOB_KEY, running));
    expect(result.current).toEqual({ id: 'job-1', status: 'running' });
    act(() => map.set(JOB_KEY, { kind: 'job', id: 'job-1', status: 'failed', error: 'Boom' }));
    expect(result.current).toEqual({ id: 'job-1', status: 'failed', error: 'Boom' });
    act(() => map.set(JOB_KEY, { kind: 'job', id: 'job-2', status: 'running' }));
    expect(result.current).toEqual({ id: 'job-2', status: 'running' });
  });

  it('goes back to null when the job is deleted (server restart)', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result } = renderHook(() => useJob(map));
    act(() => map.delete(JOB_KEY));
    expect(result.current).toBeNull();
  });

  it.each([
    ['a string', 'running'],
    ['a record of an unknown status', { kind: 'job', id: 'job-1', status: 'exploded' }],
    ['a record without the job kind', { id: 'job-1', status: 'running' }],
    ['a record with an empty id', { kind: 'job', id: '', status: 'running' }],
  ])('reads %s as no job instead of crashing', (_label, value) => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    act(() => map.set(JOB_KEY, running));
    act(() => map.set(JOB_KEY, value));
    expect(result.current).toBeNull();
  });

  it('stops listening to the old map when the room changes, and follows the new one', () => {
    const oldMap = newMap();
    const newRoom = newMap();
    const unobserve = vi.spyOn(oldMap, 'unobserve');
    oldMap.set(JOB_KEY, running);
    newRoom.set(JOB_KEY, { kind: 'job', id: 'job-9', status: 'queued' });

    const { result, rerender } = renderHook(({ map }) => useJob(map), { initialProps: { map: oldMap } });
    expect(result.current?.id).toBe('job-1');

    rerender({ map: newRoom });
    expect(unobserve).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ id: 'job-9', status: 'queued' });

    // A late write in the old room must not leak into the new room's view.
    act(() => oldMap.set(JOB_KEY, { kind: 'job', id: 'job-x', status: 'running' }));
    expect(result.current?.id).toBe('job-9');
  });

  it('is null after the map goes away, and stops listening on unmount', () => {
    const map = newMap();
    const unobserve = vi.spyOn(map, 'unobserve');
    map.set(JOB_KEY, running);
    const { result, rerender, unmount } = renderHook(({ m }: { m: Y.Map<unknown> | undefined }) => useJob(m), {
      initialProps: { m: map as Y.Map<unknown> | undefined },
    });
    rerender({ m: undefined });
    expect(result.current).toBeNull();
    expect(unobserve).toHaveBeenCalledTimes(1);

    rerender({ m: map });
    unmount();
    expect(unobserve).toHaveBeenCalledTimes(2);
  });
});
