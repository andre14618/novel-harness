import { z } from "zod"
import { continuityIssueSchema } from "../../schemas/shared"

export const schema = z.object({
  fact_checks: z.array(z.object({
    fact_id: z.string(),
    status: z.enum(["consistent", "contradicted", "ambiguous"]),
    evidence: z.string(),
  })).optional(),
  state_checks: z.array(z.object({
    character: z.string(),
    location_consistent: z.union([z.boolean(), z.literal("not_mentioned")]),
    knowledge_consistent: z.union([z.boolean(), z.literal("not_mentioned")]),
    notes: z.string(),
  })).optional(),
  figurative_review: z.array(z.object({
    passage: z.string(),
    classification: z.enum(["figurative", "dramatic_irony", "character_lie", "literal"]),
    reasoning: z.string(),
  })).optional(),
  derived_issues: z.array(z.object({
    from_check: z.string(),
    severity: z.string(),
    reasoning: z.string(),
  })).optional(),
  issues: z.array(continuityIssueSchema),
})

export const continuityCheckSchema = schema
