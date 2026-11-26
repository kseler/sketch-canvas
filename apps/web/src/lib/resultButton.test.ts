import { describe, expect, it } from 'vitest';
import type { Job } from './jobs';
import { resultButton, viewedAfterLooking } from './resultButton';

const running: Job = { id: 'j1', status: 'running' };
const done: Job = { id: 'j1', status: 'done', brief: null, picture: true };
const failed: Job = { id: 'j1', status: 'failed', error: 'Busy.' };
const saw = new Set(['j1']);
const base = { job: null, seen: new Set<string>(), hasPicture: false, panelOpen: false, viewedJob: null };

describe('resultButton', () => {
  it('is hidden in a room with no job and no picture', () => {
    expect(resultButton(base)).toEqual({ shown: false, busy: false, unseen: false });
  });

  it('shows and spins while a job runs, for everyone in the room', () => {
    expect(resultButton({ ...base, job: running })).toEqual({ shown: true, busy: true, unseen: false });
  });

  it('shows once the room has a picture, even one made before this tab joined, without a dot', () => {
    expect(resultButton({ ...base, hasPicture: true })).toEqual({ shown: true, busy: false, unseen: false });
    expect(resultButton({ ...base, hasPicture: true, job: done })).toMatchObject({ shown: true, unseen: false });
  });

  it('gets a dot when a job this tab saw ends while the panel is closed', () => {
    expect(resultButton({ ...base, job: done, seen: saw, hasPicture: true })).toMatchObject({ unseen: true });
    expect(resultButton({ ...base, job: failed, seen: saw })).toEqual({ shown: true, busy: false, unseen: true });
  });

  it('has no dot while the panel is open, or once this job was viewed', () => {
    expect(resultButton({ ...base, job: done, seen: saw, panelOpen: true })).toMatchObject({ unseen: false });
    expect(resultButton({ ...base, job: done, seen: saw, viewedJob: 'j1' })).toMatchObject({ unseen: false });
  });

  it('gets a dot again for the next job', () => {
    const next: Job = { id: 'j2', status: 'done', brief: null, picture: true };
    expect(resultButton({ ...base, job: next, seen: new Set(['j1', 'j2']), viewedJob: 'j1' })).toMatchObject({ unseen: true });
  });
});

describe('viewedAfterLooking', () => {
  it('keeps the previous value while the job still runs, so closing early leaves the dot for later', () => {
    expect(viewedAfterLooking(running, null)).toBeNull();
    expect(viewedAfterLooking(running, 'j0')).toBe('j0');
  });

  it('records a job that has ended', () => {
    expect(viewedAfterLooking(done, null)).toBe('j1');
    expect(viewedAfterLooking(failed, 'j0')).toBe('j1');
  });

  it('keeps the previous value when there is no job', () => {
    expect(viewedAfterLooking(null, 'j0')).toBe('j0');
  });

  it('end to end: open on Generate, close while running, the job ends → dot', () => {
    let viewed = viewedAfterLooking(running, null); // auto-open on Generate
    viewed = viewedAfterLooking(running, viewed); // closed before it finished
    expect(resultButton({ ...base, job: done, seen: saw, hasPicture: true, viewedJob: viewed })).toMatchObject({ unseen: true });
  });
});
