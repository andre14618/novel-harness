import { z } from "zod"

/**
 * Graph-linker schema — LLM describes connections in natural language.
 * Code resolves descriptions to actual DB IDs deterministically.
 * No UUIDs in LLM output.
 */

export const graphLinkerSchema = z.object({
  causalLinks: z.array(z.object({
    causeDescription: z.string().describe("Brief description of the cause event"),
    effectDescription: z.string().describe("Brief description of the effect event"),
    relationship: z.string().default("causes").transform(v => {
      const valid = ["causes", "enables", "prevents", "motivates"]
      if (valid.includes(v)) return v
      // Map common variants deterministically
      const map: Record<string, string> = {
        supports: "enables", refines: "enables", leads_to: "causes",
        triggers: "causes", blocks: "prevents", stops: "prevents",
        inspires: "motivates", drives: "motivates", caused: "causes",
        enabled: "enables", prevented: "prevents", motivated: "motivates",
      }
      return map[v.toLowerCase()] ?? "causes"
    }),
    confidence: z.number().min(0).max(1).default(0.8),
    reasoning: z.string().optional().describe("Why this causal link exists"),
  })).default([]),

  knowledgePropagation: z.array(z.object({
    characterName: z.string().describe("Character who received the knowledge"),
    knowledge: z.string().describe("What they learned — match the knowledge text from the input"),
    fromCharacterName: z.string().nullable().default(null).describe("Who transmitted it (null if origin)"),
    propagationType: z.enum(["origin", "told", "overheard", "deduced", "discovered"]).default("origin"),
    confidence: z.number().min(0).max(1).default(1.0),
  })).default([]),

  themes: z.array(z.object({
    description: z.string().describe("Which event or fact this applies to — match text from input"),
    theme: z.string().describe("Theme label, 1-3 words, lowercase"),
  })).default([]),
}).passthrough().transform(d => ({
  // Normalize any snake_case variants
  causalLinks: d.causalLinks ?? d.causal_links ?? [],
  knowledgePropagation: d.knowledgePropagation ?? d.knowledge_propagation ?? [],
  themes: d.themes ?? d.thematicTags ?? d.thematic_tags ?? [],
}))

export type GraphLinkerOutput = {
  causalLinks: Array<{ causeDescription: string; effectDescription: string; relationship: string; confidence: number; reasoning?: string }>
  knowledgePropagation: Array<{ characterName: string; knowledge: string; fromCharacterName: string | null; propagationType: string; confidence: number }>
  themes: Array<{ description: string; theme: string }>
}
