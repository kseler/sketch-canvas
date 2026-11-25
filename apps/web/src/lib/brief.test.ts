import { describe, expect, it } from 'vitest';
import { capChars, cleanText, readBrief } from './brief';

const brief = { subject: 'a cat on a hill', style: 'watercolor', mood: 'calm', palette: ['#3a7bd5', '#f5d76e'], composition: 'cat centered', lettering: '' };

describe('readBrief', () => {
  it('reads a valid brief', () => {
    expect(readBrief(brief)).toEqual(brief);
  });

  it.each([
    ['a missing subject', { ...brief, subject: undefined }],
    ['an empty style', { ...brief, style: '   ' }],
    ['a numeric mood', { ...brief, mood: 5 }],
    ['a missing composition', { ...brief, composition: undefined }],
    ['an array', []],
    ['null', null],
    ['a string', 'ok'],
    ['nothing', undefined],
  ])('is null for %s', (_label, value) => {
    expect(readBrief(value)).toBeNull();
  });

  it('keeps only palette entries that are #rrggbb colors, at most six', () => {
    const palette = ['#000000', 'red', 'url(x)', 7, '#ABCDEF', '#1', '#111111', '#222222', '#333333', '#444444', '#555555'];
    expect(readBrief({ ...brief, palette })?.palette).toEqual(['#000000', '#ABCDEF', '#111111', '#222222', '#333333', '#444444']);
  });

  it('removes bidirectional-text controls that could reorder the line', () => {
    expect(readBrief({ ...brief, subject: 'cat\u202Etxt.exe\u2066x\u2069' })?.subject).toBe('cattxt.exex');
  });

  it('removes zero-width, tag and soft-hyphen characters, and turns line breaks into spaces (like the server)', () => {
    expect(readBrief({ ...brief, subject: 'a\u061Cb\u200Bc\u{E0041}d\u00ADe\nf\u2028g' })?.subject).toBe('abcde f g');
  });

  it('turns control characters that are not whitespace (escape, bell) into spaces', () => {
    expect(readBrief({ ...brief, subject: 'a\u001Bb\u0007c' })?.subject).toBe('a b c');
  });

  it('cleans like the server: folds fullwidth lookalikes and removes blank filler letters', () => {
    expect(readBrief({ ...brief, subject: 'ＦＲＥＥ\u3164 cat' })?.subject).toBe('FREE cat');
  });

  it('never splits an emoji when capping', () => {
    const subject = readBrief({ ...brief, subject: 'x'.repeat(299) + '\u{1F431}' + 'tail' })?.subject ?? '';
    expect(Array.from(subject)).toHaveLength(300);
    expect(subject.endsWith('\u{1F431}')).toBe(true);
  });

  it('caps long brief text at 300 characters', () => {
    expect(readBrief({ ...brief, subject: 's'.repeat(1000) })?.subject).toHaveLength(300);
  });

  describe('lettering', () => {
    const letter = (lettering: unknown) => readBrief({ ...brief, lettering })?.lettering;

    it('keeps lettering as sent', () => {
      expect(letter('OPEN')).toBe('OPEN');
    });

    it('becomes an empty string when missing', () => {
      const { lettering: _omit, ...withoutLettering } = brief;
      expect(readBrief(withoutLettering)).toEqual({ ...brief, lettering: '' });
    });

    it.each([[5], [null], [{}], [['a']], [true]])('becomes an empty string for non-string %j', (value) => {
      expect(letter(value)).toBe('');
    });

    it('removes invisible characters and trims', () => {
      expect(letter('  OP\u200BEN\u202E \n')).toBe('OPEN');
    });

    it('caps at 24 characters (the server limit)', () => {
      expect(letter('a'.repeat(25))).toBe('a'.repeat(24));
      expect(letter('a'.repeat(24))).toBe('a'.repeat(24));
    });

    it('never splits a character when capping', () => {
      // U+20000 is a CJK letter outside the basic plane (two UTF-16 units) that NFKC leaves alone.
      expect(letter('a'.repeat(23) + '\u{20000}' + 'b')).toBe('a'.repeat(23) + '\u{20000}');
    });

    it('does not make the brief fail when lettering is bad', () => {
      expect(readBrief({ ...brief, lettering: 5 })).not.toBeNull();
    });
  });
});

describe('cleanText and capChars', () => {
  it('is null for non-strings and for text that is only invisible characters or spaces', () => {
    expect(cleanText(5)).toBeNull();
    expect(cleanText(' \u200B\n')).toBeNull();
  });

  it('caps by character, not by UTF-16 unit', () => {
    expect(capChars('\u{1F431}\u{1F431}\u{1F431}', 2)).toBe('\u{1F431}\u{1F431}');
  });
});
