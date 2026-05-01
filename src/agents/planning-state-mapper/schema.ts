import { z } from "zod"
import { beatObligationsSchema, payoffLinkSchema } from "../../schemas/shared"

const factCategoryMap: Record<string, string> = {
  spatial: "physical", environmental: "physical", geographic: "physical", appearance: "physical", visual: "physical", object: "physical", location: "physical",
  social: "relationship", interpersonal: "relationship", familial: "relationship", alliance: "relationship",
  belief: "knowledge", information: "knowledge", memory: "knowledge", secret: "knowledge", deduction: "knowledge", discovery: "knowledge", revelation: "knowledge", emotional: "knowledge", dialogue: "knowledge",
  legal: "rule", political: "rule", systemic: "rule", custom: "rule", constraint: "rule",
  personal: "identity", biographical: "identity", name: "identity",
  chronological: "temporal", historical: "temporal", sequential: "temporal", deadline: "temporal",
}

const knowledgeSourceValid = ["witnessed", "told", "overheard", "deduced", "read", "discovered"]

export const stateMapperBeatMappingSchema = z.object({
  beatIndex: z.number().int().nonnegative(),
  obligations: beatObligationsSchema,
  requiredPayoffs: z.array(payoffLinkSchema).default([]).catch([]),
})

export const planningStateMapperSchema = z.object({
  establishedFacts: z.array(z.object({
    id: z.string().default(""),
    fact: z.string(),
    category: z.string().transform(v => factCategoryMap[v.toLowerCase()] ?? v.toLowerCase()),
  })).default([]),

  characterStateChanges: z.array(
    z.preprocess(
      (v) => {
        if (!v || typeof v !== "object") return v
        const o = v as Record<string, unknown>
        if (!o.name && typeof o.characterName === "string") return { ...o, name: o.characterName }
        if (!o.name && typeof o.character === "string") return { ...o, name: o.character }
        return v
      },
      z.object({
        name: z.string(),
        location: z.string().default(""),
        emotionalState: z.string().default(""),
        knows: z.array(z.string()).default([]),
        doesNotKnow: z.array(z.string()).default([]),
      }),
    ),
  ).default([]),

  knowledgeChanges: z.array(z.object({
    characterName: z.string(),
    knowledge: z.string(),
    source: z.string().default("witnessed").transform(v =>
      knowledgeSourceValid.includes(v) ? v : "witnessed"
    ),
  })).default([]),

  beatMappings: z.array(stateMapperBeatMappingSchema).default([]),
})

export type StateMapperBeatMapping = z.infer<typeof stateMapperBeatMappingSchema>
export type PlanningStateMapperOutput = z.infer<typeof planningStateMapperSchema>
export const schema = planningStateMapperSchema
