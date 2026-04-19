import { z } from "zod"

export type ChapterPlanDeviation = { description: string; beat_index: number | null }

// Coerce legacy string deviations into {description, beat_index: null} before
// the object schema parses. Cast the ZodType to the resolved output so
// z.infer downstream lands on ChapterPlanDeviation instead of `unknown`.
const deviationSchema = z.preprocess(
  v => typeof v === "string" ? { description: v, beat_index: null } : v,
  z.object({
    description: z.string(),
    beat_index: z.number().int().nullable(),
  }),
) as unknown as z.ZodType<ChapterPlanDeviation>

export const schema = z.object({
  setting_match: z.object({
    planned: z.string(),
    observed: z.string(),
    matches: z.boolean(),
  }).optional(),
  emotional_arc_correct: z.boolean().optional(),
  pass: z.boolean(),
  deviations: z.array(deviationSchema).default([]),
})

export const chapterPlanCheckSchema = schema
