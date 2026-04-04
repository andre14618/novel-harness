import { z } from "zod"

export const schema = z.object({
  facts: z.array(z.object({
    fact: z.string(),
    category: z.enum(["physical", "action", "rule", "relationship", "knowledge", "sensory", "temporal", "emotional", "identity", "dialogue"]),
  })),
})

export const factExtractionSchema = schema
