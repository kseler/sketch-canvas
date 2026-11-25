// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { JOB_KEY, JOB_MAP, SEEN_JOBS_MAX } from '../lib/jobs';
import { useJob } from './useJob';

// A real Yjs map (no fake needed): the hook only uses get/observe/unobserve.
const newMap = () => new Y.Doc().getMap<unknown>(JOB_MAP);
const running = { kind: 'job', id: 'job-1', status: 'running' };
// Writes like the server would, inside act so React sees the change.
const write = (map: Y.Map<unknown>, value: unknown) =>
  act(() => {
    map.set(JOB_KEY, value);
  });

afterEach(cleanup);

describe('useJob: the job', () => {
  it('starts with the job already in the map (a tab that joins mid-generation)', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result } = renderHook(() => useJob(map));
    expect(result.current.job).toEqual({ id: 'job-1', status: 'running' });
  });

  it('is null for a room that has no job yet', () => {
    const { result } = renderHook(() => useJob(newMap()));
    expect(result.current.job).toBeNull();
  });

  it('is null when there is no map yet', () => {
    const { result } = renderHook(() => useJob(undefined));
    expect(result.current.job).toBeNull();
  });

  it('follows the server: a new job, then a new status', () => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    write(map, running);
    expect(result.current.job).toEqual({ id: 'job-1', status: 'running' });
    write(map, { kind: 'job', id: 'job-1', status: 'failed', error: 'Boom' });
    expect(result.current.job).toEqual({ id: 'job-1', status: 'failed', error: 'Boom' });
    write(map, { kind: 'job', id: 'job-2', status: 'running' });
    expect(result.current.job).toEqual({ id: 'job-2', status: 'running' });
  });

  it('goes back to null when the job is deleted (server restart)', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result } = renderHook(() => useJob(map));
    act(() => {
      map.delete(JOB_KEY);
    });
    expect(result.current.job).toBeNull();
  });

  it.each([
    ['a string', 'running'],
    ['a record of an unknown status', { kind: 'job', id: 'job-1', status: 'exploded' }],
    ['a record without the job kind', { id: 'job-1', status: 'running' }],
    ['a record with an empty id', { kind: 'job', id: '', status: 'running' }],
  ])('reads %s as no job instead of crashing', (_label, value) => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    write(map, running);
    write(map, value);
    expect(result.current.job).toBeNull();
  });

  it('gives React the same view until the map changes (no render loop)', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result, rerender } = renderHook(() => useJob(map));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      map.set('unrelated', 1); // another key: the job itself didn't change
    });
    rerender();
    expect(result.current).toBe(first);
  });

  it('stops listening to the old map when the room changes, and follows the new one', () => {
    const oldMap = newMap();
    const newRoom = newMap();
    const unobserve = vi.spyOn(oldMap, 'unobserve');
    oldMap.set(JOB_KEY, running);
    newRoom.set(JOB_KEY, { kind: 'job', id: 'job-9', status: 'queued' });

    const { result, rerender } = renderHook(({ map }) => useJob(map), { initialProps: { map: oldMap } });
    expect(result.current.job?.id).toBe('job-1');

    rerender({ map: newRoom });
    expect(unobserve).toHaveBeenCalledTimes(1);
    expect(result.current.job).toEqual({ id: 'job-9', status: 'queued' });

    // A late write in the old room must not leak into the new room's view.
    write(oldMap, { kind: 'job', id: 'job-x', status: 'running' });
    expect(result.current.job?.id).toBe('job-9');
  });

  it('is null after the map goes away, and stops listening on unmount', () => {
    const map = newMap();
    const unobserve = vi.spyOn(map, 'unobserve');
    map.set(JOB_KEY, running);
    const initialProps: { m: Y.Map<unknown> | undefined } = { m: map };
    const { result, rerender, unmount } = renderHook(({ m }) => useJob(m), { initialProps });
    rerender({ m: undefined });
    expect(result.current.job).toBeNull();
    expect(unobserve).toHaveBeenCalledTimes(1);

    rerender({ m: map });
    unmount();
    expect(unobserve).toHaveBeenCalledTimes(2);
  });
});

describe('useJob: jobs this tab saw running', () => {
  it('remembers a job it saw running, still after it ended', () => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    write(map, running);
    write(map, { kind: 'job', id: 'job-1', status: 'failed', error: 'Busy.' });
    expect(result.current.seen.has('job-1')).toBe(true);
  });

  it('does not count a job it only ever saw finished (joined later)', () => {
    const map = newMap();
    map.set(JOB_KEY, { kind: 'job', id: 'job-1', status: 'done', brief: null, picture: true });
    const { result } = renderHook(() => useJob(map));
    expect(result.current.seen.has('job-1')).toBe(false);
  });

  it('counts a job that was already running when the tab joined', () => {
    const map = newMap();
    map.set(JOB_KEY, running);
    const { result } = renderHook(() => useJob(map));
    expect(result.current.seen.has('job-1')).toBe(true);
  });

  it(`keeps at most ${SEEN_JOBS_MAX} ids, however many fake jobs a peer flashes`, () => {
    const map = newMap();
    const { result } = renderHook(() => useJob(map));
    for (let n = 0; n < SEEN_JOBS_MAX * 3; n += 1) write(map, { kind: 'job', id: `fake-${n}`, status: 'running' });
    expect(result.current.seen.size).toBe(SEEN_JOBS_MAX);
  });

  it('starts fresh for another room', () => {
    const roomA = newMap();
    roomA.set(JOB_KEY, running);
    const { result, rerender } = renderHook(({ map }) => useJob(map), { initialProps: { map: roomA } });
    expect(result.current.seen.has('job-1')).toBe(true);
    rerender({ map: newMap() });
    expect(result.current.seen.size).toBe(0);
  });
});
