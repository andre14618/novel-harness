import { z } from "zod"

export const crossChapterIssueSchema = z.object({
  severity: z.string().default("nit").transform(v => {
    const valid = ["blocker", "warning", "nit"]
    if (valid.includes(v)) return v
    const map: Record<string, string> = {
      critical: "blocker", major: "blocker", breaking: "blocker", error: "blocker",
      minor: "warning", medium: "warning", moderate: "warning", caution: "warning",
      trivial: "nit", small: "nit", nitpick: "nit", suggestion: "nit", low: "nit",
    }
    return map[v.toLowerCase()] ?? "nit"
  }),
  description: z.string(),
  chapter: z.coerce.number(),
  conflictsWith: z.string().optional(),
  suggestedFix: z.string().optional(),
})

export const schema = z.object({
  issues: z.array(crossChapterIssueSchema),
})

export const crossChapterContinuitySchema = schema
