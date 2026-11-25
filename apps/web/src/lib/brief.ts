// The brief the server's vision step wrote for the sketch, as the web app shows it. It reaches the
// browser inside the room's job record (lib/jobs.ts), which any peer could in principle have
// written, so it is read defensively like everything from the shared document.

// `lettering`: words the picture will show, or '' for none.
export type Brief = { subject: string; style: string; mood: string; palette: string[]; composition: string; lettering: string };

export const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
// Invisible characters: format characters (bidi controls like U+202E that visually reorder a line,
// zero-width characters, soft hyphens, invisible "tag" characters), control characters (newlines,
// tabs) and line/paragraph separators. Text drawn on the canvas can steer the model into writing
// them, and the brief is shown as one line.
const FORMAT_CHARS = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
const LINE_BREAKERS = /[\p{Cc}\u2028\u2029]/gu;

// Display text from the server, capped: the server validates the brief, but the browser doesn't
// assume it (a proxy or an older server could answer anything). 300 = the server's longest brief
// field (BRIEF_LIMITS.composition in apps/server/src/brief.ts, which the web app can't import).
// By code point, not UTF-16 unit, so the cap never splits an emoji in half.
export const capChars = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Same cleaning as the server's cleanBriefText: invisible characters go, line breaks become spaces.
  const text = v
    .normalize('NFKC')
    .replace(FORMAT_CHARS, '')
    .replace(LINE_BREAKERS, ' ')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : capChars(text, 300);
}

export function readBrief(value: unknown): Brief | null {
  const b = asRecord(value);
  const subject = cleanText(b.subject);
  const style = cleanText(b.style);
  const mood = cleanText(b.mood);
  const composition = cleanText(b.composition);
  const palette = Array.isArray(b.palette) ? b.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [];
  if (!subject || !style || !mood || !composition) return null;
  // Optional: missing or empty means no words. Capped at the server's limit (BRIEF_LIMITS.lettering,
  // 24 characters); the server drops longer lettering, this only guards the display.
  const lettering = capChars(cleanText(b.lettering) ?? '', 24);
  return { subject, style, mood, palette, composition, lettering };
}

