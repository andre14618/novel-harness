import { z } from "zod"

const rawContextJudgeSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
  diagnostics: z.array(z.string()).describe("Specific actionable findings for the improvement daemon"),
})

// Transform: merge diagnostics into reasoning so the engine's `result.data.reasoning`
// includes all diagnostic detail for the improver to consume.
export const contextJudgeSchema = rawContextJudgeSchema.transform(data => ({
  score: data.score,
  reasoning: data.diagnostics.length > 0
    ? `${data.reasoning}\n\nDIAGNOSTICS:\n${data.diagnostics.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
    : data.reasoning,
}))

export type ContextJudgeScore = z.infer<typeof rawContextJudgeSchema>

export const CONTEXT_DIMENSIONS = [
  "relevance",
  "completeness",
  "noise",
  "causal-depth",
  "knowledge-accuracy",
] as const

export type ContextDimension = typeof CONTEXT_DIMENSIONS[number]

export const CONTEXT_DIMENSION_LABELS: Record<ContextDimension, string> = {
  "relevance": "Relevance",
  "completeness": "Completeness",
  "noise": "Noise (inverted)",
  "causal-depth": "Causal Depth",
  "knowledge-accuracy": "Knowledge Accuracy",
}
