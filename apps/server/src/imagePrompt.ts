import type { SketchBrief } from './brief';

// Turns a validated brief into the prompt for the image model. Plain code, no model call: the same
// brief always gives the same prompt, so it is free, testable, and safe to use in a cache key.
//
// Context engineering, in three decisions:
// - Order. Image models weigh the start of a prompt most, so the subject comes first, then the
//   composition (what makes the picture look like THIS sketch), then style, mood and colors.
// - Slots. Each brief field sits in its own labelled line, so it can only describe its part of the
//   picture. The brief is cleaned on the way in (brief.ts): no newlines, and no quotes or colons in
//   the descriptions, so a field can't start a line of its own, fake a label, or fake the lettering.
//   This only fixes the shape; the words themselves get a moderation check before the image call.
// - What stays out: room ids, player names, and anything about price or quality. The tier is
//   fixed in code; words like "4K" in a prompt would change nothing but the picture's look.
//
// Lettering is the one place where drawn words reach the picture. It has its own field, which the
// brief model leaves empty for spam, insults, slurs, sexual or violent text and AI instructions,
// and it is quoted here, so the image model shows the words instead of reading them as a request.
export function buildImagePrompt(brief: SketchBrief): string {
  const lines = [
    // "A picture", not "An illustration": the style line decides the look, and could be photographic.
    'A picture based on a rough hand-drawn sketch.',
    `Subject: ${brief.subject}`,
    `Composition: ${brief.composition}`,
    `Style: ${brief.style}`,
    `Mood: ${brief.mood}`,
    `Color palette: ${brief.palette.join(', ')}`,
    // Stated as a fact rather than a "no ..." rule: image models tend to skip over negations.
    brief.lettering === ''
      ? 'There is no writing anywhere in the picture.'
      : // Double quotes on purpose: descriptions can't contain them (brief.ts strips them), while
        // apostrophes are allowed. Switching to single quotes would need ' stripped too.
        `Lettering: the picture shows the words "${brief.lettering}", spelled exactly, and no other text.`,
  ];
  return lines.join('\n');
}
