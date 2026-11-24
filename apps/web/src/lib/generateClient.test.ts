// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToBase64, readGenerateResponse, REQUEST_TIMEOUT_MS, requestGenerate } from './generateClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okBody = { width: 800, height: 600, bytes: 1234 };

describe('readGenerateResponse', () => {
  it('reads a 2xx reply with numbers as ok', () => {
    expect(readGenerateResponse(200, okBody)).toEqual({ ok: true, width: 800, height: 600, bytes: 1234 });
  });

  it.each([
    ['missing width', { height: 1, bytes: 1 }],
    ['missing height', { width: 1, bytes: 1 }],
    ['missing bytes', { width: 1, height: 1 }],
    ['NaN width', { ...okBody, width: NaN }],
    ['Infinity height', { ...okBody, height: Infinity }],
    ['string bytes', { ...okBody, bytes: '12' }],
    ['null body', null],
    ['string body', 'ok'],
    ['array body', []],
  ])('is an error for a 2xx reply with %s', (_label, body) => {
    const result = readGenerateResponse(200, body);
    expect(result.ok).toBe(false);
  });

  it('uses the server error text for a non-2xx reply', () => {
    expect(readGenerateResponse(413, { error: 'The sketch is too large.' })).toEqual({
      ok: false,
      error: 'The sketch is too large.',
    });
  });

  it('does not trust numbers in a non-2xx reply', () => {
    expect(readGenerateResponse(500, okBody).ok).toBe(false);
  });

  it('names the HTTP status when a non-2xx reply has no error text', () => {
    expect(readGenerateResponse(502, null)).toEqual({ ok: false, error: 'Generate failed (HTTP 502).' });
    expect(readGenerateResponse(500, { error: 42 })).toEqual({ ok: false, error: 'Generate failed (HTTP 500).' });
    expect(readGenerateResponse(500, 'oops')).toEqual({ ok: false, error: 'Generate failed (HTTP 500).' });
  });

  it('caps long error text at 200 characters', () => {
    const result = readGenerateResponse(500, { error: 'x'.repeat(5000) });
    expect(result).toEqual({ ok: false, error: 'x'.repeat(200) });
  });
});

describe('blobToBase64', () => {
  it('returns base64 without the data: prefix', async () => {
    const blob = new Blob([new Uint8Array([72, 105])], { type: 'image/png' });
    expect(await blobToBase64(blob)).toBe('SGk=');
  });

  it('round-trips every byte value', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = await blobToBase64(new Blob([bytes], { type: 'image/png' }));
    expect(text).not.toContain('data:');
    expect(Uint8Array.from(atob(text), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('gives an empty string for an empty blob', async () => {
    expect(await blobToBase64(new Blob([], { type: 'image/png' }))).toBe('');
  });
});

describe('requestGenerate', () => {
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

  it('posts the room id and the base64 sketch as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await requestGenerate('room-1', png);
    expect(result).toEqual({ ok: true, width: 800, height: 600, bytes: 1234 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/generate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ roomId: 'room-1', image: 'AQID' });
  });

  it('returns ok:false, without throwing, when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await requestGenerate('room-1', png)).toEqual({ ok: false, error: 'Could not reach the server.' });
  });

  it('returns ok:false when the reply is not JSON (e.g. a proxy error page)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    expect(await requestGenerate('room-1', png)).toEqual({ ok: false, error: 'Generate failed (HTTP 502).' });
  });

  it('returns ok:false when a 200 reply is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fine', { status: 200 })));
    expect((await requestGenerate('room-1', png)).ok).toBe(false);
  });

  // A fetch that never answers on its own, only when its signal aborts (like a hung server).
  const hangingFetch = () =>
    vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

  it('gives up with a clear message when the server hangs past the timeout', async () => {
    const timer = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    vi.stubGlobal('fetch', hangingFetch());
    const pending = requestGenerate('room-1', png);
    expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    timer.abort(); // the timeout fires
    expect(await pending).toEqual({ ok: false, error: 'The server took too long to answer.' });
    timeoutSpy.mockRestore();
  });

  // A fetch whose headers arrive (status 200) but whose body never finishes, until the signal aborts.
  const stallingBodyFetch = () =>
    vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve({
        status: 200,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      } as Response),
    );

  it('reports a timeout that fires while the body is still arriving, not "HTTP 200"', async () => {
    const timer = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    vi.stubGlobal('fetch', stallingBodyFetch());
    const pending = requestGenerate('room-1', png);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    timer.abort(); // the timeout fires mid-body
    expect(await pending).toEqual({ ok: false, error: 'The server took too long to answer.' });
    timeoutSpy.mockRestore();
  });

  it('reports a cancel that happens while the body is still arriving', async () => {
    vi.stubGlobal('fetch', stallingBodyFetch());
    const caller = new AbortController();
    const pending = requestGenerate('room-1', png, caller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    caller.abort();
    expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
  });

  it('stops when the caller cancels, and says so', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const caller = new AbortController();
    const pending = requestGenerate('room-1', png, caller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    caller.abort();
    expect(await pending).toEqual({ ok: false, error: 'Cancelled.' });
  });
});
