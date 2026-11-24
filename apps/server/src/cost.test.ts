import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExceededError } from './budget';
import { createCostTracker, PaidCallTimeoutError, type CostEntry } from './cost';

const NOW = new Date('2026-11-24T12:00:00Z');
const now = () => NOW;
const limits = { dailyUsd: 1, roomDailyUsd: 0.5 };
const info = { roomId: 'room-1', kind: 'image' as const, model: 'test-model', estimateUsd: 0.02, timeoutMs: 1000 };

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cost-test-'));
  logPath = path.join(dir, 'cost-log.jsonl');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const tracker = (overrides: Partial<Parameters<typeof createCostTracker>[0]> = {}) =>
  createCostTracker({ limits, logPath, now, ...overrides });

async function readLog(): Promise<CostEntry[]> {
  const text = await readFile(logPath, 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line) as CostEntry);
}

describe('paidCall', () => {
  it('refuses before calling when over budget', async () => {
    const t = tracker({ limits: { dailyUsd: 0.01, roomDailyUsd: 0.01 } });
    const call = vi.fn();
    await expect(t.paidCall(info, call)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(call).not.toHaveBeenCalled();
    expect(t.spentUsd()).toBe(0);
  });

  it('returns the value of the call', async () => {
    const t = tracker();
    const value = await t.paidCall(info, async () => ({ value: 'png', usd: 0.017 }));
    expect(value).toBe('png');
  });

  it('logs one line with the real cost and call details', async () => {
    const t = tracker();
    await t.paidCall(info, async () => ({ value: 1, usd: 0.017, inputTokens: 10, outputTokens: 20 }));
    const lines = await readLog();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      ts: NOW.toISOString(),
      kind: 'image',
      model: 'test-model',
      roomId: 'room-1',
      inputTokens: 10,
      outputTokens: 20,
      usd: 0.017,
      cacheHit: false,
      ok: true,
    });
    expect(lines[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(t.spentUsd()).toBe(0.017);
    expect(t.spentUsd('room-1')).toBe(0.017);
  });

  it('rethrows the same error, keeps the estimate as spent and logs ok false', async () => {
    const t = tracker();
    const boom = new Error('provider down');
    await expect(t.paidCall(info, async () => { throw boom; })).rejects.toBe(boom);
    expect(t.spentUsd()).toBe(0.02);
    const lines = await readLog();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ok: false, usd: 0.02, roomId: 'room-1' });
  });

  it.each([
    ['NaN', NaN],
    ['negative', -0.5],
    ['Infinity', Infinity],
  ])('returns the value and counts the estimate when the call reports %s', async (_label, usd) => {
    const t = tracker();
    const value = await t.paidCall(info, async () => ({ value: 'kept', usd }));
    expect(value).toBe('kept');
    expect(t.spentUsd()).toBe(0.02);
    const lines = await readLog();
    expect(lines[0]).toMatchObject({ usd: 0.02, ok: true });
  });

  it('still returns the result when the log cannot be written', async () => {
    const t = tracker({ logPath: path.join(dir, 'missing-dir', 'cost-log.jsonl') });
    const value = await t.paidCall(info, async () => ({ value: 'kept', usd: 0.017 }));
    expect(value).toBe('kept');
    expect(t.spentUsd()).toBe(0.017);
    expect(console.error).toHaveBeenCalled();
  });

  it('still rethrows the call error when the log cannot be written', async () => {
    const t = tracker({ logPath: path.join(dir, 'missing-dir', 'cost-log.jsonl') });
    const boom = new Error('provider down');
    await expect(t.paidCall(info, async () => { throw boom; })).rejects.toBe(boom);
  });

  it('runs only one of two simultaneous calls when only one fits', async () => {
    const t = tracker({ limits: { dailyUsd: 0.03, roomDailyUsd: 0.03 } });
    const call = vi.fn(async () => ({ value: 'ok', usd: 0.02 }));
    const results = await Promise.allSettled([t.paidCall(info, call), t.paidCall(info, call)]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BudgetExceededError);
  });

  it('holds the estimate while the call is still running', async () => {
    const t = tracker();
    let finish!: () => void;
    const pending = t.paidCall(info, () => new Promise<{ value: number; usd: number }>((resolve) => {
      finish = () => resolve({ value: 1, usd: 0.01 });
    }));
    expect(t.spentUsd()).toBe(0.02);
    finish();
    await pending;
    expect(t.spentUsd()).toBe(0.01);
  });
});

