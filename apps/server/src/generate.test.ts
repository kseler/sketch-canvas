import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from './app';
import { createRoomLocks, type RoomLocks } from './roomLocks';
import { MAX_SKETCH_BYTES, MAX_SKETCH_SIDE } from './generate';
import type { BriefOutcome, DescribeSketch } from './describeSketch';
import { BudgetExceededError } from './budget';
import { NotBilledError, PaidCallTimeoutError } from './cost';
import { ImageBlockedError, InvalidImageError } from './generateImage';
import { ContentFlaggedError, ModerationUnavailableError } from './moderation';
import { PictureStorageError, type MakePicture } from './picture';
import type { ImageRecord } from './roomImages';
import type { JobOutcome, RoomJobs } from './roomJobs';
import { createImageStore, type ImageStore } from './imageStore';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Stands in for the vision step: no network, no cost. Records what it was asked.
const FAKE_BRIEF = { subject: 'a cat on a hill', style: 'watercolor', mood: 'calm', palette: ['#3a7bd5'], composition: 'cat centered', lettering: '' };
const describeCalls: Array<{ roomId: string; image: { base64: string; width: number; height: number } }> = [];
const fakeDescribe: DescribeSketch = async (request) => {
  describeCalls.push(request);
  return { ok: true, brief: FAKE_BRIEF };
};

// Records jobs instead of writing them into a room's Yjs document, so a test can see how a job
// ended. The work runs after the 202 answer, so tests wait for `finished` rather than the reply.
function fakeJobs() {
  const started: string[] = [];
  const finished: Array<{ roomId: string; jobId: string; outcome: JobOutcome }> = [];
  const jobs: RoomJobs = {
    open: () => {},
    start: (roomId) => {
      started.push(roomId);
      return `job-${started.length}`;
    },
    finish: (roomId, jobId, outcome) => {
      finished.push({ roomId, jobId, outcome });
    },
  };
  const settled = (count = 1) => vi.waitFor(() => expect(finished.length).toBeGreaterThanOrEqual(count));
  return { jobs, started, finished, settled };
}

const testApp = (options: Partial<AppOptions> = {}) => createApp({ jobs: fakeJobs().jobs, ...options });

const app = testApp({ describeSketch: fakeDescribe });

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function pngBytes(width: number, height: number, extra = 0): Buffer {
  return Buffer.from([
    ...SIGNATURE, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height),
    8, 0, 0, 0, 0, 0, 0, 0, 0,
    ...new Array(extra).fill(0),
  ]);
}
const pngBase64 = (width: number, height: number, extra = 0) => pngBytes(width, height, extra).toString('base64');

const validBody = { roomId: 'room-1', image: pngBase64(800, 600) };

function post(body: BodyInit, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  return app.request('/api/generate', { method: 'POST', headers, body });
}
const postJson = (value: unknown) => post(JSON.stringify(value));

