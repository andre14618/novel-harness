import { z } from "zod"

export const detectionScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  detectionRate: z.coerce.number().min(0).max(1).optional(),
  falsePositiveCount: z.coerce.number().min(0).optional(),
  reasoning: z.string().min(1),
})

export const fixQualitySchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

export const DIMENSIONS = ["detection", "fix-quality"] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "detection": "Issue Detection",
  "fix-quality": "Fix Quality",
}
