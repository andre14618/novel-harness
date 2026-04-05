import { z } from "zod"

const relationshipChangeSchema = z.object({
  characterA: z.string(),
  characterB: z.string(),
  trustLevel: z.enum(["deep_trust", "trust", "cautious", "neutral", "wary", "suspicious", "hostile"]).default("neutral"),
  dynamic: z.string(),
  tension: z.string().default(""),
  recentShift: z.string().default(""),
})

const timelineEventSchema = z.object({
  event: z.string(),
  location: z.string().default(""),
  participants: z.array(z.string()).default([]),
  witnesses: z.array(z.string()).default([]),
  consequences: z.string().default(""),
})

const knowledgeGainSchema = z.object({
  characterName: z.string(),
  knowledge: z.string(),
  source: z.string().default("witnessed").transform(v => {
    const valid = ["witnessed", "told", "overheard", "deduced", "read", "discovered"]
    if (valid.includes(v)) return v
    const map: Record<string, string> = {
      seen: "witnessed", saw: "witnessed", observed: "witnessed", watched: "witnessed",
      heard: "overheard", listening: "overheard", eavesdropped: "overheard",
      figured: "deduced", inferred: "deduced", concluded: "deduced", realized: "deduced",
      found: "discovered", uncovered: "discovered", learned: "told",
      informed: "told", shared: "told", revealed: "told",
    }
    return map[v.toLowerCase()] ?? "witnessed"
  }),
  category: z.string().default("event").transform(v => {
    const valid = ["event", "secret", "relationship", "system", "location", "identity"]
    return valid.includes(v) ? v : "event"
  }),
  isFalse: z.boolean().default(false),
})

const awarenessChangeSchema = z.object({
  characterName: z.string(),
  systemName: z.string(),
  newLevel: z.enum(["ignorant", "rumors", "aware", "practitioner", "expert"]),
  reason: z.string(),
})

export const schema = z.object({
  relationshipChanges: z.array(relationshipChangeSchema).default([]),
  timelineEvents: z.array(timelineEventSchema).default([]),
  knowledgeGains: z.array(knowledgeGainSchema).default([]),
  awarenessChanges: z.array(awarenessChangeSchema).default([]),
})

export type RelationshipTimelineExtraction = z.infer<typeof schema>
export const relationshipTimelineSchema = schema