describe('loadToday', () => {
  const line = (fields: Record<string, unknown>) => JSON.stringify(fields);

  it('returns zero when there is no log file yet', async () => {
    const t = tracker();
    expect(await t.loadToday()).toEqual({ counted: 0, skipped: 0 });
    expect(t.spentUsd()).toBe(0);
  });

  it('counts only today, globally and per room', async () => {
    await writeFile(logPath, [
      line({ ts: '2026-11-24T01:00:00Z', usd: 0.1, roomId: 'a' }),
      line({ ts: '2026-11-24T02:00:00Z', usd: 0.2, roomId: 'b' }),
      line({ ts: '2026-11-23T23:59:59Z', usd: 0.4, roomId: 'a' }),
      line({ ts: '2026-11-25T00:00:00Z', usd: 0.4, roomId: 'a' }),
    ].join('\n') + '\n');
    const t = tracker();
    expect(await t.loadToday()).toEqual({ counted: 2, skipped: 0 }); // other days are not counted
    expect(t.spentUsd()).toBe(0.3); // exact: whole micro-dollars, no float drift
    expect(t.spentUsd('a')).toBe(0.1);
    expect(t.spentUsd('b')).toBe(0.2);
  });

  it('counts a line without roomId globally only', async () => {
    await writeFile(logPath, line({ ts: '2026-11-24T01:00:00Z', usd: 0.1 }) + '\n');
    const t = tracker();
    expect(await t.loadToday()).toEqual({ counted: 1, skipped: 0 });
    expect(t.spentUsd()).toBe(0.1);
    expect(t.spentUsd('a')).toBe(0);
  });

  it('skips and reports malformed, half-written, bad-ts and negative lines', async () => {
    await writeFile(logPath, [
      line({ ts: '2026-11-24T01:00:00Z', usd: 0.1, roomId: 'a' }),
      'not json',
      line({ ts: 'yesterday-ish', usd: 0.1, roomId: 'a' }),
      line({ ts: '2026-11-24T01:00:00Z', usd: -0.1, roomId: 'a' }),
      line({ ts: '2026-11-24T01:00:00Z', usd: 'free', roomId: 'a' }),
      line({ usd: 0.1 }),
      '',
      '{"ts":"2026-11-24T03:00:00Z","usd":0.0', // cut off mid-write, no newline
    ].join('\n'));
    const t = tracker();
    expect(await t.loadToday()).toEqual({ counted: 1, skipped: 6 });
    expect(t.spentUsd()).toBe(0.1);
  });

  it('makes the caps see spending from before a restart', async () => {
    await writeFile(logPath, line({ ts: '2026-11-24T01:00:00Z', usd: 0.5, roomId: info.roomId }) + '\n');
    const t = tracker();
    await t.loadToday();
    const call = vi.fn();
    await expect(t.paidCall(info, call)).rejects.toMatchObject({ scope: 'room' });
    expect(call).not.toHaveBeenCalled();
  });

  it('throws when the log path is a directory instead of starting with caps at zero', async () => {
    const folder = path.join(dir, 'a-folder');
    await mkdir(folder);
    await expect(tracker({ logPath: folder }).loadToday()).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

describe('paidCall timeout', () => {
  it('gives up after timeoutMs, aborts the call, keeps the estimate and logs ok:false', async () => {
    const t = tracker();
    let seen: AbortSignal | undefined;
    const call = (signal: AbortSignal) => {
      seen = signal;
      return new Promise<{ value: number; usd: number }>(() => {}); // never answers, ignores the signal
    };
    await expect(t.paidCall({ ...info, timeoutMs: 20 }, call)).rejects.toBeInstanceOf(PaidCallTimeoutError);
    expect(seen?.aborted).toBe(true);
    expect(t.spentUsd()).toBe(0.02);
    const [entry] = await readLog();
    expect(entry).toMatchObject({ ok: false, usd: 0.02 });
  });

  it('does not fire for a call that answers in time', async () => {
    const t = tracker();
    let seen: AbortSignal | undefined;
    const value = await t.paidCall({ ...info, timeoutMs: 1000 }, async (signal) => {
      seen = signal;
      return { value: 'ok', usd: 0.01 };
    });
    expect(value).toBe('ok');
    expect(seen?.aborted).toBe(false);
  });

  it('treats a call that throws before returning a promise as a failed call', async () => {
    const t = tracker();
    const boom = new Error('sync boom');
    const call = (() => { throw boom; }) as unknown as () => Promise<{ value: number; usd: number }>;
    await expect(t.paidCall(info, call)).rejects.toBe(boom);
    expect(t.spentUsd()).toBe(0.02);
  });

  it.each([0, -1, NaN, Infinity, 2 ** 31])('refuses a timeout of %s before reserving anything', async (timeoutMs) => {
    const t = tracker();
    const call = vi.fn();
    await expect(t.paidCall({ ...info, timeoutMs }, call)).rejects.toBeInstanceOf(RangeError);
    expect(call).not.toHaveBeenCalled();
    expect(t.spentUsd()).toBe(0);
  });
});

describe('loadToday repairs a torn last line', () => {
  it('keeps the next entry readable after a crash mid-write', async () => {
    await writeFile(logPath, '{"ts":"2026-11-24T01:00:00Z","usd":0.0'); // cut off, no newline
    const first = tracker();
    expect(await first.loadToday()).toEqual({ counted: 0, skipped: 1 });
    await first.paidCall(info, async () => ({ value: 1, usd: 0.017 }));
    const afterRestart = tracker();
    expect(await afterRestart.loadToday()).toEqual({ counted: 1, skipped: 1 });
    expect(afterRestart.spentUsd()).toBe(0.017);
  });
});
