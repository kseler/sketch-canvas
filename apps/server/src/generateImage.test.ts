import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExceededError } from './budget';
import { createCostTracker, NotBilledError, PaidCallTimeoutError, type CostEntry } from './cost';
import {
  createGenerateImage,
  IMAGE_MODEL,
  IMAGE_SIZE,
  IMAGE_TIMEOUT_MS,
  ImageBlockedError,
  InvalidImageError,
  isImageNotBilled,
  MAX_PROMPT_BYTES,
  openAiImageClient,
  readGeneratedImage,
  type ImageClient,
  type ImageTier,
} from './generateImage';
import { imageCostUsd } from './pricing';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function pngBytes(width: number, height: number): Buffer {
  return Buffer.from([...SIGNATURE, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height), 8, 0, 0, 0, 0, 0, 0, 0, 0]);
}
const pngBase64 = (width: number, height: number) => pngBytes(width, height).toString('base64');

type Usage = { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details?: { text_tokens: number; image_tokens: number } };
const usage = (text: number, output: number): Usage => ({
  input_tokens: text,
  output_tokens: output,
  total_tokens: text + output,
  input_tokens_details: { text_tokens: text, image_tokens: 0 },
});
const reply = (b64: unknown, u: Usage = usage(300, 563)) => ({ created: 1, data: b64 === undefined ? [] : [{ b64_json: b64 }], usage: u }) as unknown as OpenAI.ImagesResponse;
const goodReply = (u: Usage = usage(300, 563)) => reply(pngBase64(1024, 768), u);

const apiError = (status: number, body?: object) => new OpenAI.APIError(status, body, 'nope', new Headers());

const limits = { dailyUsd: 1, roomDailyUsd: 0.5 };
let dir: string;
let logPath: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'generate-image-test-'));
  logPath = path.join(dir, 'cost-log.jsonl');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function setup(generate: ImageClient['generate'], overrides: { dailyUsd?: number; roomDailyUsd?: number } = {}) {
  const client = { generate: vi.fn(generate) };
  const costs = createCostTracker({ limits: { ...limits, ...overrides }, logPath, now: () => new Date('2026-11-24T12:00:00Z') });
  return { client, costs, generateImage: createGenerateImage({ client, costs }) };
}
async function readLog(): Promise<CostEntry[]> {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text.trim() === '' ? [] : text.trim().split('\n').map((line) => JSON.parse(line) as CostEntry);
}
const estimateFor = (tier: ImageTier, max: Record<ImageTier, number>) =>
  imageCostUsd(IMAGE_MODEL, { textInputTokens: MAX_PROMPT_BYTES, imageInputTokens: 0, outputTokens: max[tier] });
const request = { roomId: 'room-1', prompt: 'a cat on a hill', tier: 'low' as ImageTier };

