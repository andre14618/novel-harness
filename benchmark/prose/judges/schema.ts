import { z } from "zod"

// ── Score schema (1-10 quality dimensions) ─────────────────────────────

export const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export type JudgeScore = z.infer<typeof judgeScoreSchema>

// ── Penalty schema (issue counts, negated at extraction) ───────────────

export const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.coerce.number().min(0),
})

export type PenaltyResult = z.infer<typeof penaltySchema>

// ── Penalty dimensions (issue counts, lower = better) ──────────────────

export const PENALTY_DIMENSIONS = ["telling", "dead-weight", "dialogue-problems"] as const
export type PenaltyDimension = typeof PENALTY_DIMENSIONS[number]

export const PENALTY_LABELS: Record<PenaltyDimension, string> = {
  "telling": "Telling",
  "dead-weight": "Dead Weight",
  "dialogue-problems": "Dialogue",
}

// ── Quality dimensions (1-10 scores, higher = better) ──────────────────

export const QUALITY_DIMENSIONS = ["prose-craft", "character-voice", "sensory-grounding"] as const
export type QualityDimension = typeof QUALITY_DIMENSIONS[number]

export const QUALITY_LABELS: Record<QualityDimension, string> = {
  "prose-craft": "Prose Craft",
  "character-voice": "Character Voice",
  "sensory-grounding": "Sensory Grounding",
}

// ── Backwards-compatible (penalty-only — used by experiment scripts) ───

export const DIMENSIONS = PENALTY_DIMENSIONS
export type Dimension = PenaltyDimension

export const DIMENSION_LABELS = PENALTY_LABELS

// ── Combined (all dimensions) ─────────────────────────────────────────

export const ALL_DIMENSIONS = [...PENALTY_DIMENSIONS, ...QUALITY_DIMENSIONS] as const
export type AnyDimension = PenaltyDimension | QualityDimension

export const ALL_DIMENSION_LABELS: Record<AnyDimension, string> = {
  ...PENALTY_LABELS,
  ...QUALITY_LABELS,
}

export function isPenaltyDimension(dim: string): dim is PenaltyDimension {
  return (PENALTY_DIMENSIONS as readonly string[]).includes(dim)
}

export function isQualityDimension(dim: string): dim is QualityDimension {
  return (QUALITY_DIMENSIONS as readonly string[]).includes(dim)
}
