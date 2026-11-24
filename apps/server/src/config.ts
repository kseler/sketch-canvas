import { z } from 'zod';
import type { BudgetLimits } from './budget';

// Budget settings from the environment (.env at the repo root, see .env.example). A typo such as
// DAILY_BUDGET_USD=2,00 must stop the server at startup, not quietly turn the cap into NaN or 0.
// The upper bound catches a slip like 200 or 2e3; the provider's hard spend limit is the backstop.
const MAX_BUDGET_USD = 50;
const BudgetEnv = z.object({
  DAILY_BUDGET_USD: z.coerce.number().positive().max(MAX_BUDGET_USD).default(2),
  ROOM_BUDGET_USD: z.coerce.number().positive().max(MAX_BUDGET_USD).default(0.5),
});

export function readBudgetLimits(env: Record<string, string | undefined>): BudgetLimits {
  const parsed = BudgetEnv.safeParse({
    // An empty value (`ROOM_BUDGET_USD=`) means "use the default", like a missing one.
    DAILY_BUDGET_USD: env.DAILY_BUDGET_USD || undefined,
    ROOM_BUDGET_USD: env.ROOM_BUDGET_USD || undefined,
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(
      `Invalid budget setting in the environment: ${names}. Use a positive number of dollars up to ${MAX_BUDGET_USD}, e.g. 2.00.`,
    );
  }
  return { dailyUsd: parsed.data.DAILY_BUDGET_USD, roomDailyUsd: parsed.data.ROOM_BUDGET_USD };
}

// The web app's address in local development (Vite).
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'];

// ALLOWED_ORIGINS: comma-separated web addresses whose pages may call the API from a browser,
// e.g. "https://sketch.example.com,http://localhost:5173". Each must be a bare origin
// (scheme + host + optional port, no path): that is what the browser sends in its Origin header,
// and anything else would never match.
export function readAllowedOrigins(env: Record<string, string | undefined>): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS]; // a copy, so no caller can change the default
  return raw.split(',').map((entry) => {
    const value = entry.trim();
    let origin: string | null = null;
    try {
      origin = new URL(value).origin;
    } catch {
      // not a URL at all
    }
    if (!origin || origin === 'null' || origin !== value) {
      throw new Error(`Invalid entry in ALLOWED_ORIGINS: "${value}". Use e.g. https://sketch.example.com (no path, no trailing slash).`);
    }
    return origin;
  });
}
