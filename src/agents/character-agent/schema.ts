import { z } from "zod"
import { relationshipSchema } from "../../schemas/shared"

const culturalBackgroundSchema = z.object({
  cultureName: z.string(),
  relationship: z.enum(["native", "adopted", "outsider", "rebel", "exile"]).default("native"),
})

const systemAwarenessSchema = z.object({
  systemName: z.string(),
  level: z.enum(["ignorant", "rumors", "aware", "practitioner", "expert"]).default("aware"),
  perspective: z.string().default(""),
})

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
  culturalBackground: z.array(culturalBackgroundSchema).default([]),
  systemAwareness: z.array(systemAwarenessSchema).default([]),
})
export type CharacterProfile = z.infer<typeof characterProfileSchema>

export const schema = z.object({
  characters: z.array(characterProfileSchema),
})

export const characterProfilesSchema = schema
