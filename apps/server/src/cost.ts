import { appendFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createLedger, type BudgetLimits } from './budget';

// One line in cost-log.jsonl per paid call. The cost meter, the eval and the budget rebuild at
// startup all read this log.
export type CostEntry = {
  ts: string;
  kind: 'vision' | 'image';
  model: string;
  roomId: string;
  inputTokens?: number;
  outputTokens?: number;
  usd: number;
  latencyMs: number;
  cacheHit: boolean;
  // false = the call failed. Its `usd` is then the reserved estimate: a call that timed out on our
  // side may still have finished and been billed on the provider's side.
  ok: boolean;
};

// What a paid call returns to the wrapper: its result, plus what it cost (worked out from the
// provider's usage numbers).
export type Paid<T> = { value: T; usd: number; inputTokens?: number; outputTokens?: number };

export type PaidCallInfo = {
  roomId: string;
  kind: CostEntry['kind'];
  model: string;
  // An upper bound for the cost, held before the call starts. For an image: its fixed price.
  // For a text call: the price of the input plus `max_tokens` of output.
  estimateUsd: number;
  // How long the call may take. The wrapper owns the timeout, so no call can hang forever and
  // keep its reservation and the room's lock held.
  timeoutMs: number;
};

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export class PaidCallTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The call took longer than ${timeoutMs} ms.`);
    this.name = 'PaidCallTimeoutError';
  }
}

// Runs `call` with an abort signal that fires after `timeoutMs`. Stops waiting at the timeout
// even if the call ignores its signal.
async function withTimeout<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timedOut = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(() => controller.abort(new PaidCallTimeoutError(timeoutMs)), timeoutMs);
  // `async` so a call that throws before returning a promise is caught like any other failure.
  const pending = (async () => call(controller.signal))();
  // After a timeout nobody waits for `pending`; a late rejection must not crash the process.
  pending.catch(() => {});
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export type CostTrackerOptions = { limits: BudgetLimits; logPath: string; now?: () => Date };

// A log line as read back at startup. Only what the budget needs; lines that don't fit are skipped.
const LoggedSpend = z.object({
  ts: z.string(),
  usd: z.number().nonnegative(),
  roomId: z.string().optional(), // lines written before chunk 2 have none
});

export function createCostTracker({ limits, logPath, now = () => new Date() }: CostTrackerOptions) {
  const ledger = createLedger(limits, now);

  // A failed log write must not throw away a result we already paid for. The in-memory budget
  // is still right; only a restart would miss this call, so say so loudly.
  async function log(entry: CostEntry): Promise<void> {
    try {
      await appendFile(logPath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error('Could not write to the cost log; a restart will undercount today.', error);
    }
  }

  // The one way to make a paid call (CLAUDE.md rule 3): check and hold the budget, make the call
  // (passing it an abort signal for the timeout), then count and log what it really cost.
  async function paidCall<T>(info: PaidCallInfo, call: (signal: AbortSignal) => Promise<Paid<T>>): Promise<T> {
    // Above 2^31-1 ms (about 24.8 days) Node's setTimeout fires after 1 ms instead.
    if (!Number.isFinite(info.timeoutMs) || info.timeoutMs <= 0 || info.timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError(`Not a valid timeout: ${info.timeoutMs}`);
    }
    // Before any await: throws BudgetExceededError and nothing is spent.
    const reservation = ledger.reserve(info.roomId, info.estimateUsd);
    const started = performance.now();
    const entry = (usd: number, ok: boolean, paid?: Paid<T>): CostEntry => ({
      ts: now().toISOString(),
      kind: info.kind,
      model: info.model,
      roomId: info.roomId,
      inputTokens: paid?.inputTokens,
      outputTokens: paid?.outputTokens,
      usd,
      latencyMs: Math.round(performance.now() - started),
      cacheHit: false,
      ok,
    });

    let paid: Paid<T>;
    try {
      paid = await withTimeout(info.timeoutMs, call);
    } catch (error) {
      // Includes a timeout. Keep the estimate as spent: better to overcount by a cent than to
      // undercount.
      ledger.settle(reservation, info.estimateUsd);
      await log(entry(info.estimateUsd, false));
      throw error;
    }

    let usd = paid.usd;
    if (!Number.isFinite(usd) || usd < 0) {
      // A bug in working out the price, not the provider's fault. Count the estimate rather than
      // lose a result we already paid for.
      console.error(`Invalid cost ${usd} for a ${info.kind} call; counting the estimate instead.`);
      usd = info.estimateUsd;
    }
    ledger.settle(reservation, usd);
    await log(entry(usd, true, paid));
    return paid.value;
  }

  // Adds today's spending from the log, so a restart doesn't reset the caps to zero.
  // Run it once at startup, before the server takes requests. `counted` = today's lines added,
  // `skipped` = lines that could not be read.
  async function loadToday(): Promise<{ counted: number; skipped: number }> {
    let text: string;
    try {
      text = await readFile(logPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { counted: 0, skipped: 0 }; // no log yet
      throw error; // unreadable log: better not to start than to start with the caps at zero
    }
    // A crash mid-write leaves a last line with no newline. The next entry would be glued onto it,
    // and both would be lost as one unreadable line. End the torn line first.
    if (text !== '' && !text.endsWith('\n')) await appendFile(logPath, '\n');
    let counted = 0;
    let skipped = 0;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const parsed = LoggedSpend.safeParse(parseJson(line));
      const at = parsed.success ? new Date(parsed.data.ts) : null;
      if (!parsed.success || !at || Number.isNaN(at.getTime())) {
        skipped += 1;
        continue;
      }
      if (ledger.record(at, parsed.data.usd, parsed.data.roomId)) counted += 1; // today's lines only
    }
    return { counted, skipped };
  }

  return { paidCall, loadToday, spentUsd: ledger.spentUsd };
}

export type CostTracker = ReturnType<typeof createCostTracker>;

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null; // e.g. a line cut short when the server stopped mid-write
  }
}
