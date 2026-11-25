import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SketchBrief } from './brief';
import { createRoomJobs, guardJob, JOB_KEY, JOB_MAP, type JobRecord } from './roomJobs';

const BRIEF: SketchBrief = { subject: 'a cat', style: 'flat', mood: 'calm', palette: ['#000000'], composition: 'centered', lettering: '' };
const T0 = new Date('2026-11-25T10:00:00.000Z');
const T1 = new Date('2026-11-25T10:00:09.000Z');

function setup() {
  const docs = new Map<string, Y.Doc>();
  const getDoc = (roomId: string) => {
    const doc = docs.get(roomId) ?? new Y.Doc();
    docs.set(roomId, doc);
    return doc;
  };
  let n = 0;
  let clock = T0;
  const jobs = createRoomJobs({ getDoc, newId: () => `job-${++n}`, now: () => clock });
  const job = (roomId: string) => getDoc(roomId).getMap<unknown>(JOB_MAP).get(JOB_KEY) as JobRecord | undefined;
  return { jobs, getDoc, job, tick: () => (clock = T1) };
}

// A write from a peer: any transaction origin other than the server's.
const asPeer = (doc: Y.Doc, change: () => void) => doc.transact(change, 'peer');

describe('createRoomJobs', () => {
  it('starts a running job in the room and returns its id', () => {
    const s = setup();
    expect(s.jobs.start('room-1')).toBe('job-1');
    expect(s.job('room-1')).toEqual({ kind: 'job', id: 'job-1', status: 'running', startedAt: T0.toISOString() });
    expect(s.job('room-2')).toBeUndefined();
  });

  it('records a done job with the brief, whether there is a picture, and when it ended', () => {
    const s = setup();
    const id = s.jobs.start('room-1');
    s.tick();
    s.jobs.finish('room-1', id, { status: 'done', brief: BRIEF, picture: true });
    expect(s.job('room-1')).toEqual({
      kind: 'job',
      id,
      status: 'done',
      startedAt: T0.toISOString(),
      finishedAt: T1.toISOString(),
      brief: BRIEF,
      picture: true,
    });
  });

  it('records a failed job with its message', () => {
    const s = setup();
    const id = s.jobs.start('room-1');
    s.jobs.finish('room-1', id, { status: 'failed', error: 'The AI took too long. Try again.' });
    expect(s.job('room-1')).toMatchObject({ id, status: 'failed', error: 'The AI took too long. Try again.' });
  });

  it('ignores the end of a job that a newer one has replaced', () => {
    const s = setup();
    const old = s.jobs.start('room-1');
    const current = s.jobs.start('room-1');
    s.jobs.finish('room-1', old, { status: 'failed', error: 'late' });
    expect(s.job('room-1')).toMatchObject({ id: current, status: 'running' });
  });

  it('ignores the end of a job in a room that never had one', () => {
    const s = setup();
    s.jobs.finish('room-1', 'job-9', { status: 'failed', error: 'x' });
    expect(s.job('room-1')).toBeUndefined();
  });

  it('keeps rooms apart', () => {
    const s = setup();
    const a = s.jobs.start('room-1');
    s.jobs.start('room-2');
    s.jobs.finish('room-1', a, { status: 'done', brief: BRIEF, picture: false });
    expect(s.job('room-1')?.status).toBe('done');
    expect(s.job('room-2')?.status).toBe('running');
  });

  it('does not touch the strokes or the pictures', () => {
    const s = setup();
    const doc = s.getDoc('room-1');
    doc.getArray('strokes').push([{ id: 's' }]);
    doc.getArray('images').push([{ id: 'i' }]);
    s.jobs.finish('room-1', s.jobs.start('room-1'), { status: 'done', brief: BRIEF, picture: true });
    expect(doc.getArray('strokes').toJSON()).toEqual([{ id: 's' }]);
    expect(doc.getArray('images').toJSON()).toEqual([{ id: 'i' }]);
  });
});

describe('guardJob', () => {
  it("puts the server's job back when a peer overwrites it", () => {
    const s = setup();
    const id = s.jobs.start('room-1');
    const doc = s.getDoc('room-1');
    asPeer(doc, () => doc.getMap(JOB_MAP).set(JOB_KEY, { kind: 'job', id, status: 'failed', startedAt: 'x', finishedAt: 'x', error: 'Fake' }));
    expect(s.job('room-1')).toEqual({ kind: 'job', id, status: 'running', startedAt: T0.toISOString() });
  });

  it("puts the server's job back when a peer deletes it", () => {
    const s = setup();
    s.jobs.start('room-1');
    const doc = s.getDoc('room-1');
    asPeer(doc, () => doc.getMap(JOB_MAP).delete(JOB_KEY));
    expect(s.job('room-1')?.status).toBe('running');
  });

  it("puts back the server's latest job, not an earlier one", () => {
    const s = setup();
    const id = s.jobs.start('room-1');
    s.jobs.finish('room-1', id, { status: 'failed', error: 'Busy' });
    const doc = s.getDoc('room-1');
    asPeer(doc, () => doc.getMap(JOB_MAP).delete(JOB_KEY));
    expect(s.job('room-1')).toMatchObject({ id, status: 'failed', error: 'Busy' });
  });

  it('deletes a job a peer writes into a room where the server has none (also after a restart)', () => {
    const s = setup();
    s.jobs.open('room-1');
    const doc = s.getDoc('room-1');
    asPeer(doc, () => doc.getMap(JOB_MAP).set(JOB_KEY, { kind: 'job', id: 'old', status: 'running', startedAt: 'x' }));
    expect(s.job('room-1')).toBeUndefined();
  });

  it('deletes any other key a peer adds to the map', () => {
    const s = setup();
    s.jobs.start('room-1');
    const doc = s.getDoc('room-1');
    const map = doc.getMap(JOB_MAP);
    asPeer(doc, () => {
      map.set('extra', 'x');
      map.set('__proto__', 'y');
    });
    expect([...map.keys()]).toEqual([JOB_KEY]);
  });

  it('leaves the server’s own writes alone', () => {
    const s = setup();
    const id = s.jobs.start('room-1');
    s.jobs.finish('room-1', id, { status: 'done', brief: BRIEF, picture: false });
    expect(s.job('room-1')?.status).toBe('done');
  });

  it('is attached once per document, however often it is called', () => {
    const doc = new Y.Doc();
    let observers = 0;
    const map = doc.getMap(JOB_MAP);
    const original = map.observe.bind(map);
    map.observe = (f) => {
      observers += 1;
      original(f);
    };
    guardJob(doc);
    guardJob(doc);
    expect(observers).toBe(1);
  });
});
