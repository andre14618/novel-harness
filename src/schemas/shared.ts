import { z } from "zod"

// Sub-schemas referenced by multiple agents

export const locationSchema = z.object({
  name: z.string(),
  description: z.string(),
  sensoryDetails: z.string().optional(),
})

export const relationshipSchema = z.object({
  characterName: z.string(),
  nature: z.string(),
})

export const actSchema = z.object({
  number: z.number(),
  name: z.string(),
  summary: z.string(),
  emotionalArc: z.string(),
  turningPoint: z.string().optional(),
})

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  emotionalShift: z.string().default(""),
})
export type SceneBeat = z.infer<typeof sceneBeatSchema>

export const continuityIssueSchema = z.object({
  severity: z.enum(["blocker", "warning", "nit"]).default("nit"),
  description: z.string(),
  conflictsWith: z.string().optional(),
  suggestedFix: z.string().optional(),
})
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>
