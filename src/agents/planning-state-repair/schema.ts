import { z } from "zod"
import { ID_RE } from "../../harness/ids"

export const repairObligationListSchema = z.enum([
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
])

export const repairSourceKindSchema = z.enum(["fact", "knowledge", "state", "payoff"])

// Stable-ID shape constraint. Catches LLM-emitted IDs with whitespace,
// uppercase, leading dashes, or other malformed shapes before the apply
// loop ever sees them. Aligns with `ID_RE` in src/harness/ids.ts.
const idStringSchema = z.string().regex(ID_RE, "must match stable-ID kebab-case shape")

export const addObligationOperationSchema = z.object({
  op: z.literal("addObligation"),
  beatId: idStringSchema,
  list: repairObligationListSchema,
  sourceId: idStringSchema,
  sourceKind: repairSourceKindSchema,
  characterId: z.preprocess(value => value === null ? undefined : value, idStringSchema.optional()),
  // Display text — accepted for round-trip but always overwritten with
  // the canonical source text in `addRepairObligation`. The agent cannot
  // hallucinate writer-visible obligation prose.
  text: z.string().optional().default(""),
})

export const removeObligationOperationSchema = z.object({
  op: z.literal("removeObligation"),
  beatId: idStringSchema,
  list: repairObligationListSchema,
  obligationId: idStringSchema,
})

export const planningStateRepairOperationSchema = z.discriminatedUnion("op", [
  addObligationOperationSchema,
  removeObligationOperationSchema,
])

// Cap operations per call. The agent should be emitting a minimal patch;
// 64 ops is far above the typical 1-8 errors-per-chapter budget and gives
// a defensive ceiling against LLM panic responses or prompt-injection.
const MAX_OPERATIONS_PER_CALL = 64

export const planningStateRepairSchema = z.object({
  operations: z.array(planningStateRepairOperationSchema).max(MAX_OPERATIONS_PER_CALL).default([]),
})

export type PlanningStateRepairOperation = z.infer<typeof planningStateRepairOperationSchema>
export type PlanningStateRepairOutput = z.infer<typeof planningStateRepairSchema>
export type RepairObligationList = z.infer<typeof repairObligationListSchema>

export const schema = planningStateRepairSchema
export const MAX_REPAIR_OPERATIONS_PER_CALL = MAX_OPERATIONS_PER_CALL
