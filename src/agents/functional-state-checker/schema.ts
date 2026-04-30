import { z } from "zod"

export const functionalStateFindingSchema = z.object({
  kind: z.enum([
    "established_fact_missing",
    "knowledge_change_missing",
    "character_state_missing",
    "planned_state_contradicted",
  ]),
  planned_item: z.string(),
  beat_index: z.number().int().nullable().default(null),
  evidence_quote: z.string().default(""),
  explanation: z.string(),
}).strict()

export const functionalStateCheckerSchema = z.object({
  pass: z.boolean(),
  findings: z.array(functionalStateFindingSchema).default([]),
}).strict()

export type FunctionalStateCheckerOutput = z.infer<typeof functionalStateCheckerSchema>
export type FunctionalStateCheckerFinding = z.infer<typeof functionalStateFindingSchema>
