import { z } from "zod"

// ── Penalty schema (issue counts, negated at extraction) ───────────────

export const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.coerce.number().min(0),
})

export type PenaltyResult = z.infer<typeof penaltySchema>

// ── Dimensions (issue counts, lower = better) ──────────────────────────

export const DIMENSIONS = ["telling", "dead-weight", "dialogue-problems"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "telling": "Telling",
  "dead-weight": "Dead Weight",
  "dialogue-problems": "Dialogue",
}

// ── Aliases for backwards compat ───────────────────────────────────────

export const PENALTY_DIMENSIONS = DIMENSIONS
export type PenaltyDimension = Dimension
export const PENALTY_LABELS = DIMENSION_LABELS
