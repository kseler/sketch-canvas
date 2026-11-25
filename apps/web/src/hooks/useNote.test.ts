// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { JOB_KEY, JOB_MAP } from '../lib/jobs';
import { useJob } from './useJob';
import { useNote } from './useNote';

// A room as App sees it: an object per join, with the room's job map. The real hook pair, so the
// test sees the same job views App does.
type FakeRoom = { name: string; job: Y.Map<unknown> };
const join = (name: string): FakeRoom => ({ name, job: new Y.Doc().getMap<unknown>(JOB_MAP) });
const setJob = (room: FakeRoom, value: unknown) =>
  act(() => {
    room.job.set(JOB_KEY, value);
  });
const clearJob = (room: FakeRoom) =>
  act(() => {
    room.job.delete(JOB_KEY);
  });

function render(initial: FakeRoom | null) {
  return renderHook(
    ({ room }: { room: FakeRoom | null }) => {
      const view = useJob(room?.job);
      return useNote(room, view);
    },
    { initialProps: { room: initial } },
  );
}

afterEach(cleanup);

describe('useNote', () => {
  it('shows a message written in this room while the job stays the same', () => {
    const room = join('a');
    const { result } = render(room);
    act(() => result.current.writeNote(room, 'Draw something first.'));
    expect(result.current.note).toBe('Draw something first.');
  });

  it('steps aside when a job starts, and does not come back when it ends or a restart clears it', () => {
    const room = join('a');
    const { result } = render(room);
    act(() => result.current.writeNote(room, 'Sending the sketch...'));
    setJob(room, { kind: 'job', id: 'j1', status: 'running' });
    expect(result.current.note).toBe('');
    setJob(room, { kind: 'job', id: 'j1', status: 'done', picture: true });
    expect(result.current.note).toBe('');
    clearJob(room); // a server restart: no job again, like when the message was written
    expect(result.current.note).toBe('');
  });

  it('shows an error that arrives after another tab’s job ended mid-request', () => {
    // The click happened while no job ran; meanwhile a peer's job started and ended; then our
    // request failed. The error belongs to the job as it is now, so it must show.
    const room = join('a');
    const { result } = render(room);
    act(() => result.current.writeNote(room, 'Sending the sketch...'));
    setJob(room, { kind: 'job', id: 'peer', status: 'running' });
    setJob(room, { kind: 'job', id: 'peer', status: 'failed', error: 'x' });
    act(() => result.current.writeNote(room, 'Could not reach the server.'));
    expect(result.current.note).toBe('Could not reach the server.');
  });

  it('does not show a message from another room, or from an earlier visit to this one', () => {
    const first = join('a');
    const { result, rerender } = render(first);
    act(() => result.current.writeNote(first, 'Draw something first.'));
    rerender({ room: join('b') });
    expect(result.current.note).toBe('');
    rerender({ room: join('a') }); // back to room a: a new join, a new room object
    expect(result.current.note).toBe('');
  });

  it('does not show a message written for a room the tab already left', () => {
    const left = join('a');
    const { result, rerender } = render(left);
    const now = join('b');
    rerender({ room: now });
    act(() => result.current.writeNote(left, 'Could not reach the server.')); // a late reply for room a
    expect(result.current.note).toBe('');
  });

  it('shows nothing while connecting (no room yet)', () => {
    const { result } = render(null);
    expect(result.current.note).toBe('');
  });

  it('clears the message when it is replaced by an empty one (the job started)', () => {
    const room = join('a');
    const { result } = render(room);
    act(() => result.current.writeNote(room, 'Sending the sketch...'));
    act(() => result.current.writeNote(room, ''));
    expect(result.current.note).toBe('');
  });
});
