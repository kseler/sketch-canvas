// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToBase64, readGenerateResponse, REQUEST_TIMEOUT_MS, requestGenerate } from './generateClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const JOB_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('readGenerateResponse', () => {
  it('reads a 202 reply with a job id as started', () => {
    expect(readGenerateResponse(202, { jobId: JOB_ID })).toEqual({ ok: true, jobId: JOB_ID });
  });

  it.each([
    ['a 200 instead of 202', 200, { jobId: JOB_ID }],
    ['no job id', 202, {}],
    ['an empty job id', 202, { jobId: '' }],
    ['a numeric job id', 202, { jobId: 5 }],
    ['a job id over 64 characters', 202, { jobId: 'x'.repeat(65) }],
    ['a null body', 202, null],
    ['a string body', 202, 'ok'],
    ['an array body', 202, [JOB_ID]],
  ])('is an error for %s', (_label, status, body) => {
    expect(readGenerateResponse(status, body).ok).toBe(false);
  });

  it('uses the server error text for an error reply', () => {
    expect(readGenerateResponse(409, { error: 'A picture is already being generated in this room.' })).toEqual({
      ok: false,
      error: 'A picture is already being generated in this room.',
    });
  });

  it('names the HTTP status when an error reply has no usable error text', () => {
    expect(readGenerateResponse(502, null)).toEqual({ ok: false, error: 'Generate failed (HTTP 502).' });
    expect(readGenerateResponse(500, { error: 42 })).toEqual({ ok: false, error: 'Generate failed (HTTP 500).' });
    expect(readGenerateResponse(500, { error: ' \u200B ' })).toEqual({ ok: false, error: 'Generate failed (HTTP 500).' });
    expect(readGenerateResponse(500, 'oops')).toEqual({ ok: false, error: 'Generate failed (HTTP 500).' });
  });

  it('ignores error text in a reply that is not an error status', () => {
    expect(readGenerateResponse(200, { error: 'Everything is broken, call this number' })).toEqual({ ok: false, error: 'Generate failed (HTTP 200).' });
  });

  it('cleans and caps error text at 200 characters, never splitting a character', () => {
    expect(readGenerateResponse(500, { error: 'x'.repeat(5000) })).toEqual({ ok: false, error: 'x'.repeat(200) });
    expect(readGenerateResponse(500, { error: 'bad\u202Etext\nhere' })).toEqual({ ok: false, error: 'badtext here' });
    const error = readGenerateResponse(500, { error: 'x'.repeat(199) + '\u{1F431}tail' });
    expect(error).toEqual({ ok: false, error: 'x'.repeat(199) + '\u{1F431}' });
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: JOB_ID }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await requestGenerate('room-1', png);
    expect(result).toEqual({ ok: true, jobId: JOB_ID });
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

  it('returns ok:false when a 202 reply is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fine', { status: 202 })));
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

  // A fetch whose headers arrive (status 202) but whose body never finishes, until the signal aborts.
  const stallingBodyFetch = () =>
    vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve({
        status: 202,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      } as Response),
    );

  it('reports a timeout that fires while the body is still arriving, not "HTTP 202"', async () => {
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