describe('createGenerateImage request', () => {
  it('sends the fixed model, size, tier, complexity, format, count and moderation setting', async () => {
    const s = setup(async () => goodReply());
    await s.generateImage({ ...request, tier: 'medium' });
    expect(s.client.generate).toHaveBeenCalledTimes(1);
    const [body, signal] = s.client.generate.mock.calls[0]!;
    expect(body).toEqual({
      model: 'gpt-image-2.6-flare',
      prompt: request.prompt,
      size: '1024x768',
      quality: 'medium',
      complexity: 'medium',
      output_format: 'png',
      n: 1,
      moderation: 'auto',
    });
    expect(IMAGE_MODEL).toBe('gpt-image-2.6-flare');
    expect(IMAGE_SIZE).toBe('1024x768');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the decoded PNG and its real size', async () => {
    const s = setup(async () => goodReply());
    const picture = await s.generateImage(request);
    expect(picture.width).toBe(1024);
    expect(picture.height).toBe(768);
    expect(Buffer.from(picture.png).equals(pngBytes(1024, 768))).toBe(true);
  });

  it('refuses image-to-image, which is not built, without calling the client or reserving money', async () => {
    const s = setup(async () => goodReply());
    await expect(s.generateImage({ ...request, image: new Uint8Array([1]) })).rejects.toThrow();
    expect(s.client.generate).not.toHaveBeenCalled();
    expect(s.costs.spentUsd()).toBe(0);
    expect(await readLog()).toEqual([]);
  });

  it('accepts a prompt of exactly MAX_PROMPT_BYTES', async () => {
    const s = setup(async () => goodReply());
    await expect(s.generateImage({ ...request, prompt: 'a'.repeat(MAX_PROMPT_BYTES) })).resolves.toBeDefined();
  });

  it.each([
    ['one byte too long', 'a'.repeat(MAX_PROMPT_BYTES + 1)],
    ['short in characters but long in bytes', '\u{1F600}'.repeat(MAX_PROMPT_BYTES / 4 + 1)],
  ])('rejects a prompt %s with a RangeError, before reserving or calling', async (_label, prompt) => {
    const s = setup(async () => goodReply());
    await expect(s.generateImage({ ...request, prompt })).rejects.toBeInstanceOf(RangeError);
    expect(s.client.generate).not.toHaveBeenCalled();
    expect(s.costs.spentUsd()).toBe(0);
    expect(await readLog()).toEqual([]);
  });

  it('never calls the client when the budget is exceeded', async () => {
    const s = setup(async () => goodReply(), { dailyUsd: 0.001, roomDailyUsd: 0.001 });
    await expect(s.generateImage(request)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(s.client.generate).not.toHaveBeenCalled();
  });
});

describe('createGenerateImage cost', () => {
  const MAX_OUTPUT: Record<ImageTier, number> = { low: 720, medium: 1_250, high: 1_520 };

  it.each([
    ['low', 720],
    ['medium', 1_250],
    ['high', 1_520],
  ] as const)('reserves at least the real cost of a worst-case %s picture (2,000 text tokens, max output): no overshoot warning', async (tier, maxOut) => {
    const s = setup(async () => goodReply(usage(MAX_PROMPT_BYTES, maxOut)));
    await s.generateImage({ ...request, tier });
    expect(console.warn).not.toHaveBeenCalled();
    const [entry] = await readLog();
    expect(entry!.usd).toBeCloseTo(imageCostUsd(IMAGE_MODEL, { textInputTokens: MAX_PROMPT_BYTES, imageInputTokens: 0, outputTokens: maxOut }), 10);
    expect(entry!.usd).toBeLessThanOrEqual(estimateFor(tier, MAX_OUTPUT) + 1e-9);
  });

  it('logs an image cost line with the real cost worked out from the reported usage', async () => {
    const s = setup(async () => goodReply(usage(1000, 600)));
    await s.generateImage(request);
    const [entry] = await readLog();
    expect(entry).toMatchObject({ kind: 'image', model: IMAGE_MODEL, roomId: 'room-1', ok: true, inputTokens: 1000, outputTokens: 600 });
    expect(entry!.usd).toBeCloseTo((1000 * 5 + 600 * 30) / 1e6, 10);
    expect(s.costs.spentUsd('room-1')).toBeCloseTo(entry!.usd, 10);
  });

  it('prices image input tokens at their own rate', async () => {
    const u = { ...usage(100, 500), input_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 200 } };
    const s = setup(async () => goodReply(u));
    await s.generateImage(request);
    const [entry] = await readLog();
    expect(entry!.usd).toBeCloseTo(imageCostUsd(IMAGE_MODEL, { textInputTokens: 100, imageInputTokens: 200, outputTokens: 500 }), 10);
  });

  it('counts all input tokens as text when the reply has no breakdown', async () => {
    const u = { input_tokens: 400, output_tokens: 500, total_tokens: 900 } as Usage;
    const s = setup(async () => goodReply(u));
    await s.generateImage(request);
    const [entry] = await readLog();
    expect(entry!.usd).toBeCloseTo(imageCostUsd(IMAGE_MODEL, { textInputTokens: 400, imageInputTokens: 0, outputTokens: 500 }), 10);
  });

  it('counts the estimate, and says so, when the reply has no usage', async () => {
    const noUsage = { created: 1, data: [{ b64_json: pngBase64(1024, 768) }] } as unknown as OpenAI.ImagesResponse;
    const s = setup(async () => noUsage);
    await expect(s.generateImage(request)).resolves.toBeDefined();
    const [entry] = await readLog();
    expect(entry!.usd).toBeCloseTo(estimateFor('low', { low: 720, medium: 1_250, high: 1_520 }), 10);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('createGenerateImage errors', () => {
  it.each([401, 403, 404, 429])('treats HTTP %i as not billed: NotBilledError and $0 counted', async (status) => {
    const s = setup(() => Promise.reject(apiError(status)));
    const error = await s.generateImage(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotBilledError);
    expect((error as NotBilledError).status).toBe(status);
    expect(s.costs.spentUsd()).toBe(0);
    const [entry] = await readLog();
    expect(entry).toMatchObject({ usd: 0, ok: false });
  });

  it('turns the image service moderation block into ImageBlockedError and keeps the estimate', async () => {
    const blocked = apiError(400, { code: 'moderation_blocked' });
    expect(blocked.code).toBe('moderation_blocked'); // the SDK sets .code from the body
    const s = setup(() => Promise.reject(blocked));
    const error = await s.generateImage(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageBlockedError);
    expect((error as Error).cause).toBe(blocked);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
    const [entry] = await readLog();
    expect(entry!.usd).toBeGreaterThan(0);
    expect(entry!.ok).toBe(false);
  });

  it('keeps the estimate for other 400s (a hostile prompt may still be billed)', async () => {
    const bad = apiError(400, { code: 'invalid_value' });
    const s = setup(() => Promise.reject(bad));
    await expect(s.generateImage(request)).rejects.toBe(bad);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
  });

  it('rethrows a 500 unchanged and keeps the estimate', async () => {
    const boom = apiError(500);
    const s = setup(() => Promise.reject(boom));
    await expect(s.generateImage(request)).rejects.toBe(boom);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
    const [entry] = await readLog();
    expect(entry!.ok).toBe(false);
  });

  it('rethrows a non-API error (e.g. a dropped connection) and keeps the estimate', async () => {
    const boom = new TypeError('fetch failed');
    const s = setup(() => Promise.reject(boom));
    await expect(s.generateImage(request)).rejects.toBe(boom);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
  });

  it.each([
    ['not base64', reply('not base64!!')],
    ['base64 of something that is not a PNG', reply(Buffer.from('hello hello hello hello hello hello').toString('base64'))],
    ['a missing data entry', reply(undefined)],
    ['a null b64_json', reply(null)],
    ['a numeric b64_json', reply(5)],
    ['a width above 4096', reply(pngBase64(4097, 768))],
    ['a height above 4096', reply(pngBase64(1024, 4097))],
    ['a zero width', reply(pngBase64(0, 768))],
    ['a b64_json over the size limit', reply('A'.repeat(14_000_000))],
  ])('throws InvalidImageError for %s, but the cost is still counted', async (_label, response) => {
    const s = setup(async () => response);
    await expect(s.generateImage(request)).rejects.toBeInstanceOf(InvalidImageError);
    const [entry] = await readLog();
    expect(entry).toMatchObject({ ok: true, kind: 'image' });
    expect(entry!.usd).toBeGreaterThan(0);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
  });

  it('times out at IMAGE_TIMEOUT_MS with PaidCallTimeoutError, aborts the signal and keeps the estimate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let seen: AbortSignal | undefined;
    const s = setup((_body, signal) => {
      seen = signal;
      return new Promise<OpenAI.ImagesResponse>(() => {});
    });
    const outcome = s.generateImage(request).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS - 1);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(PaidCallTimeoutError);
    expect((error as PaidCallTimeoutError).timeoutMs).toBe(IMAGE_TIMEOUT_MS);
    expect(seen?.aborted).toBe(true);
    expect(s.costs.spentUsd()).toBeGreaterThan(0);
  });
});

describe('isImageNotBilled', () => {
  it.each([401, 403, 404, 429])('returns the status for %i', (status) => {
    expect(isImageNotBilled(apiError(status))).toBe(status);
  });
  it.each([400, 402, 408, 500, 502, 529])('returns null for %i (may be billed, or not ours to excuse)', (status) => {
    expect(isImageNotBilled(apiError(status))).toBeNull();
  });
  it.each([['a plain Error', new Error('x')], ['a string', 'x'], ['null', null], ['an API error without a status', new OpenAI.APIConnectionError({})]])(
    'returns null for %s',
    (_label, error) => {
      expect(isImageNotBilled(error)).toBeNull();
    },
  );
});

describe('readGeneratedImage', () => {
  it('reads a valid PNG reply', () => {
    const picture = readGeneratedImage(reply(pngBase64(1024, 768)));
    expect(picture).toMatchObject({ width: 1024, height: 768 });
  });
  it('accepts the side limit exactly', () => {
    expect(readGeneratedImage(reply(pngBase64(4096, 4096)))).toMatchObject({ width: 4096, height: 4096 });
  });
  it('returns null when there is no data at all', () => {
    expect(readGeneratedImage({} as Pick<OpenAI.ImagesResponse, 'data'>)).toBeNull();
  });
});

describe('openAiImageClient', () => {
  it('passes the body, the signal and maxRetries 0 to images.generate', async () => {
    const response = goodReply();
    const generate = vi.fn(async () => response);
    const client = openAiImageClient({ images: { generate } } as unknown as OpenAI);
    const signal = new AbortController().signal;
    const body = { model: IMAGE_MODEL, prompt: 'p' } as unknown as OpenAI.ImageGenerateParamsNonStreaming;
    expect(await client.generate(body, signal)).toBe(response);
    expect(generate).toHaveBeenCalledWith(body, { signal, maxRetries: 0 });
  });
});

describe('not-billed errors carry the provider code', () => {
  it('passes OpenAI\'s code through, so "no credit" and "rate limited" can be told apart in the log', async () => {
    const s = setup(() => Promise.reject(new OpenAI.APIError(429, { code: 'insufficient_quota' }, 'quota', new Headers())));
    const error = await s.generateImage(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotBilledError);
    expect((error as NotBilledError).code).toBe('insufficient_quota');
  });
});
