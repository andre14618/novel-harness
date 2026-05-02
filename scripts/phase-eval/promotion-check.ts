/**
 * Promotion-eligibility check for phase-eval probe verdicts.
 *
 * A single SCREEN-PASS at n=10 chapters is suggestive, not promotion-grade —
 * G1/G2 medians swing 2-3 across reruns of the same prompt (exp #311
 * r1/r2/r3 noise-baseline; lessons-learned.md "n=10 single-run probe
 * verdicts flap on stochastic planner output").
 *
 * PROMOTION-PASS requires this run + at least one prior SCREEN-PASS at the
 * same (probe_name, test_variant, git_commit, seed). git_commit and seed
 * must match because:
 * - Different commits = different prompt; can't count as repeat evidence
 * - Different seeds = different distribution; treat each seed independently
 *
 * The check looks up the most recent N runs in `phase_eval_runs` for that
 * tuple (excluding the row about to be inserted, since this check runs
 * BEFORE persistence). Returns eligible=true if at least one prior run
 * verdict starts with "SCREEN-PASS" (matches both "SCREEN-PASS" legacy
 * format and "SCREEN-PASS-SUGGESTIVE" / "PROMOTION-PASS" new format).
 */

import db from "../../src/db/connection"

export interface PromotionCheckInput {
  probeName: string
  testVariant: string
  gitCommit: string
  seed: string
  /** How many most-recent rows to consider. Default 5. */
  lookbackLimit?: number
}

export interface PromotionDecision {
  eligible: boolean
  priorPassCount: number
  priorRows: Array<{ id: number; ranAt: string; verdict: string }>
}

/**
 * Returns true when the current run plus at least one prior run for the
 * exact same (probe, variant, commit, seed) tuple has SCREEN-PASS-class
 * verdict. The CURRENT run isn't yet persisted at the time of check, so
 * "1 prior pass" + this run = 2 consecutive = promotion-eligible.
 */
export async function checkPromotionEligibility(
  input: PromotionCheckInput
): Promise<PromotionDecision> {
  const limit = input.lookbackLimit ?? 5

  // Filter:
  // - probe_name matches (same probe shape)
  // - test_variant in variant_labels (the variant under test)
  // - git_commit matches (same prompt bytes)
  // - seed in seeds_used (same seed)
  // - verdict starts with SCREEN-PASS or PROMOTION-PASS — matches all
  //   pass-class labels (legacy "SCREEN-PASS", new
  //   "SCREEN-PASS-SUGGESTIVE", and "PROMOTION-PASS" upgrades count
  //   equally as prior passes).
  const rows = (await db`
    SELECT id, ran_at, verdict
    FROM phase_eval_runs
    WHERE probe_name = ${input.probeName}
      AND ${input.testVariant} = ANY(variant_labels)
      AND git_commit = ${input.gitCommit}
      AND ${input.seed} = ANY(seeds_used)
      AND (verdict LIKE 'SCREEN-PASS%' OR verdict LIKE 'PROMOTION-PASS%')
    ORDER BY ran_at DESC
    LIMIT ${limit}
  `) as Array<{ id: number; ran_at: Date; verdict: string }>

  return {
    eligible: rows.length >= 1,
    priorPassCount: rows.length,
    priorRows: rows.map(r => ({
      id: r.id,
      ranAt: new Date(r.ran_at).toISOString(),
      verdict: r.verdict,
    })),
  }
}
