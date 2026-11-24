import { z } from 'zod';

// The structured brief the vision model returns for a sketch. Model output is untrusted input:
// it is always checked with this schema before it is used (CLAUDE.md rule 2).
//
// Two layers, on purpose:
// - SKETCH_BRIEF_JSON_SCHEMA goes to the API as the output format. It fixes the SHAPE: these five
//   fields, these types, nothing else. Its descriptions double as instructions to the model.
// - SketchBrief (zod) then checks the CONTENT the shape can't: lengths, and colors as #rrggbb.
//   Text drawn on the canvas can steer the model; these limits cap what it can make it write.

export const BRIEF_LIMITS = { subject: 200, style: 120, mood: 120, composition: 300, colors: 6 } as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const SketchBrief = z.object({
  subject: text(BRIEF_LIMITS.subject),
  style: text(BRIEF_LIMITS.style),
  mood: text(BRIEF_LIMITS.mood),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(BRIEF_LIMITS.colors),
  composition: text(BRIEF_LIMITS.composition),
});

export type SketchBrief = z.infer<typeof SketchBrief>;

const field = (description: string) => ({ type: 'string', description });

// Shape only: types, required fields, no extra fields. The limits live in zod above, so the API
// never has to support every JSON Schema keyword.
export const SKETCH_BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: field(`The main subject of the sketch, in a few words. At most ${BRIEF_LIMITS.subject} characters.`),
    style: field(`An art style that suits the sketch, e.g. "watercolor" or "flat vector". At most ${BRIEF_LIMITS.style} characters.`),
    mood: field(`The mood of the picture, in a few words. At most ${BRIEF_LIMITS.mood} characters.`),
    palette: {
      type: 'array',
      items: { type: 'string', description: 'A color as #rrggbb, e.g. #3a7bd5.' },
      description: `1 to ${BRIEF_LIMITS.colors} colors that suit the picture.`,
    },
    composition: field(`Where things are placed and how they are framed. At most ${BRIEF_LIMITS.composition} characters.`),
  },
  required: ['subject', 'style', 'mood', 'palette', 'composition'],
  additionalProperties: false,
} as const;
