import { z } from "zod"

export const schema = z.object({
  characters: z.array(z.object({
    name: z.string(),
    location: z.string().default("unknown"),
    emotionalState: z.string().default(""),
    knows: z.array(z.string()).default([]),
    doesNotKnow: z.array(z.string()).default([]),
  })).default([]),
})

export const characterStateUpdateSchema = schema
