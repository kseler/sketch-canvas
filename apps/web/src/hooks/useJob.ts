import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { JOB_KEY, readJob, type Job } from '../lib/jobs';

// The room's job, kept up to date as the server writes it. Null when there is none (a new room, or
// after a server restart) or when the record isn't one we can read.
export function useJob(map: Y.Map<unknown> | undefined): Job | null {
  const [job, setJob] = useState<Job | null>(() => (map ? readJob(map.get(JOB_KEY)) : null));

  useEffect(() => {
    if (!map) {
      setJob(null);
      return;
    }
    const sync = () => setJob(readJob(map.get(JOB_KEY)));
    map.observe(sync);
    sync();
    return () => map.unobserve(sync);
  }, [map]);

  return job;
}
