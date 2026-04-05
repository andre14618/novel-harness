import { z } from "zod"

const stringOrArray = z.union([z.array(z.string()), z.string().transform(s => s ? [s] : [])]).default([])

export const schema = z.object({
  characters: z.array(z.object({
    name: z.string(),
    location: z.string().default("unknown"),
    emotionalState: z.string().default(""),
    knows: stringOrArray,
    doesNotKnow: stringOrArray,
  })).default([]),
})

export const characterStateUpdateSchema = schema
