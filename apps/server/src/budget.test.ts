import { describe, expect, it } from 'vitest';
import { BudgetExceededError, createLedger, utcDay } from './budget';

const DAY = new Date('2026-11-24T12:00:00Z');
const limits = { dailyUsd: 1, roomDailyUsd: 0.5 };

function clock(start: Date) {
  let current = start;
  return { now: () => current, set: (date: Date) => (current = date) };
}

function scopeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof BudgetExceededError) return error.scope;
    throw error;
  }
  return undefined;
}

describe('utcDay', () => {
  it('uses the UTC date, not the local one', () => {
    expect(utcDay(new Date('2026-11-24T23:59:59.999Z'))).toBe('2026-11-24');
    expect(utcDay(new Date('2026-11-25T00:00:00.000Z'))).toBe('2026-11-25');
  });
});

describe('createLedger reserve', () => {
  it('lets a reserve under both caps through and counts it', () => {
    const ledger = createLedger(limits, () => DAY);
    ledger.reserve('a', 0.1);
    expect(ledger.spentUsd()).toBe(0.1);
    expect(ledger.spentUsd('a')).toBe(0.1);
  });

  it('refuses a reserve over the global cap with scope global', () => {
    const ledger = createLedger({ dailyUsd: 0.3, roomDailyUsd: 10 }, () => DAY);
    ledger.reserve('a', 0.2);
    expect(scopeOf(() => ledger.reserve('b', 0.2))).toBe('global');
  });

  it('refuses a reserve over the room cap with scope room', () => {
    const ledger = createLedger({ dailyUsd: 10, roomDailyUsd: 0.3 }, () => DAY);
    ledger.reserve('a', 0.2);
    expect(scopeOf(() => ledger.reserve('a', 0.2))).toBe('room');
  });

  it('allows exactly reaching the global cap but not one micro-dollar more', () => {
    const ledger = createLedger({ dailyUsd: 1, roomDailyUsd: 10 }, () => DAY);
    ledger.reserve('a', 0.999999);
    ledger.reserve('a', 0.000001);
    expect(ledger.spentUsd()).toBe(1);
    expect(scopeOf(() => ledger.reserve('a', 0.000001))).toBe('global');
  });

  it('allows exactly reaching the room cap but not one micro-dollar more', () => {
    const ledger = createLedger({ dailyUsd: 10, roomDailyUsd: 0.5 }, () => DAY);
    ledger.reserve('a', 0.499999);
    ledger.reserve('a', 0.000001);
    expect(scopeOf(() => ledger.reserve('a', 0.000001))).toBe('room');
  });

  it('adds nothing when a reserve is refused', () => {
    const ledger = createLedger({ dailyUsd: 0.3, roomDailyUsd: 0.2 }, () => DAY);
    ledger.reserve('a', 0.1);
    expect(scopeOf(() => ledger.reserve('a', 0.15))).toBe('room');
    expect(scopeOf(() => ledger.reserve('b', 0.25))).toBe('global');
    expect(ledger.spentUsd()).toBe(0.1);
    expect(ledger.spentUsd('a')).toBe(0.1);
    expect(ledger.spentUsd('b')).toBe(0);
  });

  it('refuses the second of two back-to-back reserves when only one fits', () => {
    const ledger = createLedger({ dailyUsd: 0.05, roomDailyUsd: 0.05 }, () => DAY);
    const results = [0, 1].map(() => scopeOf(() => ledger.reserve('a', 0.04)));
    expect(results).toEqual([undefined, 'global']);
  });

  it('checks the global cap before the room cap', () => {
    const ledger = createLedger({ dailyUsd: 0.1, roomDailyUsd: 0.1 }, () => DAY);
    expect(scopeOf(() => ledger.reserve('a', 0.2))).toBe('global');
  });

  it('keeps rooms independent', () => {
    const ledger = createLedger({ dailyUsd: 10, roomDailyUsd: 0.2 }, () => DAY);
    ledger.reserve('a', 0.2);
    ledger.reserve('b', 0.2);
    expect(ledger.spentUsd('a')).toBe(0.2);
    expect(ledger.spentUsd('b')).toBe(0.2);
    expect(ledger.spentUsd('c')).toBe(0);
    expect(ledger.spentUsd()).toBe(0.4);
  });

  it('admits exactly three 0.017 calls under a 0.051 cap', () => {
    const ledger = createLedger({ dailyUsd: 0.051, roomDailyUsd: 10 }, () => DAY);
    for (let i = 0; i < 3; i++) ledger.reserve('a', 0.017);
    expect(scopeOf(() => ledger.reserve('a', 0.017))).toBe('global');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['negative', -0.01],
  ])('throws RangeError for %s and keeps the total clean', (_label, amount) => {
    const ledger = createLedger(limits, () => DAY);
    expect(() => ledger.reserve('a', amount)).toThrow(RangeError);
    expect(ledger.spentUsd()).toBe(0);
    expect(scopeOf(() => ledger.reserve('a', 0.6))).toBe('room'); // caps still work
  });
});

