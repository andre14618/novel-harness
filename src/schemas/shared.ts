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

// Planner-Phase-2 V1a addition: structured payoff link. `fact_id` references
// the stable id of an establishedFact declared on the chapter. `payoff_beat`
// is the beat index (0-based within the chapter) that realizes the payoff —
// used by adherence-events / chapter-plan-checker to verify setups actually
// land. See docs/charters/planner-phase2-contract.md.
export const payoffLinkSchema = z.object({
  fact_id: z.string(),
  payoff_beat: z.number().int().nonnegative(),
})
export type PayoffLink = z.infer<typeof payoffLinkSchema>

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  kind: z.enum(BEAT_KINDS).default("action").catch("action"),
  // Planner-Phase-2 V1a: setups declared here are expected to be realized at
  // `payoff_beat` later in the chapter. Empty array is valid — not every
  // beat seeds a payoff. Default [] so legacy plans round-trip unchanged.
  requiredPayoffs: z.array(payoffLinkSchema).default([]),
  // emotionalShift removed 2026-04-17: the beat description already
  // carries the emotional signal; a separate "hopeful → devastated"
  // field was redundant and created checker penalties the writer was
  // never instructed about. If emotional arc matters for a beat, the
  // planner should encode it in the description text.
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
