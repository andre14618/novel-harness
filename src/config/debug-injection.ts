/**
 * Debug injection flags for the exhaustion-handler test campaign.
 * See docs/test-campaign-plan.md §"Debug injection — proposed env flags".
 *
 * Flags (all no-op when unset — zero production behavior change):
 *
 *   DEBUG_FORCE_PLAN_CHECK=fail
 *     Short-circuits chapter-plan-checker to always return pass=false with a
 *     synthetic forced deviation. Drives test runs R1/R6/R7.
 *
 *   DEBUG_FORCE_VALIDATION=pov|word-count
 *     Forces validateChapterDraft() to return a POV blocker or word-count
 *     warning. Only pov drives R5; word-count is advisory.
 *       pov        → 'POV character "X" never mentioned in draft'
 *       word-count → warning 'Chapter too short: 100 words (minimum 500)'
 *
 *   DEBUG_FORCE_REVISER=reject|throw
 *     Intercepts chapter-plan-reviser calls in drafting.ts.
 *       reject → returns a 1-scene plan so the scene-count sanity check rejects it.
 *       throw  → throws Error so the reviser-error path fires.
 *     Drives R6.
 *
 * Read once per attempt at the top of the attempt loop (not at module load
 * time) so a running orchestrator can pick up flag changes without restart.
 * The cost is trivial: three env reads per draft attempt.
 */

export type DebugInjection = {
  /** When "fail": synthesize a failing plan-check result instead of calling the LLM. */
  forcePlanCheck?: "fail"
  /** When set: force validateChapterDraft() to return this validation signal. */
  forceValidation?: "pov" | "word-count"
  /** When set: intercept chapter-plan-reviser to either reject or throw. */
  forceReviser?: "reject" | "throw"
}

/** Parse process.env once and return the active injection config. */
export function loadInjection(): DebugInjection {
  const inj: DebugInjection = {}

  const planCheck = process.env.DEBUG_FORCE_PLAN_CHECK
  if (planCheck === "fail") inj.forcePlanCheck = "fail"

  const validation = process.env.DEBUG_FORCE_VALIDATION
  if (validation === "pov") inj.forceValidation = "pov"
  else if (validation === "word-count") inj.forceValidation = "word-count"

  const reviser = process.env.DEBUG_FORCE_REVISER
  if (reviser === "reject") inj.forceReviser = "reject"
  else if (reviser === "throw") inj.forceReviser = "throw"

  return inj
}

/** Returns true if any injection flag is active. */
export function hasAnyInjection(i: DebugInjection): boolean {
  return i.forcePlanCheck !== undefined || i.forceValidation !== undefined || i.forceReviser !== undefined
}

/** One-line summary for log output. */
export function injectionSummary(i: DebugInjection): string {
  const parts: string[] = []
  if (i.forcePlanCheck) parts.push(`forcePlanCheck=${i.forcePlanCheck}`)
  if (i.forceValidation) parts.push(`forceValidation=${i.forceValidation}`)
  if (i.forceReviser) parts.push(`forceReviser=${i.forceReviser}`)
  return parts.join(", ")
}
