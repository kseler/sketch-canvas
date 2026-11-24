import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_ORIGINS, readAllowedOrigins, readBudgetLimits } from './config';

describe('readBudgetLimits', () => {
  it('defaults to 2 and 0.5 when the variables are missing', () => {
    expect(readBudgetLimits({})).toEqual({ dailyUsd: 2, roomDailyUsd: 0.5 });
  });

  it('treats empty values like missing ones', () => {
    expect(readBudgetLimits({ DAILY_BUDGET_USD: '', ROOM_BUDGET_USD: '' })).toEqual({ dailyUsd: 2, roomDailyUsd: 0.5 });
  });

  it('parses decimal values', () => {
    expect(readBudgetLimits({ DAILY_BUDGET_USD: '1.25', ROOM_BUDGET_USD: '0.1' })).toEqual({
      dailyUsd: 1.25,
      roomDailyUsd: 0.1,
    });
  });

  it('can set just one of the two', () => {
    expect(readBudgetLimits({ ROOM_BUDGET_USD: '3' })).toEqual({ dailyUsd: 2, roomDailyUsd: 3 });
  });

  it.each([
    ['a decimal comma', '2,00'],
    ['text', 'abc'],
    ['zero', '0'],
    ['a negative number', '-1'],
    ['infinity', 'Infinity'],
    ['only spaces', '   '],
  ])('throws at startup for %s in DAILY_BUDGET_USD, naming the setting', (_label, value) => {
    expect(() => readBudgetLimits({ DAILY_BUDGET_USD: value })).toThrow(/DAILY_BUDGET_USD/);
  });

  it.each([
    ['a decimal comma', '0,5'],
    ['text', 'abc'],
    ['zero', '0'],
    ['a negative number', '-1'],
  ])('throws at startup for %s in ROOM_BUDGET_USD, naming the setting', (_label, value) => {
    expect(() => readBudgetLimits({ ROOM_BUDGET_USD: value })).toThrow(/ROOM_BUDGET_USD/);
  });
});

describe('readAllowedOrigins', () => {
  it.each([
    ['missing', {}],
    ['empty', { ALLOWED_ORIGINS: '' }],
    ['only spaces', { ALLOWED_ORIGINS: '   ' }],
  ])('defaults to the local web app when ALLOWED_ORIGINS is %s', (_label, env) => {
    expect(readAllowedOrigins(env)).toEqual(['http://localhost:5173']);
    expect(readAllowedOrigins(env)).toEqual(DEFAULT_ALLOWED_ORIGINS);
  });

  it('parses one origin, with or without a port', () => {
    expect(readAllowedOrigins({ ALLOWED_ORIGINS: 'https://sketch.example.com' })).toEqual(['https://sketch.example.com']);
    expect(readAllowedOrigins({ ALLOWED_ORIGINS: 'http://localhost:3000' })).toEqual(['http://localhost:3000']);
  });

  it('parses a comma-separated list and trims spaces around entries', () => {
    expect(readAllowedOrigins({ ALLOWED_ORIGINS: ' https://a.com , http://localhost:5173,https://b.com:8443 ' })).toEqual([
      'https://a.com',
      'http://localhost:5173',
      'https://b.com:8443',
    ]);
  });

  it.each([
    ['a trailing slash', 'https://a.com/'],
    ['a path', 'https://a.com/app'],
    ['a query', 'https://a.com?x=1'],
    ['a missing scheme', 'localhost:5173'],
    ['a bare host', 'a.com'],
    ['a wildcard', '*'],
    ['an opaque origin', 'null'],
    ['a non-http scheme', 'file:///tmp/x'],
    ['an empty entry in a list', 'https://a.com,,https://b.com'],
    ['a trailing comma', 'https://a.com,'],
    ['one bad entry among good ones', 'https://a.com,https://b.com/'],
  ])('throws for %s', (_label, value) => {
    expect(() => readAllowedOrigins({ ALLOWED_ORIGINS: value })).toThrow(/ALLOWED_ORIGINS/);
  });
});

describe('readAllowedOrigins, exact form only', () => {
  // The browser sends the normalized form (lowercase host, no default port), so any other
  // spelling would never match; refusing it at startup beats a CORS failure nobody can explain.
  it.each(['HTTPS://SKETCH.EXAMPLE.COM', 'https://sketch.example.com:443'])('throws for %j', (value) => {
    expect(() => readAllowedOrigins({ ALLOWED_ORIGINS: value })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('returns a new default array each time, so the default cannot be changed by a caller', () => {
    const first = readAllowedOrigins({});
    first.push('https://evil.example');
    expect(readAllowedOrigins({})).toEqual(DEFAULT_ALLOWED_ORIGINS);
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
  });
});

describe('readBudgetLimits upper bound', () => {
  it('accepts exactly 50 and refuses a slip like 200', () => {
    expect(readBudgetLimits({ DAILY_BUDGET_USD: '50' }).dailyUsd).toBe(50);
    expect(() => readBudgetLimits({ DAILY_BUDGET_USD: '200' })).toThrow(/DAILY_BUDGET_USD/);
    expect(() => readBudgetLimits({ ROOM_BUDGET_USD: '2e3' })).toThrow(/ROOM_BUDGET_USD/);
  });
});
