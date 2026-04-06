import { z } from "zod"
import { relationshipSchema } from "../../schemas/shared"

const culturalBackgroundSchema = z.object({
  cultureName: z.string(),
  relationship: z.string().default("native").transform(v => {
    const valid = ["native", "adopted", "outsider", "rebel", "exile"]
    if (valid.includes(v)) return v
    const map: Record<string, string> = {
      returnee: "native", born: "native", local: "native", indigenous: "native",
      immigrant: "adopted", convert: "adopted", newcomer: "adopted", settler: "adopted",
      foreigner: "outsider", stranger: "outsider", visitor: "outsider", traveler: "outsider",
      dissident: "rebel", reformer: "rebel", revolutionary: "rebel", resistance: "rebel",
      banished: "exile", expelled: "exile", outcast: "exile", fugitive: "exile",
    }
    return map[v.toLowerCase()] ?? "outsider"
  }),
})

const systemAwarenessSchema = z.object({
  systemName: z.string(),
  level: z.string().default("aware").transform(v => {
    const valid = ["ignorant", "rumors", "aware", "practitioner", "expert"]
    if (valid.includes(v)) return v
    const map: Record<string, string> = {
      unknown: "ignorant", unaware: "ignorant", oblivious: "ignorant",
      heard: "rumors", hearsay: "rumors", gossip: "rumors", vague: "rumors",
      knows: "aware", familiar: "aware", understands: "aware", informed: "aware",
      skilled: "practitioner", trained: "practitioner", practicing: "practitioner",
      master: "expert", mastered: "expert", advanced: "expert",
    }
    return map[v.toLowerCase()] ?? "aware"
  }),
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