describe('createLedger settle', () => {
  it('swaps the estimate for a lower actual cost', () => {
    const ledger = createLedger(limits, () => DAY);
    const r = ledger.reserve('a', 0.1);
    ledger.settle(r, 0.03);
    expect(ledger.spentUsd()).toBe(0.03);
    expect(ledger.spentUsd('a')).toBe(0.03);
  });

  it('counts a higher actual cost in full, even past the cap', () => {
    const ledger = createLedger({ dailyUsd: 0.1, roomDailyUsd: 0.1 }, () => DAY);
    const r = ledger.reserve('a', 0.05);
    ledger.settle(r, 0.2);
    expect(ledger.spentUsd()).toBe(0.2);
    expect(scopeOf(() => ledger.reserve('a', 0.001))).toBe('global');
  });

  it('does nothing the second time it is called for a reservation', () => {
    const ledger = createLedger(limits, () => DAY);
    const r = ledger.reserve('a', 0.1);
    ledger.settle(r, 0.03);
    ledger.settle(r, 0.4);
    expect(ledger.spentUsd()).toBe(0.03);
  });

  it('has no float drift after 100 reserve+settle of 0.017', () => {
    const ledger = createLedger({ dailyUsd: 100, roomDailyUsd: 100 }, () => DAY);
    for (let i = 0; i < 100; i++) ledger.settle(ledger.reserve('a', 0.017), 0.017);
    expect(ledger.spentUsd()).toBe(1.7);
    expect(ledger.spentUsd('a')).toBe(1.7);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -1],
  ])('throws RangeError for %s and leaves the reservation usable', (_label, amount) => {
    const ledger = createLedger(limits, () => DAY);
    const r = ledger.reserve('a', 0.1);
    expect(() => ledger.settle(r, amount)).toThrow(RangeError);
    expect(ledger.spentUsd()).toBe(0.1);
    ledger.settle(r, 0.02);
    expect(ledger.spentUsd()).toBe(0.02);
  });
});

describe('createLedger record', () => {
  it('adds spending from today, globally and for its room', () => {
    const ledger = createLedger(limits, () => DAY);
    ledger.record(new Date('2026-11-24T01:00:00Z'), 0.25, 'a');
    expect(ledger.spentUsd()).toBe(0.25);
    expect(ledger.spentUsd('a')).toBe(0.25);
  });

  it('counts an entry without a room globally only', () => {
    const ledger = createLedger(limits, () => DAY);
    ledger.record(DAY, 0.25);
    expect(ledger.spentUsd()).toBe(0.25);
    expect(ledger.spentUsd('a')).toBe(0);
  });

  it('ignores entries from other days', () => {
    const ledger = createLedger(limits, () => DAY);
    ledger.record(new Date('2026-11-23T23:59:59Z'), 0.25, 'a');
    ledger.record(new Date('2026-11-25T00:00:00Z'), 0.25, 'a');
    expect(ledger.spentUsd()).toBe(0);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -0.1],
  ])('throws RangeError for %s', (_label, amount) => {
    const ledger = createLedger(limits, () => DAY);
    expect(() => ledger.record(DAY, amount, 'a')).toThrow(RangeError);
    expect(ledger.spentUsd()).toBe(0);
  });
});

