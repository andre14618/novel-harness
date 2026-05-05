import { z } from "zod"

export const functionalStateFindingSchema = z.object({
  kind: z.enum([
    "established_fact_missing",
    "knowledge_change_missing",
    "character_state_missing",
    "planned_state_contradicted",
  ]),
  planned_item: z.string(),
  // Stable-ID coverage (2026-05-04, additive). The model is instructed in the
  // system prompt to copy this only when the matched PLANNED_STATE item has
  // its own `id` field. Optional because legacy / un-enriched outlines and
  // pre-2026-05-04 callers do not supply ids; the wrapper resolves the id
  // deterministically when this field is absent. See
  // `docs/stable-id-checker-coverage.md`.
  planned_item_id: z.string().optional(),
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
