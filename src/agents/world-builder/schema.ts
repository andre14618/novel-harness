import { z } from "zod"
import { locationSchema } from "../../schemas/shared"

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
})
export type WorldBible = z.infer<typeof schema>

export const worldBibleSchema = schema
