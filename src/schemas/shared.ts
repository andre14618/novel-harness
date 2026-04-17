import { z } from "zod"

// Sub-schemas referenced by multiple agents

export const locationSchema = z.object({
  name: z.string(),
  description: z.string(),
  sensoryDetails: z.string().optional(),
})

export const relationshipSchema = z.object({
  characterName: z.string(),
  nature: z.string(),
})

export const actSchema = z.object({
  number: z.number(),
  name: z.string(),
  summary: z.string(),
  emotionalArc: z.string(),
  turningPoint: z.string().optional(),
})

export const BEAT_KINDS = ["action", "dialogue", "interiority", "description"] as const
export type BeatKind = typeof BEAT_KINDS[number]

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  emotionalShift: z.string().default(""),
  kind: z.enum(BEAT_KINDS).default("action").catch("action"),
})
export type SceneBeat = z.infer<typeof sceneBeatSchema>

export const continuityIssueSchema = z.object({
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
  conflictsWith: z.string().optional(),
  suggestedFix: z.string().optional(),
})
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>
