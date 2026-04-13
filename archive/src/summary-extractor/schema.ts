import { z } from "zod"

export const schema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()).default([]),
  emotionalState: z.string().default(""),
  openThreads: z.array(z.string()).default([]),
})

// Backward compat
export const chapterSummarySchema = schema
