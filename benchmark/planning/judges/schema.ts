import { z } from "zod"

export const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export const DIMENSIONS = ["beat-specificity", "dialogue-cues", "emotional-arc"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "beat-specificity": "Beat Specificity",
  "dialogue-cues": "Dialogue Cues",
  "emotional-arc": "Emotional Arc",
}
