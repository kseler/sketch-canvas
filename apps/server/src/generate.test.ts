import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { createRoomLocks, type RoomLocks } from './roomLocks';
import { MAX_SKETCH_BYTES, MAX_SKETCH_SIDE } from './generate';

const app = createApp();

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
  it('confirms a valid sketch with its size', async () => {
    const res = await postJson(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      width: 800,
      height: 600,
      bytes: pngBytes(800, 600).length,
    });
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
  const lockedApp = (locks: RoomLocks) => createApp({ locks });
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
    const res = await preflight(createApp(), 'http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('does not allow an unknown origin', async () => {
    const res = await preflight(createApp(), 'https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('does not add allow-origin to a real request from an unknown origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('uses the configured origins instead of the defaults', async () => {
    const a = createApp({ allowedOrigins: ['https://sketch.example.com'] });
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
    const res = await createApp({ locks }).request('/api/generate', {
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
    const res = await createApp({ locks }).request('/api/generate', {
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
    const a = createApp();
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
