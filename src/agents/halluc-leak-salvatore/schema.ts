import { z } from "zod"

/**
 * Output schema for the `halluc-leak-salvatore-v1:v1` W&B adapter.
 * Shape matches the training pairs produced by
 * `scripts/hallucination/format-v3-two-adapters.ts` — see the
 * LEAK_SYSTEM constant there for the labeling rubric.
 */
export const hallucLeakSalvatoreSchema = z.object({
  has_leak: z.boolean(),
  leaks: z.array(z.string()).default([]),
})

export type HallucLeakSalvatoreOutput = z.infer<typeof hallucLeakSalvatoreSchema>