describe('GET /api/health', () => {
  it('says the server is up', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /api/generate', () => {
  it('answers 202 with the job id for a valid sketch, then describes it with the room, the image and its real size', async () => {
    describeCalls.length = 0;
    const j = fakeJobs();
    const res = await testApp({ describeSketch: fakeDescribe, jobs: j.jobs }).request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-1' });
    expect(j.started).toEqual(['room-1']);
    await j.settled();
    expect(describeCalls).toEqual([{ roomId: 'room-1', image: { base64: validBody.image, width: 800, height: 600 } }]);
  });

  it('accepts a sketch at exactly the side limit', async () => {
    const res = await postJson({ ...validBody, image: pngBase64(MAX_SKETCH_SIDE, MAX_SKETCH_SIDE) });
    expect(res.status).toBe(202);
  });

  it('rejects a sketch one pixel wider than the limit with 413', async () => {
    const res = await postJson({ ...validBody, image: pngBase64(MAX_SKETCH_SIDE + 1, 100) });
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty('error');
  });

  it('rejects a sketch one pixel taller than the limit with 413', async () => {
    const res = await postJson({ ...validBody, image: pngBase64(100, MAX_SKETCH_SIDE + 1) });
    expect(res.status).toBe(413);
  });

  it('rejects a sketch with an absurd size claim (above 2^31) with 413', async () => {
    const res = await postJson({ ...validBody, image: pngBase64(0xffffffff, 0xffffffff) });
    expect(res.status).toBe(413);
  });

  it('accepts a PNG of exactly MAX_SKETCH_BYTES and rejects one byte more with 413', async () => {
    const header = pngBytes(10, 10).length;
    const atLimit = await postJson({ ...validBody, image: pngBase64(10, 10, MAX_SKETCH_BYTES - header) });
    expect(atLimit.status).toBe(202);
    const over = await postJson({ ...validBody, image: pngBase64(10, 10, MAX_SKETCH_BYTES - header + 1) });
    expect(over.status).toBe(413);
  });

  it('rejects a body far over the limit with 413, judged by Content-Length before reading it', async () => {
    const big = JSON.stringify({ roomId: 'room-1', image: 'A'.repeat(MAX_SKETCH_BYTES * 3) });
    const res = await post(big, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(big)),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty('error');
  });

  it('rejects a streamed body with no Content-Length once it passes the limit', async () => {
    // A client can leave out Content-Length (chunked upload). bodyLimit must then count the bytes
    // as they arrive and stop at the limit, instead of trusting a header that isn't there.
    const chunk = new TextEncoder().encode('A'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= MAX_SKETCH_BYTES * 2) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const req = new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }); // duplex: Node requires it for a streamed body; not in the DOM types yet
    expect(req.headers.has('content-length')).toBe(false);
    const res = await app.request(req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(MAX_SKETCH_BYTES * 2); // stopped reading early, not after the whole body
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'hello'],
    ['an empty object', {}],
    ['a missing roomId', { image: validBody.image }],
    ['a missing image', { roomId: 'room-1' }],
    ['a numeric roomId', { ...validBody, roomId: 5 }],
    ['a numeric image', { ...validBody, image: 5 }],
    ['an object image', { ...validBody, image: { data: validBody.image } }],
    ['a null image', { ...validBody, image: null }],
    ['an empty image', { ...validBody, image: '' }],
    ['an uppercase roomId', { ...validBody, roomId: 'Room-1' }],
    ['a 65-character roomId', { ...validBody, roomId: 'a'.repeat(65) }],
    ['an empty roomId', { ...validBody, roomId: '' }],
    ['a roomId with a slash', { ...validBody, roomId: 'a/b' }],
    ['a roomId with a trailing newline', { ...validBody, roomId: 'room\n' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await postJson(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('accepts a 64-character roomId', async () => {
    expect((await postJson({ ...validBody, roomId: 'a'.repeat(64) })).status).toBe(202);
  });

  it.each([
    ['text', Buffer.from('hello hello hello hello hello hello hello').toString('base64')],
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]).toString('base64')],
    ['a GIF', Buffer.from(['GIF89a', ...new Array(40).fill('\0')].join('')).toString('base64')],
    ['a PNG signature without IHDR', pngBytes(10, 10).fill(0x41, 12, 16).toString('base64')],
    ['a PNG of zero width', pngBase64(0, 10)],
    ['characters that are not base64', '!!!!' + validBody.image],
    ['base64 with a wrong length', validBody.image.slice(0, -1)],
    ['a data: URL', `data:image/png;base64,${validBody.image}`],
  ])('rejects %s as not a PNG with 400', async (_label, image) => {
    const res = await postJson({ ...validBody, image });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('does not echo the input in error replies', async () => {
    const secret = 'SECRET-MARKER-<script>';
    const replies = await Promise.all([
      postJson({ roomId: secret, image: validBody.image }),
      postJson({ roomId: 'room-1', image: secret }),
      post(`{${secret}`),
      postJson({ roomId: 'room-1', image: Buffer.from(secret).toString('base64') }),
      postJson({ ...validBody, image: pngBase64(MAX_SKETCH_SIDE + 1, 1) }),
    ]);
    for (const res of replies) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      const text = await res.text();
      expect(text).not.toContain('SECRET-MARKER');
      expect(text).not.toContain(Buffer.from(secret).toString('base64'));
    }
  });
});

describe('POST /api/generate room lock', () => {
  const lockedApp = (locks: RoomLocks) => testApp({ describeSketch: fakeDescribe, locks });
  const send = (a: ReturnType<typeof createApp>, body: unknown) =>
    a.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('refuses with 409 while the room is busy, and still serves other rooms', async () => {
    const locks = createRoomLocks();
    const a = lockedApp(locks);
    const release = locks.tryAcquire('room-1');

    const busy = await send(a, validBody);
    expect(busy.status).toBe(409);
    expect(typeof (await busy.json()).error).toBe('string');

    const other = await send(a, { ...validBody, roomId: 'room-2' });
    expect(other.status).toBe(202);

    release?.();
    expect((await send(a, validBody)).status).toBe(202);
  });

  it('does not free a lock held by someone else when it is refused', async () => {
    const locks = createRoomLocks();
    locks.tryAcquire('room-1');
    await send(lockedApp(locks), validBody);
    expect(locks.isBusy('room-1')).toBe(true);
  });

  it('frees the room once the job has ended', async () => {
    const locks = createRoomLocks();
    const res = await send(lockedApp(locks), validBody);
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(locks.isBusy('room-1')).toBe(false));
  });

  it.each([
    ['an invalid body (400)', { roomId: 'room-1' }, 400],
    ['a non-PNG image (400)', { roomId: 'room-1', image: Buffer.from('hello hello hello').toString('base64') }, 400],
    ['an oversize sketch (413)', { roomId: 'room-1', image: pngBase64(MAX_SKETCH_SIDE + 1, 1) }, 413],
  ])('never takes the lock for %s', async (_label, body, status) => {
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const res = await send(lockedApp(locks), body);
    expect(res.status).toBe(status);
    expect(acquire).not.toHaveBeenCalled(); // not just "free afterwards": never taken at all
  });
});

describe('CORS on /api', () => {
  const preflight = (a: ReturnType<typeof createApp>, origin: string) =>
    a.request('/api/generate', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });

  it('allows the default local web origin', async () => {
    const res = await preflight(testApp({ describeSketch: fakeDescribe }), 'http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('does not allow an unknown origin', async () => {
    const res = await preflight(testApp({ describeSketch: fakeDescribe }), 'https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('does not add allow-origin to a real request from an unknown origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('uses the configured origins instead of the defaults', async () => {
    const a = testApp({ describeSketch: fakeDescribe, allowedOrigins: ['https://sketch.example.com'] });
    const ok = await preflight(a, 'https://sketch.example.com');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://sketch.example.com');
    const refused = await preflight(a, 'http://localhost:5173');
    expect(refused.headers.get('Access-Control-Allow-Origin')).not.toBe('http://localhost:5173');
  });

  it('still serves a request without an Origin header (curl, scripts)', async () => {
    const res = await post(JSON.stringify(validBody));
    expect(res.status).toBe(202);
  });
});

describe('POST guard against other sites', () => {
  const validJson = JSON.stringify(validBody);

  it('refuses a simple text/plain POST, which a browser sends cross-site without a preflight', async () => {
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const res = await testApp({ describeSketch: fakeDescribe, locks }).request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: validJson,
    });
    expect(res.status).toBe(415);
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each(['', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp'])(
    'refuses Content-Type %j with 415',
    async (type) => {
      const res = await app.request('/api/generate', {
        method: 'POST',
        headers: type ? { 'Content-Type': type } : {},
        body: validJson,
      });
      expect(res.status).toBe(415);
    },
  );

  it('accepts application/json with a charset', async () => {
    const res = await post(validJson, { 'Content-Type': 'application/json; charset=utf-8' });
    expect(res.status).toBe(202);
  });

  it('refuses a POST from a page on another site with 403, before taking the lock', async () => {
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const res = await testApp({ describeSketch: fakeDescribe, locks }).request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: validJson,
    });
    expect(res.status).toBe(403);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('accepts a POST from the allowed web page', async () => {
    const res = await post(validJson, { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' });
    expect(res.status).toBe(202);
  });
});

describe('guard is deny-by-default for methods', () => {
  it('also covers a write route added later, e.g. a cross-site text/plain PUT', async () => {
    const a = testApp({ describeSketch: fakeDescribe });
    a.put('/api/later', (c) => c.json({ ok: true })); // stands in for a future route
    const fromEvil = await a.request('/api/later', {
      method: 'PUT',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(fromEvil.status).toBe(403);
    const notJson = await a.request('/api/later', { method: 'DELETE', headers: { Origin: 'http://localhost:5173' } });
    expect(notJson.status).toBe(415);
  });

  it('lets read-only requests through from any page', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
  });

  it('refuses Origin: null (sandboxed iframes, file pages, cross-site redirects)', async () => {
    const res = await post(JSON.stringify(validBody), { 'Content-Type': 'application/json', Origin: 'null' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/generate job outcomes', () => {
  afterEach(() => vi.restoreAllMocks());

  const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const RECORD: ImageRecord = { kind: 'image', id: ID, url: `/api/images/${ID}.png`, x: 0, y: 0, w: 800, h: 600, createdAt: '2026-11-24T12:00:00.000Z' };
  const describing = (outcome: BriefOutcome): DescribeSketch => async () => outcome;
  const failing = (error: unknown): DescribeSketch => () => Promise.reject(error);
  const pictureFailing = (error: unknown): MakePicture => () => Promise.reject(error);
  const send = (a: ReturnType<typeof createApp>, body: unknown = validBody) =>
    a.request('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // Sends one valid request and waits for its job to end; returns how it ended.
  async function run(options: Partial<AppOptions>): Promise<JobOutcome> {
    const j = fakeJobs();
    const res = await send(testApp({ ...options, jobs: j.jobs }));
    expect(res.status).toBe(202);
    await j.settled();
    expect(j.finished).toHaveLength(1);
    expect(j.finished[0]).toMatchObject({ roomId: 'room-1', jobId: 'job-1' });
    return j.finished[0]!.outcome;
  }
  const errorOf = async (options: Partial<AppOptions>) => {
    const outcome = await run(options);
    expect(outcome.status).toBe('failed');
    return (outcome as { error: string }).error;
  };

  it('answers 503 up front, with no job, when the server has no brief step', async () => {
    const j = fakeJobs();
    const res = await send(testApp({ jobs: j.jobs }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Generate is not set up on this server.' });
    expect(j.started).toEqual([]);
  });

  it('ends done with the brief and no picture when no picture step is configured', async () => {
    expect(await run({ describeSketch: describing({ ok: true, brief: FAKE_BRIEF }) })).toEqual({ status: 'done', brief: FAKE_BRIEF, picture: false });
  });

  it('ends done with the brief and a picture when the picture step succeeds', async () => {
    expect(await run({ describeSketch: fakeDescribe, makePicture: async () => RECORD })).toEqual({ status: 'done', brief: FAKE_BRIEF, picture: true });
  });

  it('gives the picture step the room, the brief and the area the sketch covers', async () => {
    const makePicture = vi.fn<MakePicture>(async () => RECORD);
    const j = fakeJobs();
    await send(testApp({ describeSketch: fakeDescribe, makePicture, jobs: j.jobs }), { roomId: 'room-7', image: pngBase64(640, 480) });
    await j.settled();
    expect(makePicture).toHaveBeenCalledTimes(1);
    expect(makePicture).toHaveBeenCalledWith({ roomId: 'room-7', brief: FAKE_BRIEF, area: { x: 0, y: 0, w: 640, h: 480 } });
  });

  it('does not make a picture when the brief failed', async () => {
    const makePicture = vi.fn<MakePicture>(async () => RECORD);
    await run({ describeSketch: describing({ ok: false, reason: 'refused' }), makePicture });
    expect(makePicture).not.toHaveBeenCalled();
  });

  it.each(['refused', 'truncated', 'invalid'] as const)('fails the job with a fixed message when the brief is %s', async (reason) => {
    expect(await errorOf({ describeSketch: describing({ ok: false, reason }) })).toMatch(/AI/);
  });

  it('gives the same wording for truncated and invalid, so a player learns nothing about which', async () => {
    const a = await errorOf({ describeSketch: describing({ ok: false, reason: 'truncated' }) });
    const b = await errorOf({ describeSketch: describing({ ok: false, reason: 'invalid' }) });
    expect(a).toBe(b);
  });

  it('uses room wording for a room budget, and different wording for the global one', async () => {
    const room = await errorOf({ describeSketch: failing(new BudgetExceededError('room')) });
    const global = await errorOf({ describeSketch: failing(new BudgetExceededError('global')) });
    expect(room).toMatch(/room/i);
    expect(global).not.toMatch(/room/i);
    expect(room).not.toBe(global);
  });

  it.each([
    ['a brief timeout', { describeSketch: failing(new PaidCallTimeoutError(30_000)) }, 'The AI took too long. Try again.'],
    ['a rate-limited provider (429)', { describeSketch: failing(new NotBilledError(429)) }, 'The AI service is busy. Try again in a minute.'],
    ['an overloaded provider (529)', { describeSketch: failing(new NotBilledError(529)) }, 'The AI service is busy. Try again in a minute.'],
    ['a rejected, not-billed call', { describeSketch: failing(new NotBilledError(400)) }, 'Could not reach the AI service. Try again later.'],
    ['an unknown error', { describeSketch: failing(new TypeError('boom')) }, 'Could not reach the AI service. Try again later.'],
    ['moderation down (fails closed)', { describeSketch: fakeDescribe, makePicture: pictureFailing(new ModerationUnavailableError()) }, "Couldn't check the picture request. Try again in a minute."],
    ['a broken image', { describeSketch: fakeDescribe, makePicture: pictureFailing(new InvalidImageError()) }, 'The picture came back broken. Try again.'],
    ['a picture that could not be saved', { describeSketch: fakeDescribe, makePicture: pictureFailing(new PictureStorageError({ cause: new Error('ENOSPC') })) }, 'The picture was made but could not be saved. Try again.'],
    ['an image timeout', { describeSketch: fakeDescribe, makePicture: pictureFailing(new PaidCallTimeoutError(1000)) }, 'The AI took too long. Try again.'],
  ] satisfies Array<[string, Partial<AppOptions>, string]>)('fails the job with the fixed message for %s', async (_label, options, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await errorOf(options)).toBe(message);
  });

  it('uses the same text for our moderation flag and the image service block, logging the name only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flagged = await errorOf({ describeSketch: fakeDescribe, makePicture: pictureFailing(new ContentFlaggedError()) });
    const blocked = await errorOf({ describeSketch: fakeDescribe, makePicture: pictureFailing(new ImageBlockedError()) });
    expect(flagged).toBe(blocked);
    expect(warn.mock.calls).toEqual([['generate: picture refused (ContentFlaggedError)'], ['generate: picture refused (ImageBlockedError)']]);
  });

  it('never puts model or provider text in the job or the log, whatever the outcome', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const marker = 'SECRET-sk-ant-xyz';
    const cases: Array<Partial<AppOptions>> = [
      { describeSketch: describing({ ok: false, reason: 'refused', message: marker } as unknown as BriefOutcome) }, // cast: extra field a careless route might echo
      { describeSketch: describing({ ok: false, reason: 'invalid', detail: marker } as unknown as BriefOutcome) },
      { describeSketch: failing(new Error(marker)) },
      { describeSketch: failing(marker) }, // a non-Error
      { describeSketch: fakeDescribe, makePicture: pictureFailing(new ImageBlockedError({ cause: new Error(marker) })) },
      { describeSketch: fakeDescribe, makePicture: pictureFailing(new ModerationUnavailableError({ cause: new Error(marker) })) },
      { describeSketch: fakeDescribe, makePicture: pictureFailing(new Error(marker)) },
    ];
    for (const options of cases) {
      expect(JSON.stringify(await run(options))).not.toContain('SECRET');
    }
    for (const args of log.mock.calls) {
      expect(args).toHaveLength(1); // no error object passed along, which would print message and stack
      expect(typeof args[0]).toBe('string');
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('logs the provider status and code, e.g. 429 insufficient_quota (no credit) vs a real rate limit', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run({ describeSketch: fakeDescribe, makePicture: pictureFailing(new NotBilledError(429, { code: 'insufficient_quota' })) });
    expect(error.mock.calls).toEqual([['generate: failed (NotBilledError 429 insufficient_quota)']]);
  });

  it('releases the room lock after every outcome and error, including a step that throws before its promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: Array<Partial<AppOptions>> = [
      { describeSketch: describing({ ok: true, brief: FAKE_BRIEF }) },
      { describeSketch: describing({ ok: false, reason: 'refused' }) },
      { describeSketch: failing(new BudgetExceededError('room')) },
      { describeSketch: failing(new Error('boom')) },
      { describeSketch: () => { throw new Error('thrown before a promise'); } },
      { describeSketch: fakeDescribe, makePicture: async () => RECORD },
      { describeSketch: fakeDescribe, makePicture: pictureFailing(new ContentFlaggedError()) },
      { describeSketch: fakeDescribe, makePicture: () => { throw new Error('thrown before a promise'); } },
    ];
    for (const options of cases) {
      const locks = createRoomLocks();
      expect((await run({ ...options, locks })).status).toMatch(/^(done|failed)$/);
      expect(locks.isBusy('room-1')).toBe(false);
    }
  });

  it('releases the lock even when the job cannot be recorded, and logs only the error name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const locks = createRoomLocks();
    const jobs: RoomJobs = { open: () => {}, start: () => 'job-1', finish: () => { throw new Error('SECRET doc gone'); } };
    expect((await send(testApp({ describeSketch: fakeDescribe, locks, jobs }))).status).toBe(202);
    await vi.waitFor(() => expect(locks.isBusy('room-1')).toBe(false));
    expect(error.mock.calls).toEqual([['generate: could not record the job (Error)']]);
  });

  it('records a plain failure when the real outcome cannot be written, so the room is not left "running"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const written: JobOutcome[] = [];
    let calls = 0;
    const jobs: RoomJobs = {
      open: () => {},
      start: () => 'job-1',
      finish: (_roomId, _jobId, outcome) => {
        calls += 1;
        if (calls === 1) throw new Error('first write failed');
        written.push(outcome);
      },
    };
    expect((await send(testApp({ describeSketch: fakeDescribe, jobs }))).status).toBe(202);
    await vi.waitFor(() => expect(written).toEqual([{ status: 'failed', error: 'Could not reach the AI service. Try again later.' }]));
  });

  it('gives the lock back and answers a fixed 500 when the job cannot be started', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const locks = createRoomLocks();
    const describe = vi.fn(fakeDescribe);
    const jobs: RoomJobs = { open: () => {}, start: () => { throw new Error('SECRET'); }, finish: () => {} };
    const res = await send(testApp({ describeSketch: describe, locks, jobs }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SECRET');
    expect(locks.isBusy('room-1')).toBe(false);
    expect(describe).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
  });

  it('holds the lock for the whole job, not just the request: a second POST gets 409 until it ends', async () => {
    const locks = createRoomLocks();
    const finishers = new Map<string, (record: ImageRecord) => void>();
    const makePicture: MakePicture = ({ roomId }) => new Promise<ImageRecord>((resolve) => { finishers.set(roomId, resolve); });
    const calls: string[] = [];
    const describeSketch: DescribeSketch = async ({ roomId }) => {
      calls.push(roomId);
      return { ok: true, brief: FAKE_BRIEF };
    };
    const j = fakeJobs();
    const a = testApp({ describeSketch, makePicture, locks, jobs: j.jobs });

    expect((await send(a)).status).toBe(202); // answered while the picture is still being made
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(locks.isBusy('room-1')).toBe(true);

    const second = await send(a);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'A picture is already being generated in this room.' });
    expect(j.started).toEqual(['room-1']); // no second job
    expect(calls).toHaveLength(1); // and no second paid step

    expect((await send(a, { ...validBody, roomId: 'room-2' })).status).toBe(202); // other rooms still work
    expect(j.started).toEqual(['room-1', 'room-2']);

    await vi.waitFor(() => expect(finishers.has('room-2')).toBe(true));
    finishers.get('room-2')?.(RECORD);
    await vi.waitFor(() => expect(locks.isBusy('room-2')).toBe(false));
    expect(locks.isBusy('room-1')).toBe(true); // the other room ending frees only its own lock

    finishers.get('room-1')?.(RECORD);
    await vi.waitFor(() => expect(j.finished.map((f) => f.roomId)).toContain('room-1'));
    expect(locks.isBusy('room-1')).toBe(false);
  });

  it('still records the job and frees the room when the thrown value is hostile (a throwing name getter)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'name', { get: () => { throw new Error('gotcha'); } });
    const locks = createRoomLocks();
    expect(await run({ describeSketch: failing(hostile), locks })).toEqual({ status: 'failed', error: 'Could not reach the AI service. Try again later.' });
    expect(locks.isBusy('room-1')).toBe(false);
    expect(JSON.stringify(error.mock.calls)).not.toContain('gotcha');
  });

  it('ends a job that runs past the deadline (e.g. a hung disk while saving), frees the room, and records it once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const locks = createRoomLocks();
    let finish: (record: ImageRecord) => void = () => {};
    const makePicture: MakePicture = () => new Promise<ImageRecord>((resolve) => { finish = resolve; });
    const j = fakeJobs();
    const a = testApp({ describeSketch: fakeDescribe, makePicture, locks, jobs: j.jobs, jobLimits: { jobTimeoutMs: 30, maxRunningJobs: 8 } });
    expect((await send(a)).status).toBe(202);
    await j.settled();
    expect(j.finished[0]?.outcome).toEqual({ status: 'failed', error: 'The AI took too long. Try again.' });
    expect(locks.isBusy('room-1')).toBe(false);
    expect(error.mock.calls).toEqual([['generate: failed (JobTimeoutError)']]);

    finish(RECORD); // the work finishing late does not rewrite the job
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(j.finished).toHaveLength(1);
  });

  it('refuses with 503 once the server runs as many jobs as it allows, before taking a lock or starting a job', async () => {
    const finishers: Array<(outcome: BriefOutcome) => void> = [];
    const describeSketch: DescribeSketch = () => new Promise<BriefOutcome>((resolve) => { finishers.push(resolve); });
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const j = fakeJobs();
    const a = testApp({ describeSketch, locks, jobs: j.jobs, jobLimits: { jobTimeoutMs: 60_000, maxRunningJobs: 2 } });

    expect((await send(a, { ...validBody, roomId: 'room-1' })).status).toBe(202);
    expect((await send(a, { ...validBody, roomId: 'room-2' })).status).toBe(202);
    const third = await send(a, { ...validBody, roomId: 'room-3' });
    expect(third.status).toBe(503);
    expect(await third.json()).toEqual({ error: 'The server is busy. Try again in a minute.' });
    expect(j.started).toEqual(['room-1', 'room-2']);
    expect(acquire).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(finishers).toHaveLength(2));
    finishers[0]?.({ ok: true, brief: FAKE_BRIEF });
    await vi.waitFor(() => expect(j.finished).toHaveLength(1));
    expect((await send(a, { ...validBody, roomId: 'room-3' })).status).toBe(202); // a place is free again
    finishers.slice(1).forEach((f) => f({ ok: true, brief: FAKE_BRIEF }));
  });

  it('gives a job’s place back when its record cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const locks = createRoomLocks();
    const jobs: RoomJobs = { open: () => {}, start: (roomId) => roomId, finish: () => { throw new Error('doc gone'); } };
    const a = testApp({ describeSketch: fakeDescribe, locks, jobs, jobLimits: { jobTimeoutMs: 60_000, maxRunningJobs: 1 } });
    expect((await send(a)).status).toBe(202);
    await vi.waitFor(() => expect(locks.isBusy('room-1')).toBe(false));
    expect((await send(a, { ...validBody, roomId: 'room-2' })).status).toBe(202);
  });

  it('refuses a room nobody has open with 409, before any job or paid step', async () => {
    const describe = vi.fn(fakeDescribe);
    const j = fakeJobs();
    const res = await send(testApp({ describeSketch: describe, isRoomOpen: () => false, jobs: j.jobs }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Open the room before generating.' });
    expect(j.started).toEqual([]);
    expect(describe).not.toHaveBeenCalled();
  });

  it('asks about the room from the request', async () => {
    const isRoomOpen = vi.fn(() => true);
    await send(testApp({ describeSketch: fakeDescribe, isRoomOpen }));
    expect(isRoomOpen).toHaveBeenCalledWith('room-1');
  });
});

describe('unhandled errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers a fixed 500 and logs only the error name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = testApp({ describeSketch: fakeDescribe });
    a.get('/api/boom', () => { throw new Error('SECRET-sk-ant-xyz'); });
    const res = await a.request('/api/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SECRET');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
  });
});

describe('GET /api/images/:file', () => {
  const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const store = (): ImageStore & { read: ReturnType<typeof vi.fn> } => ({
    save: vi.fn(),
    read: vi.fn(async (name: string) => (name === `${ID}.png` ? BYTES : null)),
  });

  it('serves a stored picture as an immutable, non-sniffable PNG', async () => {
    const res = await testApp({ images: store() }).request(`/api/images/${ID}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('asks the store for exactly the name in the URL', async () => {
    const images = store();
    await testApp({ images }).request(`/api/images/${ID}.png`);
    expect(images.read).toHaveBeenCalledWith(`${ID}.png`);
  });

  it('answers 404 for a name the store does not have', async () => {
    const res = await testApp({ images: store() }).request('/api/images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png');
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
  });

  it.each(['x.png', '..%2Fx.png', `${ID}.jpg`, `${ID.toUpperCase()}.png`])('answers 404 for the invalid name %s, even with a file of that name on disk', async (name) => {
    const parent = await mkdtemp(path.join(tmpdir(), 'image-route-test-'));
    try {
      await writeFile(path.join(parent, 'x.png'), 'secret');
      await mkdir(path.join(parent, 'images'));
      await writeFile(path.join(parent, 'images', 'x.png'), 'secret');
      const res = await testApp({ images: createImageStore(path.join(parent, 'images')) }).request(`/api/images/${name}`);
      expect(res.status).toBe(404);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('answers 404 when no image store is configured', async () => {
    const res = await testApp().request(`/api/images/${ID}.png`);
    expect(res.status).toBe(404);
  });

  it('still works for a GET from another site (read-only, the guard skips GET)', async () => {
    const res = await testApp({ images: store() }).request(`/api/images/${ID}.png`, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });
});
