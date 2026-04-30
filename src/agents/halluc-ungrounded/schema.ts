import { z } from "zod"

/** Output schema for the bounded entity-grounding checker. */
export const hallucUngroundedSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.object({
    entity: z.string(),
    excerpt: z.string().default(""),
  })).default([]),
})

export type HallucUngroundedOutput = z.infer<typeof hallucUngroundedSchema>
