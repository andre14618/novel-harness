import { z } from "zod"

export const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export type JudgeScore = z.infer<typeof judgeScoreSchema>

export const DIMENSIONS = ["show-tell", "dialogue", "sensory"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "show-tell": "Show/Tell",
  "dialogue": "Dialogue",
  "sensory": "Sensory",
}
