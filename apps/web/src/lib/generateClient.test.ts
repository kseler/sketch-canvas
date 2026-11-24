// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToBase64, readGenerateResponse, REQUEST_TIMEOUT_MS, requestGenerate } from './generateClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const brief = { subject: 'a cat on a hill', style: 'watercolor', mood: 'calm', palette: ['#3a7bd5', '#f5d76e'], composition: 'cat centered', lettering: '' };
const okBody = { brief };

describe('readGenerateResponse', () => {
  it('reads a 2xx reply with a brief as ok', () => {
    expect(readGenerateResponse(200, okBody)).toEqual({ ok: true, brief, picture: false });
  });

  it.each([
    ['no brief', {}],
    ['a missing subject', { brief: { ...brief, subject: undefined } }],
    ['an empty style', { brief: { ...brief, style: '   ' } }],
    ['a numeric mood', { brief: { ...brief, mood: 5 } }],
    ['a missing composition', { brief: { ...brief, composition: undefined } }],
    ['a brief that is an array', { brief: [] }],
    ['null body', null],
    ['string body', 'ok'],
    ['array body', []],
  ])('is an error for a 2xx reply with %s', (_label, body) => {
    expect(readGenerateResponse(200, body).ok).toBe(false);
  });

  it('keeps only palette entries that are #rrggbb colors, at most six', () => {
    const palette = ['#000000', 'red', 'url(x)', 7, '#ABCDEF', '#1', '#111111', '#222222', '#333333', '#444444', '#555555'];
    const result = readGenerateResponse(200, { brief: { ...brief, palette } });
    expect(result).toEqual({ ok: true, brief: { ...brief, palette: ['#000000', '#ABCDEF', '#111111', '#222222', '#333333', '#444444'] }, picture: false });
  });

  it('removes bidirectional-text controls that could reorder the line', () => {
    const result = readGenerateResponse(200, { brief: { ...brief, subject: 'cat\u202Etxt.exe\u2066x\u2069' } });
    expect(result.ok && result.brief.subject).toBe('cattxt.exex');
  });

  it('removes zero-width, tag and soft-hyphen characters, and turns line breaks into spaces (like the server)', () => {
    const subject = 'a\u061Cb\u200Bc\u{E0041}d\u00ADe\nf\u2028g';
    const result = readGenerateResponse(200, { brief: { ...brief, subject } });
    expect(result.ok && result.brief.subject).toBe('abcde f g');
  });

  it('turns control characters that are not whitespace (escape, bell) into spaces', () => {
    const result = readGenerateResponse(200, { brief: { ...brief, subject: 'a\u001Bb\u0007c' } });
    expect(result.ok && result.brief.subject).toBe('a b c');
  });

  it('cleans like the server: folds fullwidth lookalikes and removes blank filler letters', () => {
    const result = readGenerateResponse(200, { brief: { ...brief, subject: 'ＦＲＥＥ\u3164 cat' } });
    expect(result.ok && result.brief.subject).toBe('FREE cat');
  });

  it('never splits a character when capping the lettering', () => {
    // U+20000 is a CJK letter outside the basic plane (two UTF-16 units) that NFKC leaves alone.
    const lettering = 'a'.repeat(23) + '\u{20000}' + 'b';
    const result = readGenerateResponse(200, { brief: { ...brief, lettering } });
    expect(result.ok && result.brief.lettering).toBe('a'.repeat(23) + '\u{20000}');
  });

  it('never splits an emoji when capping', () => {
    const subject = 'x'.repeat(299) + '\u{1F431}' + 'tail';
    const result = readGenerateResponse(200, { brief: { ...brief, subject } });
    expect(result.ok && Array.from(result.brief.subject)).toHaveLength(300);
    expect(result.ok && result.brief.subject.endsWith('\u{1F431}')).toBe(true);
  });

  it('caps long brief text at 300 characters', () => {
    const result = readGenerateResponse(200, { brief: { ...brief, subject: 's'.repeat(1000) } });
    expect(result.ok && result.brief.subject.length).toBe(300);
  });

  describe('lettering', () => {
    const letter = (lettering: unknown) => {
      const result = readGenerateResponse(200, { brief: { ...brief, lettering } });
      return result.ok ? result.brief.lettering : null;
    };

    it('keeps lettering as sent', () => {
      expect(letter('OPEN')).toBe('OPEN');
    });

    it('becomes an empty string when missing', () => {
      const { lettering: _omit, ...withoutLettering } = brief;
      const result = readGenerateResponse(200, { brief: withoutLettering });
      expect(result).toEqual({ ok: true, brief: { ...brief, lettering: '' }, picture: false });
    });

    it.each([[5], [null], [{}], [['a']], [true]])('becomes an empty string for non-string %j', (value) => {
      expect(letter(value)).toBe('');
    });

    it('removes invisible characters and trims', () => {
      expect(letter('  OP\u200BEN\u202E \n')).toBe('OPEN');
    });

    it('caps at 24 characters (the server limit)', () => {
      expect(letter('a'.repeat(25))).toBe('a'.repeat(24));
      expect(letter('a'.repeat(24))).toBe('a'.repeat(24));
    });

    it('does not make the brief fail when lettering is bad', () => {
      expect(readGenerateResponse(200, { brief: { ...brief, lettering: 5 } }).ok).toBe(true);
    });
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
    expect(result).toEqual({ ok: true, brief, picture: false });
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

describe('picture flag', () => {
  it('is true when the reply carries an image record, false otherwise', () => {
    expect(readGenerateResponse(200, { brief, image: { id: 'x' } })).toMatchObject({ ok: true, picture: true });
    expect(readGenerateResponse(200, { brief, image: null })).toMatchObject({ ok: true, picture: false });
    expect(readGenerateResponse(200, { brief })).toMatchObject({ ok: true, picture: false });
  });
});
