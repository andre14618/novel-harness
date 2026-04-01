import { z } from "zod"

export const crossChapterIssueSchema = z.object({
  severity: z.enum(["blocker", "warning", "nit"]).default("nit"),
  description: z.string(),
  chapter: z.coerce.number(),
  conflictsWith: z.string().optional(),
  suggestedFix: z.string().optional(),
})

export const schema = z.object({
  issues: z.array(crossChapterIssueSchema),
})

export const crossChapterContinuitySchema = schema
