import { z } from "zod"
import { locationSchema } from "../../schemas/shared"

const worldSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["magic", "religion", "politics", "economy", "technology", "social"]),
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
