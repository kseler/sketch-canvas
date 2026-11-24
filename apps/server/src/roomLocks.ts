// One generation at a time per room: while one runs, a second request for the same room is refused.
// Kept in memory: a restart frees every room, which is fine because it also ends every running job.
// A lock is held only as long as the request runs, so the timeouts on the paid calls (chunk 3)
// are what stop a hung call from blocking a room for good.

export type RoomLocks = ReturnType<typeof createRoomLocks>;

export function createRoomLocks() {
  const busy = new Map<string, symbol>();

  return {
    // Takes the room's lock and returns a function that gives it back, or null if the room is
    // busy. Synchronous, like the budget reserve: no await between the check and the take.
    tryAcquire(roomId: string): (() => void) | null {
      if (busy.has(roomId)) return null;
      const token = Symbol(roomId);
      busy.set(roomId, token);
      // Only frees the lock it took: calling it twice, or after someone else took the room,
      // does nothing.
      return () => {
        if (busy.get(roomId) === token) busy.delete(roomId);
      };
    },

    isBusy(roomId: string): boolean {
      return busy.has(roomId);
    },
  };
}
