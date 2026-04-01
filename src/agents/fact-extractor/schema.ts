import { z } from "zod"

export const schema = z.object({
  facts: z.array(z.object({
    fact: z.string(),
    category: z.enum(["physical", "rule", "relationship", "knowledge"]),
  })),
})

export const factExtractionSchema = schema
