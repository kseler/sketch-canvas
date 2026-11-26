import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isActive, JOB_KEY, JOB_MAP, jobText, readJob, rememberJob, SEEN_JOBS_MAX, type Job } from './jobs';

const brief = { subject: 'a cat', style: 'flat', mood: 'calm', palette: ['#000000'], composition: 'centered', lettering: '' };
const base = { kind: 'job', id: 'job-1', startedAt: '2026-11-25T10:00:00.000Z' };

describe('readJob', () => {
  it('reads a running job', () => {
    expect(readJob({ ...base, status: 'running' })).toEqual({ id: 'job-1', status: 'running' });
  });

  it('reads a queued job', () => {
    expect(readJob({ ...base, status: 'queued' })).toEqual({ id: 'job-1', status: 'queued' });
  });

  it('reads a done job with its brief and picture flag', () => {
    expect(readJob({ ...base, status: 'done', brief, picture: true })).toEqual({ id: 'job-1', status: 'done', brief, picture: true });
  });

  it('reads picture as true only when it is exactly true', () => {
    expect(readJob({ ...base, status: 'done', brief, picture: 'yes' })).toMatchObject({ picture: false });
    expect(readJob({ ...base, status: 'done', brief })).toMatchObject({ picture: false });
  });

  it('keeps a done job whose brief is unreadable, without the brief', () => {
    expect(readJob({ ...base, status: 'done', brief: { subject: 5 }, picture: true })).toEqual({ id: 'job-1', status: 'done', brief: null, picture: true });
  });

  it('reads a failed job with its message', () => {
    expect(readJob({ ...base, status: 'failed', error: 'The AI took too long. Try again.' })).toEqual({
      id: 'job-1',
      status: 'failed',
      error: 'The AI took too long. Try again.',
    });
  });

  it('cleans and caps a failed job’s message, and falls back when there is none', () => {
    expect(readJob({ ...base, status: 'failed', error: 'bad\u202Etext\nhere' })).toMatchObject({ error: 'badtext here' });
    expect(readJob({ ...base, status: 'failed', error: 'x'.repeat(500) })).toMatchObject({ error: 'x'.repeat(200) });
    expect(readJob({ ...base, status: 'failed', error: 5 })).toMatchObject({ error: 'Generate failed.' });
    expect(readJob({ ...base, status: 'failed' })).toMatchObject({ error: 'Generate failed.' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'running'],
    ['an array', [base]],
    ['another kind', { ...base, kind: 'image', status: 'running' }],
    ['no kind', { id: 'job-1', status: 'running' }],
    ['an unknown status', { ...base, status: 'paused' }],
    ['no status', base],
    ['a numeric id', { ...base, id: 5, status: 'running' }],
    ['an empty id', { ...base, id: '', status: 'running' }],
    ['an id over 64 characters', { ...base, id: 'x'.repeat(65), status: 'running' }],
  ])('is null for %s', (_label, value) => {
    expect(readJob(value)).toBeNull();
  });

  it('reads the record the way the server stores it in the room document', () => {
    const doc = new Y.Doc();
    doc.getMap(JOB_MAP).set(JOB_KEY, { ...base, status: 'running' });
    expect(readJob(doc.getMap(JOB_MAP).get(JOB_KEY))).toEqual({ id: 'job-1', status: 'running' });
    expect([JOB_MAP, JOB_KEY]).toEqual(['generation', 'job']); // the names in apps/server/src/roomJobs.ts
  });
});

describe('isActive', () => {
  it.each([
    [null, false],
    [{ id: 'a', status: 'queued' }, true],
    [{ id: 'a', status: 'running' }, true],
    [{ id: 'a', status: 'done', brief: null, picture: true }, false],
    [{ id: 'a', status: 'failed', error: 'x' }, false],
  ] as Array<[Job | null, boolean]>)('%j → %s', (job, active) => {
    expect(isActive(job)).toBe(active);
  });
});

describe('jobText', () => {
  const seen = new Set(['job-1']);
  const done = (picture: boolean, b: typeof brief | null = brief): Job => ({ id: 'job-1', status: 'done', brief: b, picture });

  it('is empty when there is no job', () => {
    expect(jobText(null, seen)).toBe('');
  });

  it('says Generating... to everyone while it runs, seen or not', () => {
    expect(jobText({ id: 'job-2', status: 'running' }, new Set())).toBe('Generating...');
    expect(jobText({ id: 'job-2', status: 'queued' }, new Set())).toBe('Generating...');
  });

  it('shows the error of a failed job this tab saw', () => {
    expect(jobText({ id: 'job-1', status: 'failed', error: 'Busy.' }, seen)).toBe('Busy.');
  });

  it('shows nothing for a finished picture: the picture says it', () => {
    expect(jobText(done(true), seen)).toBe('');
    expect(jobText(done(true, null), seen)).toBe('');
  });

  it('says so when the server stopped after the brief (no image key)', () => {
    expect(jobText(done(false), seen)).toBe('This server makes no pictures yet (no image key).');
  });

  it('shows nothing for how an older job ended, to a tab that did not see it run', () => {
    expect(jobText({ id: 'job-9', status: 'failed', error: 'Busy.' }, seen)).toBe('');
    expect(jobText({ ...done(true), id: 'job-9' }, seen)).toBe('');
  });
});

describe('rememberJob', () => {
  it('remembers ids, keeping at most the newest SEEN_JOBS_MAX', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 100_000; n += 1) rememberJob(seen, `fake-${n}`);
    expect(seen.size).toBe(SEEN_JOBS_MAX);
    expect(seen.has('fake-99999')).toBe(true);
    expect(seen.has(`fake-${99_999 - SEEN_JOBS_MAX}`)).toBe(false);
  });

  it('keeps a job seen again as one of the newest', () => {
    const seen = new Set<string>(['mine']);
    for (let n = 0; n < SEEN_JOBS_MAX - 1; n += 1) rememberJob(seen, `x-${n}`);
    rememberJob(seen, 'mine'); // seen running again: moves to the newest end
    rememberJob(seen, 'one-more');
    expect(seen.has('mine')).toBe(true);
    expect(seen.size).toBe(SEEN_JOBS_MAX);
  });
});
