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

const optionalBeatIndexSchema = z.preprocess(value => {
  if (value === undefined || value === null || value === "") return undefined
  const number = typeof value === "number" ? value : Number(value)
  return Number.isInteger(number) && number >= 0 ? number : undefined
}, z.number().int().nonnegative().optional())

export const beatObligationItemSchema = z.preprocess(
  value => typeof value === "string" ? { text: value } : value,
  z.object({
    text: z.string().default(""),
    id: z.coerce.string().optional(),
    factId: z.coerce.string().optional(),
    characterName: z.coerce.string().optional(),
    seededAtBeat: optionalBeatIndexSchema,
    untilBeat: optionalBeatIndexSchema,
  }).passthrough(),
).catch({ text: "" })

export const beatObligationsSchema = z.object({
  mustEstablish: z.array(beatObligationItemSchema).default([]).catch([]),
  mustPayOff: z.array(beatObligationItemSchema).default([]).catch([]),
  mustTransferKnowledge: z.array(beatObligationItemSchema).default([]).catch([]),
  mustShowStateChange: z.array(beatObligationItemSchema).default([]).catch([]),
  mustNotReveal: z.array(beatObligationItemSchema).default([]).catch([]),
  allowedNewEntities: z.array(z.coerce.string()).default([]).catch([]),
}).default({
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
})
export type BeatObligationsContract = z.infer<typeof beatObligationsSchema>

// Stable lifeValue binary classes — the 5-class enum was anchor-unstable
// (Sonnet self-consistency Jaccard 0.639 at n=50 scene-level, 0.786 beat-
// level). Binary collapse re-analysis with beat-level validation (2026-04-30
// ~01:54 UTC) found that ALL 5 classes pass the J ≥ 0.85 ship gate as binary
// tags AT THE BEAT LEVEL — the granularity sceneBeatSchema operates at:
//   life-death  (scene 0.887, beat 0.923)
//   ethics      (scene 0.923, beat 0.961)
//   relational  (scene 0.923, beat 0.961)
//   agency      (scene 0.724 NEAR, beat 0.852 PASS — granularity improvement)
//   aspiration  (scene 0.754 NEAR, beat 0.852 PASS — granularity improvement)
// Verdicts in crystal_shard.20260430T015427.beat-level-extension.json.
export const LIFE_VALUE_AXES = ["life-death", "agency", "ethics", "relational", "aspiration"] as const
export type LifeValueAxis = typeof LIFE_VALUE_AXES[number]

