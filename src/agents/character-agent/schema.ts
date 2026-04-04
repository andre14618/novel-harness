import { z } from "zod"
import { relationshipSchema } from "../../schemas/shared"

export const characterProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  backstory: z.string().default(""),
  traits: z.array(z.string()).default([]),
  speechPattern: z.string().default(""),
  internalConflict: z.string().optional(),
  avoids: z.string().optional(),
  goals: z.string().default(""),
  fears: z.string().default(""),
  relationships: z.array(relationshipSchema).default([]),
})
export type CharacterProfile = z.infer<typeof characterProfileSchema>

export const schema = z.object({
  characters: z.array(characterProfileSchema),
})

export const characterProfilesSchema = schema
