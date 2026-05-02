/**
 * Promotion-eligibility check test.
 *
 * Verifies the (probe, variant, commit, seed) tuple lookup correctly counts
 * prior SCREEN-PASS-class runs and decides eligible=true only when at least
 * one prior pass exists. Skipped via top-level await reachability ping when
 * Postgres is unreachable.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../../src/db/connection"
import { dbReachable } from "../../src/db/test-helpers"
import { checkPromotionEligibility } from "./promotion-check"

const reachable = await dbReachable()

const TEST_PROBE = `test-promotion-check-${Date.now()}`
const TEST_COMMIT = "abc12345"
const TEST_SEED = "test-seed-x"
const TEST_VARIANT = "test-variant"

async function clean() {
  await db`DELETE FROM phase_eval_runs WHERE probe_name = ${TEST_PROBE}`
}

// pg array literal: bun-pg serializes JS arrays as JSON which Postgres
// rejects for text[] columns. The persist-run helper hand-formats the
// {a,b,c} array literal; mirror that here so test inserts go through.
function pgArrayLit(xs: string[]): string {
  if (xs.length === 0) return "{}"
  const escaped = xs.map(x => `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
  return `{${escaped.join(",")}}`
}

async function insertRow(verdict: string) {
  await db`
    INSERT INTO phase_eval_runs (probe_name, git_commit, seeds_used, variant_labels, summary_json, verdict)
    VALUES (
      ${TEST_PROBE},
      ${TEST_COMMIT},
      ${pgArrayLit([TEST_SEED])}::text[],
      ${pgArrayLit([TEST_VARIANT])}::text[],
      ${'{}'}::jsonb,
      ${verdict}
    )
  `
}

describe.skipIf(!reachable)("checkPromotionEligibility", () => {
  beforeEach(clean)
  afterEach(clean)

  test("eligible=false when no prior runs exist for the tuple", async () => {
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: TEST_COMMIT,
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.priorPassCount).toBe(0)
  })

  test("eligible=true when one prior SCREEN-PASS exists for the tuple", async () => {
    await insertRow("SCREEN-PASS — variant cleared G1, G2, G3, G4")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: TEST_COMMIT,
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(true)
    expect(decision.priorPassCount).toBe(1)
  })

  test("counts SCREEN-PASS-SUGGESTIVE and PROMOTION-PASS as prior passes", async () => {
    await insertRow("SCREEN-PASS-SUGGESTIVE — variant cleared G1, G2, G3, G4 (single-run)")
    await insertRow("PROMOTION-PASS — variant cleared G1-G4 on this run AND 1 prior consecutive pass(es)")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: TEST_COMMIT,
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(true)
    expect(decision.priorPassCount).toBe(2)
  })

  test("ignores SCREEN-FAIL prior rows", async () => {
    await insertRow("SCREEN-FAIL (non-compliant) — variant ran but failed: G1")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: TEST_COMMIT,
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.priorPassCount).toBe(0)
  })

  test("does not match a prior pass at a different commit", async () => {
    await insertRow("SCREEN-PASS — variant cleared G1, G2, G3, G4")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: "different-commit",
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.priorPassCount).toBe(0)
  })

  test("does not match a prior pass at a different seed", async () => {
    await insertRow("SCREEN-PASS — variant cleared G1, G2, G3, G4")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: TEST_VARIANT,
      gitCommit: TEST_COMMIT,
      seed: "different-seed",
    })
    expect(decision.eligible).toBe(false)
    expect(decision.priorPassCount).toBe(0)
  })

  test("does not match a different test_variant within the same probe", async () => {
    await insertRow("SCREEN-PASS — variant cleared G1, G2, G3, G4")
    const decision = await checkPromotionEligibility({
      probeName: TEST_PROBE,
      testVariant: "different-variant",
      gitCommit: TEST_COMMIT,
      seed: TEST_SEED,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.priorPassCount).toBe(0)
  })
})
