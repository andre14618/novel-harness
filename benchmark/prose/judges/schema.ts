import { z } from "zod"

// ── Legacy 1-10 score schema (used by calibrate.ts, probe scripts) ──────

export const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export type JudgeScore = z.infer<typeof judgeScoreSchema>

// ── Penalty schema (used by benchmark runner) ───────────────────────────

export const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.coerce.number().min(0),
})

export type PenaltyResult = z.infer<typeof penaltySchema>

// ── Dimensions — penalty rubrics (lower = better) ───────────────────────

export const DIMENSIONS = ["telling", "dead-weight", "dialogue-problems"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "telling": "Telling",
  "dead-weight": "Dead Weight",
  "dialogue-problems": "Dialogue",
}

