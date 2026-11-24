import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { createRoomLocks, type RoomLocks } from './roomLocks';
import { MAX_SKETCH_BYTES, MAX_SKETCH_SIDE } from './generate';
import type { BriefOutcome, DescribeSketch } from './describeSketch';
import { BudgetExceededError } from './budget';
import { NotBilledError, PaidCallTimeoutError } from './cost';
import { NotConfiguredError } from './generate';
// Stands in for the vision step: no network, no cost. Records what it was asked.
const FAKE_BRIEF = { subject: 'a cat on a hill', style: 'watercolor', mood: 'calm', palette: ['#3a7bd5'], composition: 'cat centered', lettering: '' };
const describeCalls: Array<{ roomId: string; image: { base64: string; width: number; height: number } }> = [];
const fakeDescribe: DescribeSketch = async (request) => {
  describeCalls.push(request);
  return { ok: true, brief: FAKE_BRIEF };
};


const app = createApp({ describeSketch: fakeDescribe });

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
  it('returns the brief for a valid sketch, passing the room, the image and its real size along', async () => {
    describeCalls.length = 0;
    const res = await postJson(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: FAKE_BRIEF });
    expect(describeCalls).toEqual([{ roomId: 'room-1', image: { base64: validBody.image, width: 800, height: 600 } }]);
  });

  it('accepts a sketch at exactly the side limit', async () => {
    const res = await postJson({ ...validBody, image: pngBase64(MAX_SKETCH_SIDE, MAX_SKETCH_SIDE) });
    expect(res.status).toBe(200);
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
    expect(atLimit.status).toBe(200);
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
    expect((await postJson({ ...validBody, roomId: 'a'.repeat(64) })).status).toBe(200);
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
  const lockedApp = (locks: RoomLocks) => createApp({ describeSketch: fakeDescribe, locks });
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
    expect(other.status).toBe(200);

    release?.();
    expect((await send(a, validBody)).status).toBe(200);
  });

  it('does not free a lock held by someone else when it is refused', async () => {
    const locks = createRoomLocks();
    locks.tryAcquire('room-1');
    await send(lockedApp(locks), validBody);
    expect(locks.isBusy('room-1')).toBe(true);
  });

  it('frees the room once the request has finished', async () => {
    const locks = createRoomLocks();
    const res = await send(lockedApp(locks), validBody);
    expect(res.status).toBe(200);
    expect(locks.isBusy('room-1')).toBe(false);
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
    const res = await preflight(createApp({ describeSketch: fakeDescribe }), 'http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('does not allow an unknown origin', async () => {
    const res = await preflight(createApp({ describeSketch: fakeDescribe }), 'https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('does not add allow-origin to a real request from an unknown origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('uses the configured origins instead of the defaults', async () => {
    const a = createApp({ describeSketch: fakeDescribe, allowedOrigins: ['https://sketch.example.com'] });
    const ok = await preflight(a, 'https://sketch.example.com');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://sketch.example.com');
    const refused = await preflight(a, 'http://localhost:5173');
    expect(refused.headers.get('Access-Control-Allow-Origin')).not.toBe('http://localhost:5173');
  });

  it('still serves a request without an Origin header (curl, scripts)', async () => {
    const res = await post(JSON.stringify(validBody));
    expect(res.status).toBe(200);
  });
});

describe('POST guard against other sites', () => {
  const validJson = JSON.stringify(validBody);

  it('refuses a simple text/plain POST, which a browser sends cross-site without a preflight', async () => {
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const res = await createApp({ describeSketch: fakeDescribe, locks }).request('/api/generate', {
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
    expect(res.status).toBe(200);
  });

  it('refuses a POST from a page on another site with 403, before taking the lock', async () => {
    const locks = createRoomLocks();
    const acquire = vi.spyOn(locks, 'tryAcquire');
    const res = await createApp({ describeSketch: fakeDescribe, locks }).request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: validJson,
    });
    expect(res.status).toBe(403);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('accepts a POST from the allowed web page', async () => {
    const res = await post(validJson, { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
  });
});

describe('guard is deny-by-default for methods', () => {
  it('also covers a write route added later, e.g. a cross-site text/plain PUT', async () => {
    const a = createApp({ describeSketch: fakeDescribe });
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

describe('POST /api/generate brief outcomes and errors', () => {
  afterEach(() => vi.restoreAllMocks());

  const send = (a: ReturnType<typeof createApp>) =>
    a.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
  const describing = (outcome: BriefOutcome): DescribeSketch => async () => outcome;
  const failing = (error: unknown): DescribeSketch => () => Promise.reject(error);
  const errorText = async (res: Response) => ((await res.json()) as { error: string }).error;

  it('answers 200 with only the brief, no status field', async () => {
    const res = await send(createApp({ describeSketch: describing({ ok: true, brief: FAKE_BRIEF }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: FAKE_BRIEF });
  });

  it.each([
    ['refused', 422],
    ['truncated', 502],
    ['invalid', 502],
  ] as const)('maps the outcome %s to %i with a fixed message', async (reason, status) => {
    const res = await send(createApp({ describeSketch: describing({ ok: false, reason }) }));
    expect(res.status).toBe(status);
    expect(typeof (await errorText(res))).toBe('string');
  });

  it('gives the same wording for truncated and invalid, so a player learns nothing about which', async () => {
    const a = await send(createApp({ describeSketch: describing({ ok: false, reason: 'truncated' }) }));
    const b = await send(createApp({ describeSketch: describing({ ok: false, reason: 'invalid' }) }));
    expect(await errorText(a)).toBe(await errorText(b));
  });

  it('answers 429 with room wording for a room budget, and different wording for the global one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const room = await send(createApp({ describeSketch: failing(new BudgetExceededError('room')) }));
    const global = await send(createApp({ describeSketch: failing(new BudgetExceededError('global')) }));
    expect(room.status).toBe(429);
    expect(global.status).toBe(429);
    const roomText = await errorText(room);
    const globalText = await errorText(global);
    expect(roomText).toMatch(/room/i);
    expect(globalText).not.toMatch(/room/i);
    expect(roomText).not.toBe(globalText);
  });

  it('answers 504 for a timeout', async () => {
    const res = await send(createApp({ describeSketch: failing(new PaidCallTimeoutError(30_000)) }));
    expect(res.status).toBe(504);
  });

  it('answers 503 when Generate is not configured, including the default app with no describeSketch', async () => {
    const explicit = await send(createApp({ describeSketch: failing(new NotConfiguredError()) }));
    expect(explicit.status).toBe(503);
    const byDefault = await send(createApp());
    expect(byDefault.status).toBe(503);
  });

  it('answers 502 for a rejected, not-billed call and for an unknown error, logging only the name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notBilled = await send(createApp({ describeSketch: failing(new NotBilledError(400)) }));
    expect(notBilled.status).toBe(502);
    const unknown = await send(createApp({ describeSketch: failing(new TypeError('boom')) }));
    expect(unknown.status).toBe(502);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('does not leak the error message to the player or the log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = new Error('SECRET-sk-ant-xyz');
    const res = await send(createApp({ describeSketch: failing(secret) }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('SECRET');
    expect(error).toHaveBeenCalledTimes(1);
    for (const args of error.mock.calls) {
      expect(args).toHaveLength(1); // no error object passed along, which would print message and stack
      expect(typeof args[0]).toBe('string');
      expect(args[0]).not.toContain('SECRET');
      expect(args[0]).not.toContain('sk-ant');
    }
  });

  it('does not log or leak when a non-Error is thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send(createApp({ describeSketch: failing('SECRET-sk-ant-xyz') }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('SECRET');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
  });

  it('never puts model or provider text in a reply, whatever the outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const marker = 'MODEL-SAID-THIS';
    const cases: DescribeSketch[] = [
      describing({ ok: false, reason: 'refused', message: marker } as unknown as BriefOutcome), // cast: extra field a careless route might echo
      describing({ ok: false, reason: 'invalid', detail: marker } as unknown as BriefOutcome),
      failing(new Error(marker)),
      failing(new BudgetExceededError('room')),
      failing(new PaidCallTimeoutError(1)),
    ];
    for (const describeSketch of cases) {
      const res = await send(createApp({ describeSketch }));
      expect(await res.text()).not.toContain(marker);
    }
  });

  it('releases the room lock after every outcome and error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: DescribeSketch[] = [
      describing({ ok: true, brief: FAKE_BRIEF }),
      describing({ ok: false, reason: 'refused' }),
      describing({ ok: false, reason: 'truncated' }),
      describing({ ok: false, reason: 'invalid' }),
      failing(new BudgetExceededError('room')),
      failing(new PaidCallTimeoutError(1)),
      failing(new NotConfiguredError()),
      failing(new Error('boom')),
      () => { throw new Error('thrown before a promise'); },
    ];
    for (const describeSketch of cases) {
      const locks = createRoomLocks();
      const res = await send(createApp({ describeSketch, locks }));
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(locks.isBusy('room-1')).toBe(false);
    }
  });

  it('holds the lock while describing: a second POST gets 409, and works once the first is done', async () => {
    const locks = createRoomLocks();
    const finishers: Array<(outcome: BriefOutcome) => void> = [];
    const calls: string[] = [];
    const describeSketch: DescribeSketch = ({ roomId }) => {
      calls.push(roomId);
      return new Promise<BriefOutcome>((resolve) => { finishers.push(resolve); });
    };
    const a = createApp({ describeSketch, locks });

    const first = send(a);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(locks.isBusy('room-1')).toBe(true);

    const second = await send(a);
    expect(second.status).toBe(409);
    expect(calls).toHaveLength(1); // the second request never reached the paid step

    const otherRoom = a.request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, roomId: 'room-2' }),
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    finishers[1]?.({ ok: true, brief: FAKE_BRIEF });
    expect((await otherRoom).status).toBe(200);
    expect(locks.isBusy('room-1')).toBe(true); // the other room finishing frees only its own lock

    finishers[0]?.({ ok: true, brief: FAKE_BRIEF });
    expect((await first).status).toBe(200);
    expect(locks.isBusy('room-1')).toBe(false);
  });
});

describe('unhandled errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers a fixed 500 and logs only the error name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = createApp({ describeSketch: fakeDescribe });
    a.get('/api/boom', () => { throw new Error('SECRET-sk-ant-xyz'); });
    const res = await a.request('/api/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SECRET');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
  });
});

describe('provider busy', () => {
  it.each([429, 529])('answers 503 "busy" when the provider is rate limited or overloaded (%s)', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createApp({ describeSketch: () => Promise.reject(new NotBilledError(status)) }).request('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The AI service is busy. Try again in a minute.' });
    vi.restoreAllMocks();
  });
});
