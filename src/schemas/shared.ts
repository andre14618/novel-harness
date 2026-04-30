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

// Stable lifeValue binary classes — the 5-class enum was anchor-unstable
// (Sonnet self-consistency Jaccard 0.639 at n=50). Binary collapse re-analysis
// (2026-04-30 ~01:35 UTC) found that 3 of 5 classes pass the J ≥ 0.85 ship
// gate when treated as binary tags: life-death (0.887), ethics (0.923),
// relational (0.923). Two classes remain borderline pending v3 rubric
// sharpening: agency (0.724), aspiration (0.754). Verdicts in
// crystal_shard.20260430T013524.value-charge-binary-collapse.json.
export const LIFE_VALUE_AXES = ["life-death", "ethics", "relational"] as const
export type LifeValueAxis = typeof LIFE_VALUE_AXES[number]

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
  //
  // valueShifted (2026-04-30): McKee-polarity binary — did the beat shift
  //   the dominant value at all (vs leaving it static)? Replaces the prior
  //   3-class `valueShift: + | - | 0` field, which had anchor Jaccard 0.639
  //   (UNSTABLE). Binary collapse to "did anything move?" recovers anchor
  //   stability at J=0.923 scene-level / J=0.852 beat-level (validated
  //   2026-04-30 ~01:47 UTC via stripped binary-only prompt at both
  //   granularities). Sonnet judges agree well on movement-presence but
  //   disagree on direction (+ vs - alone is J=0.660). Beat-level reference:
  //   ~76% of Crystal Shard beats are shifted, ~24% static (bridges,
  //   observation, exposition). Scene-level: ~89% shifted, ~11% static.
  //
  // gapPresent: McKee-gap binary — does the beat carry a gap between POV
  //   expectation and outcome. Originally validated at Flash × Pro F1 0.892
  //   (cross-model). 60%+ of Salvatore beats carry a gap.
  //   CAVEAT (2026-04-30): n=50 Sonnet self-consistency Jaccard for
  //   "any gap vs none" is 0.818 — NEAR the 0.85 ship bar but not at it.
  //   Treat as low-confidence soft prior; downstream checkers MUST NOT
  //   block on this field. Sharpening of the "no gap" boundary is a
  //   queued rubric edit (see conclusions doc 2026-04-30 ~01:37 UTC).
  //
  // lifeValueAxes (2026-04-30): which McKee life-value AXES the beat
  //   moves on. Multi-select array — a beat may move 0+ axes. The full
  //   5-class enum was anchor-unstable (J=0.639); 3 of 5 classes (the
  //   ones exposed here) pass J ≥ 0.85 as binary tags AT SCENE LEVEL
  //   (life-death 0.887, ethics 0.923, relational 0.923). The other two
  //   (agency, aspiration) are deliberately excluded pending v3 rubric
  //   sharpening; if the scene moves on those axes, the planner can
  //   encode it in the beat description text.
  //   CAVEAT (2026-04-30): beat-level Jaccard for these 3 classes is
  //   NOT YET DIRECTLY MEASURED. Per the granularity-penalty pattern
  //   observed on `valueShifted` (~0.04 lower at beat than scene),
  //   life-death is expected at ~0.847 — right at the 0.85 ship bar.
  //   Beat-level validation queued; downstream checkers MUST NOT block
  //   on these tags until the validation lands.
  //
  // mice* (2026-04-30): per-beat presence/opens/closes for the 4 mice
  //   threads. Anchor self-consistency Jaccard ≥ 0.85 at n=50 across the
  //   exposed sub-enums. Each field is an array of thread tags — a beat
  //   may activate / open / close zero or more threads simultaneously.
  //   Empirical distribution from Crystal Shard n=50 (averaged across runs):
  //     active:  E ~62%, C ~57%, I ~5%   (M ~42% borderline, not exposed)
  //     opens:   M ~13%, I ~4%, E ~18%   (C ~19% borderline, not exposed)
  //     closes:  M ~1%, I ~1%, C ~10%, E ~5%
  //
  // All SOFT PRIORS, not hard constraints. Omit (or leave arrays empty)
  // when the planner is uncertain. Round-trips unchanged with legacy plans.
  valueShifted: z.boolean().optional(),
  gapPresent: z.boolean().optional(),
  lifeValueAxes: z.array(z.enum(LIFE_VALUE_AXES)).default([]),
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
