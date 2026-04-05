import { z } from "zod"

export const schema = z.object({
  facts: z.array(z.object({
    fact: z.string(),
    category: z.string().transform(v => {
      const valid = ["physical", "action", "rule", "relationship", "knowledge", "sensory", "temporal", "emotional", "identity", "dialogue"]
      if (valid.includes(v)) return v
      const map: Record<string, string> = {
        visual: "sensory", auditory: "sensory", tactile: "sensory", olfactory: "sensory",
        spatial: "physical", environmental: "physical", geographic: "physical", appearance: "physical",
        behavioral: "action", movement: "action", gesture: "action",
        social: "relationship", interpersonal: "relationship", familial: "relationship",
        belief: "knowledge", information: "knowledge", memory: "knowledge", cultural: "knowledge",
        legal: "rule", political: "rule", systemic: "rule", custom: "rule",
        chronological: "temporal", historical: "temporal", sequential: "temporal",
        psychological: "emotional", motivational: "emotional", internal: "emotional",
        personal: "identity", biographical: "identity", trait: "identity",
        speech: "dialogue", verbal: "dialogue", conversational: "dialogue",
      }
      return map[v.toLowerCase()] ?? "physical"
    }),
  })),
})

export const factExtractionSchema = schema
