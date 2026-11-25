import { randomUUID } from 'node:crypto';
import type * as Y from 'yjs';
import type { SketchBrief } from './brief';
import { SERVER_ORIGIN } from './roomImages';

// A generation is a job with an id and a status (CLAUDE.md instant-mode rule 7). The server writes
// the room's current job into the room's Yjs document, so every tab sees it: everyone gets the
// loading picture and a disabled Generate button while it runs, and everyone sees how it ended.
//
// 'queued' is not written yet: a room runs one job at a time and it starts at once. It stays in
// the type so a queue (or a newer job replacing an older one) can be added without a new format.
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

type JobBase = { kind: 'job'; id: string; startedAt: string };
export type JobRecord =
  | (JobBase & { status: 'queued' | 'running' })
  // `picture`: false when the server has no image key and stopped after the brief.
  | (JobBase & { status: 'done'; finishedAt: string; brief: SketchBrief; picture: boolean })
  // `error`: one of our own fixed messages (generate.ts), never text from a model or a provider.
  | (JobBase & { status: 'failed'; finishedAt: string; error: string });

export type JobOutcome = { status: 'done'; brief: SketchBrief; picture: boolean } | { status: 'failed'; error: string };

// One map per room, holding one key: the current (or last) job.
export const JOB_MAP = 'generation';
export const JOB_KEY = 'job';

const guarded = new WeakSet<Y.Doc>();
// What the server last wrote, per room document: what it puts back if a peer changes it.
const serverJob = new WeakMap<Y.Doc, JobRecord>();

// Only the server may write the job. Otherwise a hostile tab could set "running" for good and grey
// out everyone's Generate button, or show everyone a made-up error. Any change from a peer is
// undone at once by the server: its own record is put back, anything else is deleted.
// After a restart the server has no job, so a tab re-sending its old "running" record has it
// deleted: the restart really did end that job, and Generate comes back for everyone.
// Idempotent per document.
export function guardJob(doc: Y.Doc): void {
  if (guarded.has(doc)) return;
  guarded.add(doc);
  const map = doc.getMap<unknown>(JOB_MAP);
  map.observe((event, transaction) => {
    if (transaction.origin === SERVER_ORIGIN) return;
    const ours = serverJob.get(doc);
    doc.transact(() => {
      for (const key of event.keysChanged as Set<string>) {
        if (key === JOB_KEY && ours) map.set(JOB_KEY, { ...ours });
        else map.delete(key);
      }
    }, SERVER_ORIGIN);
  });
}

export type RoomJobs = {
  // Guards the room's job. Call before a tab's first update can arrive.
  open(roomId: string): void;
  // Writes a new running job and returns its id.
  start(roomId: string): string;
  // Writes how the job ended. Does nothing if another job has replaced it since.
  finish(roomId: string, jobId: string, outcome: JobOutcome): void;
};

// `getDoc` is y-websocket's getYDoc. `newId` and `now` are for tests.
export function createRoomJobs({
  getDoc,
  newId = randomUUID,
  now = () => new Date(),
}: {
  getDoc: (roomId: string) => Y.Doc;
  newId?: () => string;
  now?: () => Date;
}): RoomJobs {
  function write(doc: Y.Doc, record: JobRecord): void {
    serverJob.set(doc, record);
    doc.transact(() => doc.getMap<unknown>(JOB_MAP).set(JOB_KEY, { ...record }), SERVER_ORIGIN);
  }

  return {
    open(roomId) {
      guardJob(getDoc(roomId));
    },

    start(roomId) {
      const doc = getDoc(roomId);
      guardJob(doc);
      const id = newId();
      write(doc, { kind: 'job', id, status: 'running', startedAt: now().toISOString() });
      return id;
    },

    finish(roomId, jobId, outcome) {
      const doc = getDoc(roomId);
      const current = serverJob.get(doc);
      if (current?.id !== jobId) return;
      write(doc, { kind: 'job', id: jobId, startedAt: current.startedAt, finishedAt: now().toISOString(), ...outcome });
    },
  };
}
