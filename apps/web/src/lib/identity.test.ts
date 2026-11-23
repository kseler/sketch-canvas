import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHexColor } from './color';
import { cleanName, hasVisibleText, initials, isIdentity, MAX_NAME_LENGTH, randomIdentity } from './identity';

afterEach(() => {
  vi.restoreAllMocks();
});

// A valid identity; each test breaks exactly one thing, so a failure points at one rule.
const valid = { name: 'Blue Fox', color: '#e76f51' };

describe('isIdentity (names and colors from other players)', () => {
  it('accepts a valid identity', () => {
    expect(isIdentity(valid)).toBe(true);
  });

  // Over-long names are accepted here and cut to size by cleanName where they are displayed.
  it('accepts an over-long name (callers shorten it with cleanName)', () => {
    expect(isIdentity({ ...valid, name: 'x'.repeat(MAX_NAME_LENGTH * 10) })).toBe(true);
  });

  it.each([
    ['empty name', { name: '' }],
    ['whitespace-only name (an invisible avatar)', { name: ' \t\n ' }],
    ['zero-width-only name (invisible, and trim() keeps it)', { name: '​‍﻿' }],
    // Found by the reviewer: visible before cutting to MAX_NAME_LENGTH, invisible after.
    ['name that is only invisible once cut to size', { name: `${'​'.repeat(MAX_NAME_LENGTH)}x` }],
    ['number name', { name: 42 }],
    ['null name', { name: null }],
    ['missing name', { name: undefined }],
    ['CSS-injection color that would make browsers fetch a URL', { color: 'url(https://tracker.example/x)' }],
    ['named color', { color: 'red' }],
    ['short hex color', { color: '#fff' }],
    ['missing color', { color: undefined }],
    ['number color', { color: 0xe76f51 }],
  ])('rejects %s', (_label, change) => {
    expect(isIdentity({ ...valid, ...change })).toBe(false);
  });

  it.each([null, undefined, 'Blue Fox', 42, []])('rejects non-objects: %j', (value) => {
    expect(isIdentity(value)).toBe(false);
  });
});

describe('cleanName', () => {
  it('trims surrounding whitespace', () => {
    expect(cleanName('  Blue Fox \n')).toBe('Blue Fox');
  });

  it('keeps inner spaces', () => {
    expect(cleanName('Blue  Fox')).toBe('Blue  Fox');
  });

  it('keeps a name of exactly MAX_NAME_LENGTH, cuts one character more', () => {
    const atLimit = 'a'.repeat(MAX_NAME_LENGTH);
    expect(cleanName(atLimit)).toBe(atLimit);
    expect(cleanName(`${atLimit}b`)).toBe(atLimit);
  });

  it('trims before measuring, so padding does not eat into the limit', () => {
    const atLimit = 'a'.repeat(MAX_NAME_LENGTH);
    expect(cleanName(`   ${atLimit}   `)).toBe(atLimit);
  });

  it('turns a whitespace-only name into an empty string', () => {
    expect(cleanName('   ')).toBe('');
  });

  // Found by the test-writer agent: cutting by UTF-16 units left half an emoji at the limit.
  it('never cuts an emoji in half at the limit', () => {
    const name = `${'a'.repeat(MAX_NAME_LENGTH - 1)}🦊🦊`;
    // Exactly the first 24 characters, the last one a whole fox (the old code left "\ud83e").
    expect(cleanName(name)).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 1)}🦊`);
  });

  it('counts a flag or a joined emoji as one character', () => {
    expect(cleanName(`${'a'.repeat(MAX_NAME_LENGTH - 1)}🇭🇷`)).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 1)}🇭🇷`);
    expect(cleanName(`${'a'.repeat(MAX_NAME_LENGTH - 1)}👩‍💻x`)).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 1)}👩‍💻`);
  });

  it('trims again after cutting, so no trailing space is left', () => {
    expect(cleanName(`${'a'.repeat(MAX_NAME_LENGTH - 1)} b`)).toBe('a'.repeat(MAX_NAME_LENGTH - 1));
  });

  // Names from other players are cleaned on every awareness update. Uncut, a 5 MB name took ~200 ms
  // per update; the cheap cap makes it ~instant. The 50 ms bound is far from both, so not flaky.
  it('handles a huge hostile name quickly and returns its first characters', () => {
    const huge = 'ab'.repeat(2_500_000);
    const start = performance.now();
    const cleaned = cleanName(huge);
    expect(performance.now() - start).toBeLessThan(50);
    expect(cleaned).toBe('ab'.repeat(MAX_NAME_LENGTH / 2));
  });
});

describe('hasVisibleText', () => {
  it.each(['Fox', '🦊', ' a ', 'ä'])('is true for %j', (text) => {
    expect(hasVisibleText(text)).toBe(true);
  });

  it.each(['', '   ', '\t\n', '​', '​‍﻿', '⁠'])('is false for invisible text %j', (text) => {
    expect(hasVisibleText(text)).toBe(false);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(initials('blue fox')).toBe('BF');
  });

  it('uses one letter for a one-word name', () => {
    expect(initials('Fox')).toBe('F');
  });

  it('stops at two letters for longer names', () => {
    expect(initials('Very Swift Blue Fox')).toBe('VS');
  });

  it('ignores extra and surrounding whitespace', () => {
    expect(initials('  Blue   Fox ')).toBe('BF');
  });

  it('keeps a single emoji whole (no broken half character)', () => {
    expect(initials('🦊')).toBe('🦊');
  });

  it('takes an emoji as the first character of a word without splitting it', () => {
    expect(initials('🦊fox')).toBe('🦊');
  });

  it('returns an empty string for an empty name', () => {
    expect(initials('')).toBe('');
  });

  // Found by the test-writer agent: the old code joined first, then cut by UTF-16 units.
  it('keeps an emoji whole when it is the second word', () => {
    expect(initials('Fox 🦊')).toBe('F🦊');
  });

  it('keeps both initials when the emoji comes first', () => {
    expect(initials('🦊 Fox')).toBe('🦊F');
  });

  it('keeps a flag whole', () => {
    expect(initials('🇭🇷 Ana')).toBe('🇭🇷A');
  });

  it('does not grow to three letters when uppercasing would (ß → SS)', () => {
    expect(initials('ßa b')).toBe('ßB');
  });
});

describe('randomIdentity', () => {
  // Seeded, so these tests always check the same identity.
  it('returns an identity that other players would accept', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(isIdentity(randomIdentity())).toBe(true);
  });

  it('has a two-word name within the length limit and a hex color', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { name, color } = randomIdentity();
    expect(name).toMatch(/^\S+ \S+$/);
    // The limit counts characters as people see them, not UTF-16 units.
    const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)];
    expect(characters.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(isHexColor(color)).toBe(true);
  });

  // Math.random() is in [0, 1); the top of the range must still pick a real entry, not undefined.
  it.each([0, 0.5, 0.999999])('picks valid entries when Math.random() returns %d', (value) => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
    const identity = randomIdentity();
    expect(identity.name).not.toContain('undefined');
    expect(isIdentity(identity)).toBe(true);
  });

  it('varies with the random source', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = randomIdentity();
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const last = randomIdentity();
    expect(last.name).not.toBe(first.name);
    expect(last.color).not.toBe(first.color);
  });
});
