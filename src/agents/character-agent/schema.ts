import { z } from "zod"
import { relationshipSchema } from "../../schemas/shared"
import { isValidCharacterName } from "../../schemas/planning-directives"

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
  name: z.string().refine(isValidCharacterName, {
    message: "Character name must be a proper name, not an archetype ('the cannibal', 'the scholar') or role word. Put archetype descriptions in `role` or `traits` instead.",
  }),
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
  // Voice anchors — 3–5 representative dialogue lines this character would
  // plausibly speak. Injected into beat-writer context so the writer can
  // condition dialogue on character voice. Populated at concept phase by
  // the character-agent or accumulated from prior chapters.
  exampleLines: z.array(z.string()).default([]),
  // Character arc structure (LTWN) — corpus-derived from Crystal Shard
  // calibration (CELL PASS, F1=1.00, 2026-04-29). Optional so legacy
  // novels round-trip. New novels should populate all five fields.
  lie: z.string().optional(),
  truth: z.string().optional(),
  want: z.string().optional(),
  need: z.string().optional(),
  arc_resolution: z.enum(["fulfilled", "partial", "tragic_inversion", "static"]).optional(),
})
export type CharacterProfile = z.infer<typeof characterProfileSchema>

export const schema = z.object({
  characters: z.array(characterProfileSchema),
})

export const characterProfilesSchema = schema