describe('createLedger day rollover', () => {
  it('resets global and room totals at UTC midnight', () => {
    const c = clock(new Date('2026-11-24T23:59:59.999Z'));
    const ledger = createLedger({ dailyUsd: 0.5, roomDailyUsd: 0.5 }, c.now);
    ledger.reserve('a', 0.5);
    expect(scopeOf(() => ledger.reserve('a', 0.1))).toBe('global');
    c.set(new Date('2026-11-25T00:00:00.000Z'));
    expect(ledger.spentUsd()).toBe(0);
    expect(ledger.spentUsd('a')).toBe(0);
    expect(() => ledger.reserve('a', 0.5)).not.toThrow();
  });

  it('counts the actual cost on the new day for a reservation settled after midnight', () => {
    const c = clock(new Date('2026-11-24T23:59:59Z'));
    const ledger = createLedger(limits, c.now);
    const r = ledger.reserve('a', 0.3);
    c.set(new Date('2026-11-25T00:00:01Z'));
    ledger.settle(r, 0.1);
    expect(ledger.spentUsd()).toBe(0.1);
    expect(ledger.spentUsd('a')).toBe(0.1);
  });

  it('does not let a new day go negative when an old reservation settles', () => {
    const c = clock(new Date('2026-11-24T23:59:59Z'));
    const ledger = createLedger(limits, c.now);
    const r = ledger.reserve('a', 0.3);
    c.set(new Date('2026-11-25T00:00:01Z'));
    ledger.settle(r, 0);
    expect(ledger.spentUsd()).toBe(0);
  });

  it('ignores record() entries from the previous day after rollover', () => {
    const c = clock(new Date('2026-11-25T00:00:01Z'));
    const ledger = createLedger(limits, c.now);
    ledger.record(new Date('2026-11-24T23:00:00Z'), 0.4, 'a');
    expect(ledger.spentUsd()).toBe(0);
  });
});

describe('createLedger settle after settling', () => {
  it('ignores a second settle even when its amount is invalid', () => {
    const ledger = createLedger(limits, () => DAY);
    const r = ledger.reserve('room-1', 0.1);
    ledger.settle(r, 0.05);
    expect(() => ledger.settle(r, NaN)).not.toThrow();
    expect(ledger.spentUsd()).toBe(0.05);
  });
});

describe('createLedger record result', () => {
  it('says whether an entry was counted for today', () => {
    const ledger = createLedger(limits, () => DAY);
    expect(ledger.record(new Date('2026-11-24T01:00:00Z'), 0.1, 'room-1')).toBe(true);
    expect(ledger.record(new Date('2026-11-23T23:00:00Z'), 0.1, 'room-1')).toBe(false);
    expect(ledger.spentUsd()).toBe(0.1);
  });
});

describe('createLedger whole micro-dollars', () => {
  // A brief costs fractions of a cent. In plain floating point 0.000123 * 1e6 is
  // 123.00000000000001, so three of them overshoot a cap of exactly three and the third is refused.
  it('admits exactly three 0.000123 calls under a cap of 0.000369', () => {
    const ledger = createLedger({ dailyUsd: 0.000369, roomDailyUsd: 1 }, () => DAY);
    for (let i = 0; i < 3; i += 1) ledger.reserve('room-1', 0.000123);
    expect(ledger.spentUsd()).toBe(0.000369);
    expect(scopeOf(() => ledger.reserve('room-1', 0.000001))).toBe('global');
  });
});
