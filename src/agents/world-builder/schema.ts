import { z } from "zod"
import { locationSchema } from "../../schemas/shared"

const worldSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().transform(v => {
    const valid = ["magic", "religion", "politics", "economy", "technology", "social"]
    if (valid.includes(v)) return v
    const map: Record<string, string> = {
      "artificial-intelligence": "technology", ai: "technology", computing: "technology",
      engineering: "technology", science: "technology", navigation: "technology",
      military: "politics", governance: "politics", law: "politics", bureaucracy: "politics",
      trade: "economy", commerce: "economy", currency: "economy", labor: "economy",
      faith: "religion", spiritual: "religion", ritual: "religion", mythology: "religion",
      arcane: "magic", sorcery: "magic", supernatural: "magic", alchemy: "magic",
      cultural: "social", class: "social", caste: "social", hierarchy: "social",
    }
    return map[v.toLowerCase()] ?? "technology"
  }),
  description: z.string(),
  rules: z.array(z.string()).default([]),
  manifestations: z.array(z.string()).default([]),
  vocabulary: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
})

const cultureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  values: z.array(z.string()).default([]),
  taboos: z.array(z.string()).default([]),
  speechInfluences: z.string().default(""),
  customs: z.array(z.string()).default([]),
  systemViews: z.record(z.string()).default({}),
})

export const schema = z.object({
  setting: z.string(),
  timePeriod: z.string(),
  geography: z.string(),
  politicalStructure: z.string(),
  technologyConstraints: z.string(),
  socialCustoms: z.array(z.string()),
  sensoryPalette: z.string(),
  rules: z.array(z.string()),
  locations: z.array(locationSchema),
  culture: z.string(),
  history: z.string(),
  systems: z.array(worldSystemSchema).default([]),
  cultures: z.array(cultureSchema).default([]),
})
export type WorldBible = z.infer<typeof schema>

export { worldSystemSchema, cultureSchema }
export const worldBibleSchema = schema
