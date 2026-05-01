import { z } from "zod"

export const repairObligationListSchema = z.enum([
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
])

export const repairSourceKindSchema = z.enum(["fact", "knowledge", "state", "payoff"])

export const addObligationOperationSchema = z.object({
  op: z.literal("addObligation"),
  beatId: z.string(),
  list: repairObligationListSchema,
  sourceId: z.string(),
  sourceKind: repairSourceKindSchema,
  characterId: z.preprocess(value => value === null ? undefined : value, z.string().optional()),
  text: z.string(),
})

export const removeObligationOperationSchema = z.object({
  op: z.literal("removeObligation"),
  beatId: z.string(),
  list: repairObligationListSchema,
  obligationId: z.string(),
})

export const planningStateRepairOperationSchema = z.discriminatedUnion("op", [
  addObligationOperationSchema,
  removeObligationOperationSchema,
])

export const planningStateRepairSchema = z.object({
  operations: z.array(planningStateRepairOperationSchema).default([]),
})

export type PlanningStateRepairOperation = z.infer<typeof planningStateRepairOperationSchema>
export type PlanningStateRepairOutput = z.infer<typeof planningStateRepairSchema>
export type RepairObligationList = z.infer<typeof repairObligationListSchema>

export const schema = planningStateRepairSchema
