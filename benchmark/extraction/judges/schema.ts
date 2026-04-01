import { z } from "zod"

export const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export const DIMENSIONS = ["completeness", "accuracy"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "completeness": "Completeness",
  "accuracy": "Accuracy",
}
