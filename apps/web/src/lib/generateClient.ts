// Talks to POST /api/generate. The server holds the API keys and makes the paid calls; the browser
// only sends the sketch and shows what comes back.

// The brief the server's vision step wrote for the sketch (later chunks add the image and a job id).
export type Brief = { subject: string; style: string; mood: string; palette: string[]; composition: string };

export type GenerateResult = { ok: true; brief: Brief } | { ok: false; error: string };

// The PNG as base64 without the "data:image/png;base64," prefix.
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the sketch.'));
    reader.readAsDataURL(blob);
  });
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
// Invisible characters: format characters (bidi controls like U+202E that visually reorder a line,
// zero-width characters, soft hyphens, invisible "tag" characters), control characters (newlines,
// tabs) and line/paragraph separators. Text drawn on the canvas can steer the model into writing
// them, and the brief is shown as one line.
const INVISIBLE = /[\p{Cf}\p{Cc}\u2028\u2029]/gu;

// Display text from the server, capped: the server validates the brief, but the browser doesn't
// assume it (a proxy or an older server could answer anything). 300 = the server's longest brief
// field (BRIEF_LIMITS.composition in apps/server/src/brief.ts, which the web app can't import).
function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v.replace(INVISIBLE, '').trim();
  // By code point, not UTF-16 unit, so the cap never splits an emoji in half.
  return text === '' ? null : Array.from(text).slice(0, 300).join('');
}

function readBrief(value: unknown): Brief | null {
  const b = asRecord(value);
  const subject = cleanText(b.subject);
  const style = cleanText(b.style);
  const mood = cleanText(b.mood);
  const composition = cleanText(b.composition);
  const palette = Array.isArray(b.palette) ? b.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [];
  if (!subject || !style || !mood || !composition) return null;
  return { subject, style, mood, palette, composition };
}

// The response is read defensively: a proxy error page or a crashed server must not break the UI.
export function readGenerateResponse(status: number, body: unknown): GenerateResult {
  const b = asRecord(body);
  const brief = status >= 200 && status < 300 ? readBrief(b.brief) : null;
  if (brief) return { ok: true, brief };
  const error = typeof b.error === 'string' ? b.error.slice(0, 200) : `Generate failed (HTTP ${status}).`;
  return { ok: false, error };
}

// A hung server must not leave the Generate button disabled forever. Longer than the server's own
// 30 s limit on the AI call, so the server's clearer error arrives first.
export const REQUEST_TIMEOUT_MS = 45_000;

// Why the request stopped early, or null if it wasn't stopped. The timeout is checked first, so a
// caller's cancel that happens after the timeout still reads as a timeout.
function stoppedResult(timeout: AbortSignal, signal?: AbortSignal): GenerateResult | null {
  if (timeout.aborted) return { ok: false, error: 'The server took too long to answer.' };
  if (signal?.aborted) return { ok: false, error: 'Cancelled.' };
  return null;
}

// `signal` lets a caller cancel the request (later: a newer job replacing an older one); the
// timeout applies either way.
export async function requestGenerate(roomId: string, png: Blob, signal?: AbortSignal): Promise<GenerateResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, image: await blobToBase64(png) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // A body that isn't JSON (a proxy's HTML error page, an empty reply) becomes null, so the
    // status code can still explain what went wrong.
    const body: unknown = await res.json().catch(() => null);
    // The timeout or a cancel can also fire while the body is still arriving; that .catch would
    // swallow it, so check here, or the user sees "HTTP 200" instead of the real reason.
    return stoppedResult(timeout, signal) ?? readGenerateResponse(res.status, body);
  } catch {
    return stoppedResult(timeout, signal) ?? { ok: false, error: 'Could not reach the server.' };
  }
}
