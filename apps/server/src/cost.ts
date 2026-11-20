import { appendFile } from 'node:fs/promises';

// One entry per paid call. Every vision or image call must be logged here; the eval and the
// cost meter in the UI both read this log.
export type CostEntry = {
  ts: string;
  kind: 'vision' | 'image';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  usd: number;
  latencyMs: number;
  cacheHit: boolean;
};

export async function logCost(entry: CostEntry): Promise<void> {
  await appendFile('cost-log.jsonl', `${JSON.stringify(entry)}\n`);
}
