import { z } from 'zod';

// The structured brief the vision model returns for a sketch. Always validate model output with this
// schema before using it, and retry or fall back when validation fails.
export const SketchBrief = z.object({
  subject: z.string().min(1),
  style: z.string().min(1),
  mood: z.string().min(1),
  palette: z.array(z.string()).max(6),
  composition: z.string().min(1),
});

export type SketchBrief = z.infer<typeof SketchBrief>;
