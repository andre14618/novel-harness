import { z } from "zod"

export const schema = z.object({
  setting_match: z.object({
    planned: z.string(),
    observed: z.string(),
    matches: z.boolean(),
  }).optional(),
  characters_present: z.object({
    required: z.array(z.string()),
    found: z.array(z.string()),
    missing: z.array(z.string()),
  }).optional(),
  beats_covered: z.array(z.object({
    beat_index: z.number(),
    description: z.string(),
    found_in_prose: z.boolean(),
  })).optional(),
  emotional_arc_correct: z.boolean().optional(),
  pass: z.boolean(),
  deviations: z.array(z.string()).default([]),
})

export const chapterPlanCheckSchema = schema
