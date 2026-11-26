import { asRecord, capChars, cleanText, readBrief, type Brief } from './brief';

// The room's current (or last) generation, written into the shared document by the server
// (apps/server/src/roomJobs.ts, which the web app can't import; the names below match it). Every
// tab reads it, so everyone sees "generating", and everyone sees how it ended.
export const JOB_MAP = 'generation';
export const JOB_KEY = 'job';

// 'queued' is not used by the server yet; it is shown like 'running'.
export type Job =
  | { id: string; status: 'queued' | 'running' }
  // `brief` is null if it didn't survive the checks below; the picture still arrives on its own.
  | { id: string; status: 'done'; brief: Brief | null; picture: boolean }
  | { id: string; status: 'failed'; error: string };

// Whether a job is still in progress (Generate stays off for everyone in the room).
export const isActive = (job: Job | null): boolean => job?.status === 'queued' || job?.status === 'running';

// The server guards this record (a peer's change is undone at once), but a hostile tab's write is
// still seen for a moment, and an older server could write anything. So: checked, cleaned and
// capped like any other text from the shared document, and anything unexpected reads as no job.
export function readJob(value: unknown): Job | null {
  const j = asRecord(value);
  if (j.kind !== 'job' || typeof j.id !== 'string' || j.id.length === 0 || j.id.length > 64) return null;
  const { id } = j;
  switch (j.status) {
    case 'queued':
    case 'running':
      return { id, status: j.status };
    case 'done':
      return { id, status: 'done', brief: readBrief(j.brief), picture: j.picture === true };
    case 'failed': {
      // Same cap as an error from the HTTP reply (generateClient.ts).
      const error = cleanText(j.error);
      return { id, status: 'failed', error: error ? capChars(error, 200) : 'Generate failed.' };
    }
    default:
      return null;
  }
}

// How many job ids a tab remembers having seen run. A hostile peer can flash a fake "running" job
// with a new id many times a second before the server undoes it; without a cap every tab would
// keep all those ids for as long as it stays in the room.
export const SEEN_JOBS_MAX = 50;

// Remembers that this tab saw a job run (or started it), forgetting the oldest past the cap.
export function rememberJob(seen: Set<string>, id: string): void {
  seen.delete(id); // re-adding moves it to the newest end
  seen.add(id);
  for (const old of seen) {
    if (seen.size <= SEEN_JOBS_MAX) break;
    seen.delete(old);
  }
}

// What the room's job says above the picture. A finished picture needs no words; how a job ended is
// shown only to tabs that saw it run (`seen`), so someone joining later isn't greeted by an old error.
// React shows it as text, never as HTML.
export function jobText(job: Job | null, seen: Pick<ReadonlySet<string>, 'has'>): string {
  if (!job) return '';
  if (isActive(job)) return 'Generating...';
  if (!seen.has(job.id)) return '';
  if (job.status === 'failed') return job.error;
  if (job.status !== 'done') return '';
  // No picture means the server has no image key and stopped after the brief.
  return job.picture ? '' : 'This server makes no pictures yet (no image key).';
}
