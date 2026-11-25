import { useCallback, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { isActive, JOB_KEY, readJob, rememberJob, type Job } from '../lib/jobs';

// The room's job as this tab sees it: the current record, and the ids of jobs this tab saw running
// (at most SEEN_JOBS_MAX), so how a job ended is shown only to tabs that watched it run.
export type JobView = { job: Job | null; seen: ReadonlySet<string> };

const NO_JOB: JobView = { job: null, seen: new Set() };

// One cached view per room map. The Yjs map is the store; React reads it through
// useSyncExternalStore, which wants the same object back until something changed. Y.Map.get
// returns the same stored value until the server writes a new one, so that value is the cache key.
const views = new WeakMap<Y.Map<unknown>, { raw: unknown; view: JobView }>();

function viewOf(map: Y.Map<unknown>): JobView {
  const raw = map.get(JOB_KEY);
  const cached = views.get(map);
  if (cached && cached.raw === raw) return cached.view;
  const job = readJob(raw);
  const seen = new Set(cached?.view.seen);
  if (job && isActive(job)) rememberJob(seen, job.id);
  const view = { job, seen };
  views.set(map, { raw, view });
  return view;
}

// The room's job, kept up to date as the server writes it. `job` is null when there is none (a new
// room, or after a server restart) or when the record isn't one we can read.
export function useJob(map: Y.Map<unknown> | undefined): JobView {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!map) return () => {};
      // Yjs calls observers with (event, transaction); React's callback takes none.
      const observer = () => onChange();
      map.observe(observer);
      return () => map.unobserve(observer);
    },
    [map],
  );
  return useSyncExternalStore(subscribe, () => (map ? viewOf(map) : NO_JOB));
}
