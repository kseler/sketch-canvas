import { describe, expect, it } from 'vitest';
import { createRoomLocks } from './roomLocks';

describe('createRoomLocks', () => {
  it('gives a release function for a free room and null for a busy one', () => {
    const locks = createRoomLocks();
    expect(locks.tryAcquire('room-1')).toBeTypeOf('function');
    expect(locks.tryAcquire('room-1')).toBeNull();
  });

  it('reports a room as busy only while it is held', () => {
    const locks = createRoomLocks();
    expect(locks.isBusy('room-1')).toBe(false);
    const release = locks.tryAcquire('room-1');
    expect(locks.isBusy('room-1')).toBe(true);
    release?.();
    expect(locks.isBusy('room-1')).toBe(false);
  });

  it('keeps rooms independent', () => {
    const locks = createRoomLocks();
    const releaseA = locks.tryAcquire('room-a');
    expect(locks.tryAcquire('room-b')).toBeTypeOf('function');
    expect(locks.isBusy('room-b')).toBe(true);
    releaseA?.();
    expect(locks.isBusy('room-a')).toBe(false);
    expect(locks.isBusy('room-b')).toBe(true);
  });

  it('lets the room be taken again after release', () => {
    const locks = createRoomLocks();
    locks.tryAcquire('room-1')?.();
    expect(locks.tryAcquire('room-1')).toBeTypeOf('function');
  });

  it('does nothing harmful when a release is called twice', () => {
    const locks = createRoomLocks();
    const release = locks.tryAcquire('room-1');
    release?.();
    expect(() => release?.()).not.toThrow();
    expect(locks.isBusy('room-1')).toBe(false);
  });

  it('does not let an old release free the lock of the new holder', () => {
    const locks = createRoomLocks();
    const oldRelease = locks.tryAcquire('room-1');
    oldRelease?.();
    const newRelease = locks.tryAcquire('room-1');
    expect(newRelease).toBeTypeOf('function');

    oldRelease?.(); // stale: must not free the new holder's lock
    expect(locks.isBusy('room-1')).toBe(true);
    expect(locks.tryAcquire('room-1')).toBeNull();

    newRelease?.();
    expect(locks.isBusy('room-1')).toBe(false);
  });
});
