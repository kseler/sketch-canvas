import { isActive, type Job } from './jobs';

// What "viewed" becomes when the panel is opened or closed: the job, but only once it has ended.
// Closing the panel while your job still runs must not count as having seen its result, or the dot
// would never appear when it finishes.
export function viewedAfterLooking(job: Job | null, previous: string | null): string | null {
  return job !== null && !isActive(job) ? job.id : previous;
}

// When the top bar's Result button shows, spins, and carries a dot.
// - Shown while the room's job runs, once the room has a picture, or after a job this tab saw
//   (or started) ended, so its picture or its error can be opened.
// - Busy (spinner) while the job runs.
// - Unseen (dot) when a job this tab saw ended and the panel wasn't opened since: someone else's
//   picture arrived while you were drawing. The panel opens by itself only for whoever clicked.
export function resultButton(input: {
  job: Job | null;
  seen: Pick<ReadonlySet<string>, 'has'>;
  hasPicture: boolean;
  panelOpen: boolean;
  // The last ended job seen in the panel (viewedAfterLooking).
  viewedJob: string | null;
}): { shown: boolean; busy: boolean; unseen: boolean } {
  const { job, seen, hasPicture, panelOpen, viewedJob } = input;
  const busy = isActive(job);
  const endedHere = job !== null && !busy && seen.has(job.id);
  return {
    shown: busy || hasPicture || endedHere,
    busy,
    unseen: endedHere && !panelOpen && viewedJob !== job.id,
  };
}
