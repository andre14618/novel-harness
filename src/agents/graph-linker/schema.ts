import { z } from "zod"

export const graphLinkerSchema = z.object({
  causalLinks: z.array(z.object({
    causeEventId: z.string().describe("UUID of the cause event (may be from a prior chapter)"),
    effectEventId: z.string().describe("UUID of the effect event (this chapter)"),
    relationship: z.enum(["causes", "enables", "prevents", "motivates"]),
    confidence: z.number().min(0).max(1).describe("How certain is this causal link"),
  })),

  knowledgePropagation: z.array(z.object({
    knowledgeId: z.string().describe("UUID of the character_knowledge entry"),
    fromCharacterId: z.string().nullable().describe("Character who transmitted (null if this is the origin)"),
    toCharacterId: z.string().describe("Character who received the knowledge"),
    viaEventId: z.string().nullable().describe("Timeline event where the transfer occurred (null if ambient)"),
    propagationType: z.enum(["origin", "told", "overheard", "deduced", "discovered"]),
    confidence: z.number().min(0).max(1).describe("1.0 = certain knowledge, 0.5 = suspects, 0.3 = vague impression"),
  })),

  themes: z.array(z.object({
    sourceType: z.enum(["fact", "event", "summary", "knowledge"]),
    sourceId: z.string().describe("UUID of the tagged entry"),
    theme: z.string().describe("Theme label — use story spine themes when possible, or introduce emergent themes"),
  })),
})

export type GraphLinkerOutput = z.infer<typeof graphLinkerSchema>
