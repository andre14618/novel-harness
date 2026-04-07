import { z } from "zod"

export const schema = z.object({
  pass: z.boolean(),
  deviations: z.array(z.string()).default([]),
})

export const chapterPlanCheckSchema = schema
