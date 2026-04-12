import { z } from "zod"

export const schema = z.object({
  setting_match: z.object({
    planned: z.string(),
    observed: z.string(),
    matches: z.boolean(),
  }).optional(),
  emotional_arc_correct: z.boolean().optional(),
  pass: z.boolean(),
  deviations: z.array(z.string()).default([]),
})

export const chapterPlanCheckSchema = schema