// Mice-thread sub-enums. The 4 mice threads (Milieu / Inquiry / Character /
// Event, per Card's Elements of Fiction) are tagged per-beat as a soft prior.
// Exposed enums are the INTERSECTION of scene-level and beat-level Jaccard ≥ 0.85
// (n=50 Crystal Shard each granularity, 2026-04-30 waves) — granularity rotation
// matters because the schema lives at beat level but the calibration anchor is
// scene level. A subfield ships only if BOTH cross 0.85.
//   - MICE_ACTIVE_THREADS:  beat-stable for I only (scene 0.961 → beat 0.887)
//                           C, E "is_present" degraded to NEAR at beat level
//                           (0.754, 0.818) — dropped.
//   - MICE_OPENS_THREADS:   beat-stable for M, I (scene PASS → beat 0.961, 0.887)
//                           E "opens" degraded to NEAR at beat (0.818) — dropped.
//   - MICE_CLOSES_THREADS:  beat-stable for ALL FOUR (scene PASS → beat 0.887-1.000).
// Verdicts in crystal_shard.20260430T015427.beat-level-extension.json.
export const MICE_ACTIVE_THREADS = ["I"] as const
export const MICE_OPENS_THREADS = ["M", "I"] as const
export const MICE_CLOSES_THREADS = ["M", "I", "C", "E"] as const

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  kind: z.enum(BEAT_KINDS).default("action").catch("action"),
  // Planner-Phase-2 V1a: setups declared here are expected to be realized at
  // `payoff_beat` later in the chapter. Empty array is valid — not every
  // beat seeds a payoff. Default [] so legacy plans round-trip unchanged.
  requiredPayoffs: z.array(payoffLinkSchema).default([]),
  // Planner-authored compact per-beat contract. This is the writer/checker
  // shared surface for state that must land in prose. Defaults empty so legacy
  // outlines remain valid.
  obligations: beatObligationsSchema,
  // Corpus-derived soft priors (2026-04-30, optional — omit on uncertainty).
  // Sourced from Crystal Shard structural decomposition; verdicts in
  // novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md.
  //
  // valueShifted (2026-04-30): McKee-polarity binary — did the beat shift
  //   the dominant value at all (vs leaving it static)? Replaces the prior
  //   3-class `valueShift: + | - | 0` field, which had anchor Jaccard 0.639
  //   (UNSTABLE). Binary collapse to "did anything move?" recovers anchor
  //   stability — beat-level Sonnet self-consistency is at the 0.85 ship
  //   bar (range 0.818-0.852 across rubric forms; stripped binary-only is
  //   0.852, coupled-then-collapsed is 0.818, true value bracketed
  //   ~0.83-0.85). Scene-level is 0.887-0.923. Sonnet judges agree well on
  //   movement-presence but disagree on direction (+ vs - alone is J=0.660).
  //   Beat-level reference: ~76% of Crystal Shard beats are shifted, ~24%
  //   static (bridges, observation, exposition). Scene-level: ~89% shifted,
  //   ~11% static. Field is at-bar — checkers MUST NOT block on it.
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
  //   5-class enum is anchor-unstable when forced to pick ONE class
  //   (J=0.639 scene, 0.786 beat); but as binary multi-tags (each axis
  //   independently y/n), all 5 classes pass at beat level — the
  //   granularity sceneBeatSchema operates at:
  //     life-death  (scene 0.887, beat 0.923)
  //     agency      (scene 0.724 NEAR, beat 0.852 — granularity improves)
  //     ethics      (scene 0.923, beat 0.961)
  //     relational  (scene 0.923, beat 0.961)
  //     aspiration  (scene 0.754 NEAR, beat 0.852 — granularity improves)
  //   Beat-level reference distribution from Crystal Shard n=50 (averaged
  //   across runs): life-death ~36%, agency ~28%, relational ~17%,
  //   aspiration ~14%, ethics ~5%. Most beats move on 1 axis; ~10% move
  //   on 0 (genuine static beats per `valueShifted`).
  //
  // mice* (2026-04-30): per-beat presence/opens/closes for the 4 mice
  //   threads. Each field's exposed enum is the INTERSECTION of scene-
  //   level and beat-level Jaccard ≥ 0.85 (granularity rotation on the
  //   2026-04-30 ~01:54 UTC wave revealed that some scene-PASS subfields
  //   degrade to NEAR at beat level, while some borderline subfields
  //   improve). Each field is an array of thread tags — a beat may
  //   activate / open / close zero or more threads simultaneously.
  //     miceActive: only I — C and E "is_present" degrade beat-level
  //                 (0.961→0.754, 0.923→0.818). Mid-thread C/E presence
  //                 is encoded in beat description, not this tag.
  //     miceOpens:  M, I — E "opens" degrades beat-level (0.852→0.818).
  //     miceCloses: ALL FOUR — closes events stable at both granularities.
  //   Beat-level reference distribution from Crystal Shard n=50:
  //     active:  I ~5%   (very rare; epistemic mystery thread is sparse)
  //     opens:   M ~16%, I ~5%
  //     closes:  M ~3%, I ~3%, C ~10%, E ~6%
  //
  // All SOFT PRIORS, not hard constraints. Omit (or leave arrays empty)
  // when the planner is uncertain. Round-trips unchanged with legacy plans.
  valueShifted: z.boolean().optional(),
  gapPresent: z.boolean().optional(),
  lifeValueAxes: z.array(z.enum(LIFE_VALUE_AXES)).default([]).catch([]),
  miceActive: z.array(z.enum(MICE_ACTIVE_THREADS)).default([]).catch([]),
  miceOpens: z.array(z.enum(MICE_OPENS_THREADS)).default([]).catch([]),
  miceCloses: z.array(z.enum(MICE_CLOSES_THREADS)).default([]).catch([]),
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
