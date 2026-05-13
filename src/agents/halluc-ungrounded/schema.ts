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

export type HallucEntityRefKind = "character" | "world_system" | "culture"

export interface HallucEntityRef {
  kind: HallucEntityRefKind
  ref: string
  label: string
  matchedName: string
  match: "exact" | "title-stripped-exact"
}

export interface HallucIssueMetadata {
  entity: string
  excerpt: string
  entityRefs: HallucEntityRef[]
}

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
   * `x-of-y-capitalized` and `number-word-tail` were added in L15;
   * `initials` and `capitalized-first-only` added in L23a (exp #341).
   */
  class: "title-pair" | "capitalized-multi-word" | "suffix-class" | "x-of-y-capitalized" | "number-word-tail" | "initials" | "capitalized-first-only"
  /**
   * Additive stable-ref coverage. Populated only when the finding phrase
   * deterministically matches an existing character/world-system/culture
   * identity. Usually empty for true ungrounded entities.
   */
  entityRefs?: HallucEntityRef[]
}

/**
 * Extended result returned by `checkHallucUngrounded`.
 *
 * Back-compat: `pass` and `issues` carry the same semantics as before.
 * New optional fields (`nerFindings`, `nerOnlyFindings`, `issuesSeverity`)
 * are omitted when the NER prepass is disabled (variant v0 or v2). Consumers
 * that only read `pass`/`issues` are unaffected.
 */
export interface HallucUngroundedResult {
  pass: boolean
  issues: string[]
  /**
   * Parallel severity array for `issues`. When present, `issuesSeverity[i]`
   * gives the severity of `issues[i]`. Absent on v0/v2 (all issues are
   * implicitly blocker-class when the prepass is disabled).
   *
   * L31a: NER-only-warning issues carry `"warning"`; all other issue paths
   * carry `"blocker"`. Consumers (`runSceneChecks`) use this to avoid spending
   * beat retry budget on warning-class entities the LLM already approved.
   */
  issuesSeverity?: Array<"blocker" | "warning">
  /**
   * Parallel metadata for `issues`. `issueMetadata[i]` describes the entity
   * named by `issues[i]` and carries deterministic stable refs when the
   * checker can prove an exact match. The human-readable issue strings remain
   * the behavior contract.
   */
  issueMetadata?: HallucIssueMetadata[]
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
