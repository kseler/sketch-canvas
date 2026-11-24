// Daily spending limits, kept in memory. A "day" is a UTC calendar day, so the budget resets at
// midnight UTC, whatever the server's time zone.

export type BudgetLimits = {
  dailyUsd: number; // everything the server spends in a day, all rooms together
  roomDailyUsd: number; // what one room may spend in a day
};

export class BudgetExceededError extends Error {
  constructor(readonly scope: 'global' | 'room') {
    super(scope === 'global' ? 'The daily budget is used up.' : "This room's daily budget is used up.");
    this.name = 'BudgetExceededError';
  }
}

// Money held for one call that is still running.
export type Reservation = { readonly day: string; readonly roomId: string; readonly micros: number; settled: boolean };

export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

// Amounts are kept as whole millionths of a dollar. Adding 0.017 a hundred times in floating
// point drifts (1.7000000000000008), and a cap compared against a drifting total can let one
// extra call through or block one too early. Whole numbers add up exactly.
const MICROS_PER_USD = 1_000_000;

function toMicros(usd: number): number {
  // NaN would poison the total: every later `total + x > cap` would be false, so the cap would
  // never block again. Refuse it loudly instead.
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`Not a valid amount in dollars: ${usd}`);
  return Math.round(usd * MICROS_PER_USD);
}

export function createLedger(limits: BudgetLimits, now: () => Date = () => new Date()) {
  const dailyCap = toMicros(limits.dailyUsd);
  const roomCap = toMicros(limits.roomDailyUsd);

  let day = utcDay(now());
  let total = 0;
  const rooms = new Map<string, number>();

  // The current day; when the date has changed, yesterday's spending stops counting.
  function today(): string {
    const current = utcDay(now());
    if (current !== day) {
      day = current;
      total = 0;
      rooms.clear();
    }
    return current;
  }

  function add(roomId: string | undefined, micros: number): void {
    total += micros;
    if (roomId !== undefined) rooms.set(roomId, (rooms.get(roomId) ?? 0) + micros);
  }

  return {
    // Holds `estimateUsd` for a call that is about to start, or throws if that would go over a cap.
    // Synchronous on purpose: the check and the add happen with no `await` between them, so two
    // requests arriving together can't both see the old total and both get through.
    reserve(roomId: string, estimateUsd: number): Reservation {
      const micros = toMicros(estimateUsd);
      const current = today();
      if (total + micros > dailyCap) throw new BudgetExceededError('global');
      if ((rooms.get(roomId) ?? 0) + micros > roomCap) throw new BudgetExceededError('room');
      add(roomId, micros);
      return { day: current, roomId, micros, settled: false };
    },

    // Swaps the reserved estimate for what the call really cost. The real cost may be above the
    // estimate; it is counted anyway, because that money is already spent.
    settle(reservation: Reservation, actualUsd: number): void {
      if (reservation.settled) return;
      const actual = toMicros(actualUsd);
      reservation.settled = true;
      // A call that started before midnight and ended after it: the reservation went with
      // yesterday, so count the real cost today, as the log line (written now) will on a restart.
      if (today() !== reservation.day) add(reservation.roomId, actual);
      else add(reservation.roomId, actual - reservation.micros);
    },

    // Adds spending that already happened, e.g. read back from the cost log at startup.
    // Anything not from today is ignored. Returns whether it was counted.
    record(at: Date, usd: number, roomId?: string): boolean {
      const micros = toMicros(usd);
      if (utcDay(at) !== today()) return false;
      add(roomId, micros);
      return true;
    },

    // Today's spending in dollars: the whole server's, or one room's.
    spentUsd(roomId?: string): number {
      today();
      return (roomId === undefined ? total : (rooms.get(roomId) ?? 0)) / MICROS_PER_USD;
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
