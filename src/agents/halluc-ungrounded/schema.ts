import { z } from "zod"

/** Output schema for the bounded entity-grounding checker. */
export const hallucUngroundedSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.object({
    entity: z.string(),
    excerpt: z.string().default(""),
  })).default([]),
})

export type HallucUngroundedOutput = z.infer<typeof hallucUngroundedSchema>

/**
 * A NER-prepass finding: an ungrounded candidate surfaced by the deterministic
 * entity extractor before the LLM call. Carries the candidate class so
 * downstream tooling can distinguish suffix-class (high-recall) from
 * title-pair (precise) findings.
 *
 * Added in L4-followup-3 (exp #322) for AND-gate runtime wiring.
 */
export interface NerFinding {
  /** The exact phrase extracted from prose. */
  phrase: string
  /**
   * The NER candidate class that produced this finding.
   * Kept in sync with `EntityCandidateClass` in `src/lint/entity-candidates.ts`.
   * `x-of-y-capitalized` was added in L15; `number-word-tail` reserved for future use.
   */
  class: "title-pair" | "capitalized-multi-word" | "suffix-class" | "x-of-y-capitalized" | "number-word-tail"
}

/**
 * Extended result returned by `checkHallucUngrounded`.
 *
 * Back-compat: `pass` and `issues` carry the same semantics as before.
 * New optional fields (`nerFindings`, `nerOnlyFindings`) are omitted when the
 * NER prepass is disabled (variant v0 or v2). Consumers that only read
 * `pass`/`issues` are unaffected.
 */
export interface HallucUngroundedResult {
  pass: boolean
  issues: string[]
  /**
   * All NER candidates that were NOT grounded against the evidence surface.
   * Present when NER prepass ran (variants v1/v3/v4). Not present on v0/v2.
   */
  nerFindings?: NerFinding[]
  /**
   * Subset of `nerFindings` where ONLY NER fired (LLM passed). These are
   * warning-severity — the NER extractor saw something suspicious but the LLM
   * checker did not confirm. Absent when NER prepass did not run.
   */
  nerOnlyFindings?: NerFinding[]
}
