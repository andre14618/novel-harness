import { z } from "zod"

export const proseQualityIssueSchema = z.object({
  issue: z.string(),
  excerpt: z.string(),
  suggestedFix: z.string(),
})

export const schema = z.object({
  issues: z.array(proseQualityIssueSchema),
})

export const proseQualitySchema = schema
