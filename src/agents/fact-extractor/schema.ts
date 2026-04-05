import { z } from "zod"

export const schema = z.object({
  facts: z.array(z.object({
    fact: z.string(),
    category: z.string().transform(v => {
      const valid = ["physical", "rule", "relationship", "knowledge", "identity", "temporal"]
      if (valid.includes(v)) return v
      const map: Record<string, string> = {
        spatial: "physical", environmental: "physical", geographic: "physical", appearance: "physical",
        visual: "physical", object: "physical", location: "physical",
        social: "relationship", interpersonal: "relationship", familial: "relationship", alliance: "relationship",
        belief: "knowledge", information: "knowledge", memory: "knowledge", secret: "knowledge",
        deduction: "knowledge", discovery: "knowledge", revelation: "knowledge",
        legal: "rule", political: "rule", systemic: "rule", custom: "rule", constraint: "rule",
        chronological: "temporal", historical: "temporal", sequential: "temporal", deadline: "temporal",
        personal: "identity", biographical: "identity", name: "identity",
        // Map removed categories to closest match
        action: "physical", sensory: "physical", emotional: "knowledge",
        dialogue: "knowledge",
      }
      return map[v.toLowerCase()] ?? "physical"
    }),
  })),
})

export const factExtractionSchema = schema
