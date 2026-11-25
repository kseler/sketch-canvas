import { asRecord, capChars, cleanText } from './brief';

// Talks to POST /api/generate. The server holds the API keys and makes the paid calls; the browser
// only sends the sketch.

// The answer says only that the job started. How it goes (running, done, failed) reaches every tab
// in the room through the shared document (lib/jobs.ts), not through this reply, so everyone sees
// the same thing as the person who clicked.
export type GenerateResult = { ok: true; jobId: string } | { ok: false; error: string };

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

// The response is read defensively: a proxy error page or a crashed server must not break the UI.
export function readGenerateResponse(status: number, body: unknown): GenerateResult {
  const b = asRecord(body);
  // 202 Accepted: the server took the job. Its id is ours to compare, never shown.
  if (status === 202 && typeof b.jobId === 'string' && b.jobId.length > 0 && b.jobId.length <= 64) {
    return { ok: true, jobId: b.jobId };
  }
  const error = status >= 400 ? cleanText(b.error) : null;
  return { ok: false, error: error ? capChars(error, 200) : `Generate failed (HTTP ${status}).` };
}

// A hung server must not leave the Generate button disabled forever. The server answers as soon as
// it has checked the sketch and started the job (the AI calls run after the answer), so this only
// covers uploading up to 1 MB and the checks.
export const REQUEST_TIMEOUT_MS = 30_000;

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
