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

export const VALUE_SHIFT = ["+", "-", "0"] as const
export type ValueShift = typeof VALUE_SHIFT[number]

// Mice-thread sub-enums. The 4 mice threads (Milieu / Inquiry / Character /
// Event, per Card's Elements of Fiction) are tagged per-beat as a soft prior.
// The shippable axes per thread were determined by Sonnet self-consistency
// Jaccard ≥ 0.85 across n=50 Crystal Shard scenes (2026-04-30 wave) — only
// validated subfields are exposed:
//   - MICE_ACTIVE_THREADS:  threads "present" anchor-stable for I, C, E (M borderline 0.786)
//   - MICE_OPENS_THREADS:   threads "opens" anchor-stable for M, I, E (C borderline 0.818)
//   - MICE_CLOSES_THREADS:  threads "closes" anchor-stable for ALL FOUR
// Verdicts in crystal_shard.20260430T012238.n50-stability.json.
export const MICE_ACTIVE_THREADS = ["I", "C", "E"] as const
export const MICE_OPENS_THREADS = ["M", "I", "E"] as const
export const MICE_CLOSES_THREADS = ["M", "I", "C", "E"] as const

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  kind: z.enum(BEAT_KINDS).default("action").catch("action"),
  // Planner-Phase-2 V1a: setups declared here are expected to be realized at
  // `payoff_beat` later in the chapter. Empty array is valid — not every
  // beat seeds a payoff. Default [] so legacy plans round-trip unchanged.
  requiredPayoffs: z.array(payoffLinkSchema).default([]),
  // Corpus-derived soft priors (2026-04-30, optional — omit on uncertainty).
  // Sourced from Crystal Shard structural decomposition; verdicts in
  // novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md.
  // valueShift: McKee-style polarity — does the beat shift the dominant value
  //   positively (+), negatively (-), or leave it static (0). Validated end-
  //   to-end at Flash × Sonnet binary F1 0.974, 3-class major-class F1 ≥ 0.78.
  //   CAVEAT (2026-04-30): n=50 anchor self-consistency Jaccard = 0.639 —
  //   ~35% of beats reassign on Sonnet re-label. Cross-model F1 measures
  //   agreement on a fixed gold set; it does NOT bound the anchor stability
  //   ceiling. Treat as low-confidence soft prior; downstream checkers MUST
  //   NOT block on this field. Architectural follow-up open: keep with
  //   soft-prior framing OR revert pending Codex cheapest-counterfactual
  //   review. See conclusions doc 2026-04-30 ~01:22 UTC entry.
  // gapPresent: McKee-gap binary — does the beat carry a gap between POV
  //   expectation and outcome. Validated at Flash × Pro F1 0.892 (Tier 0
  //   CELL PASS). 60%+ of Salvatore beats carry a gap.
  // mice* (2026-04-30): per-beat presence/opens/closes for the 4 mice
  //   threads. Anchor self-consistency Jaccard ≥ 0.85 at n=50 across the
  //   exposed sub-enums. Each field is an array of thread tags — a beat
  //   may activate / open / close zero or more threads simultaneously.
  //   Empirical distribution from Crystal Shard n=50 (averaged across runs):
  //     active:  E ~62%, C ~57%, I ~5%   (M ~42% borderline, not exposed)
  //     opens:   M ~13%, I ~4%, E ~18%   (C ~19% borderline, not exposed)
  //     closes:  M ~1%, I ~1%, C ~10%, E ~5%
  // All SOFT PRIORS, not hard constraints. Omit when the planner is
  // uncertain. Round-trips unchanged with legacy plans.
  valueShift: z.enum(VALUE_SHIFT).optional(),
  gapPresent: z.boolean().optional(),
  miceActive: z.array(z.enum(MICE_ACTIVE_THREADS)).default([]),
  miceOpens: z.array(z.enum(MICE_OPENS_THREADS)).default([]),
  miceCloses: z.array(z.enum(MICE_CLOSES_THREADS)).default([]),
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
