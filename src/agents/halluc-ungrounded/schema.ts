import { z } from "zod"

/**
 * Output schema for the `halluc-ungrounded-v2:v1` W&B adapter. Shape
 * matches the training pairs produced by
 * `scripts/hallucination/format-v3-two-adapters.ts` — see the
 * UNGROUNDED_SYSTEM constant there for the labeling rubric.
 */
export const hallucUngroundedSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.object({
    entity: z.string(),
    excerpt: z.string().default(""),
  })).default([]),
})

export type HallucUngroundedOutput = z.infer<typeof hallucUngroundedSchema>
