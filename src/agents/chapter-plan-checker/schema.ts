import { z } from "zod"

const deviationSchema = z.union([
  z.object({
    description: z.string(),
    beat_index: z.number().int().nullable(),
  }),
  // Fallback: legacy string form — we coerce to {description, beat_index: null}
  z.string().transform(s => ({ description: s, beat_index: null as number | null })),
])

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
export type ChapterPlanDeviation = { description: string; beat_index: number | null }
