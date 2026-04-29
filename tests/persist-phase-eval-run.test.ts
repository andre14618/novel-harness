/**
 * Smoke test for persistPhaseEvalRun().
 *
 * Inserts a fixture row, SELECTs it back, asserts every column round-
 * trips cleanly. Catches schema drift if anyone touches
 * sql/033_phase_eval_runs.sql or scripts/phase-eval/persist-run.ts later.
 *
 * Designed per docs/designs/eval-testing-module-v1.md (R6) §6 + §7 M3.
 *
 * Skipped automatically if DATABASE_URL is not set (so local-only runs
 * without LXC tunnel don't fail noisily). Intended to run on the LXC
 * orchestrator's local Postgres.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import db from "../src/db/connection"
import { persistPhaseEvalRun, currentGitCommit } from "../scripts/phase-eval/persist-run"

const SMOKE_PROBE_NAME = "phase-eval-smoke-test"

async function dbReachable(): Promise<boolean> {
  if (!(process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL)) return false
  try {
    await db`SELECT 1`
    return true
  } catch {
    return false
  }
}

describe("persist-phase-eval-run", () => {
  let reachable = false
  beforeAll(async () => {
    reachable = await dbReachable()
    if (reachable) {
      await db`DELETE FROM phase_eval_runs WHERE probe_name = ${SMOKE_PROBE_NAME}`
    }
  })
  afterAll(async () => {
    if (reachable) {
      await db`DELETE FROM phase_eval_runs WHERE probe_name = ${SMOKE_PROBE_NAME}`
    }
  })

  test("round-trip every column", async () => {
    if (!reachable) return  // graceful skip — no DB tunnel

    const summaryFixture = {
      seed: "fantasy-system-heretic",
      runTag: "smoke-test-fixture",
      conceptSnapshotId: "smoke-snap-id",
      variantDir: "/tmp/smoke",
      variants: [
        { id: "default", promptFile: "/tmp/default.md", outlinesPath: "default/outlines.json" },
        { id: "loud", promptFile: "/tmp/loud.md", outlinesPath: "loud/outlines.json" },
      ],
      g_metrics: {
        default_facts_median: 5,
        loud_facts_median: 8,
        default_know_median: 3,
        loud_know_median: 5,
        default_total_beats: 39,
        loud_total_beats: 43,
      },
      gates: { G1: true, G2: true, G3: true, G4: true },
      expected_chapters: 3,
    }

    const id = await persistPhaseEvalRun({
      probeName: SMOKE_PROBE_NAME,
      gitCommit: currentGitCommit(),
      experimentId: null,
      seedsUsed: ["fantasy-system-heretic"],
      variantLabels: ["default", "loud"],
      summaryJson: summaryFixture,
      verdict: "SCREEN-PASS — smoke fixture",
      notes: "round-trip smoke",
    })

    expect(id).toBeGreaterThan(0)

    const rows = await db`
      SELECT id, probe_name, git_commit, experiment_id,
             seeds_used, variant_labels, summary_json, verdict, notes
      FROM phase_eval_runs
      WHERE id = ${id}
    `
    expect(rows.length).toBe(1)
    const r = rows[0] as any

    expect(r.probe_name).toBe(SMOKE_PROBE_NAME)
    expect(typeof r.git_commit).toBe("string")
    expect(r.experiment_id).toBeNull()
    expect(r.seeds_used).toEqual(["fantasy-system-heretic"])
    expect(r.variant_labels).toEqual(["default", "loud"])
    expect(r.verdict).toBe("SCREEN-PASS — smoke fixture")
    expect(r.notes).toBe("round-trip smoke")

    // summary_json round-trip — JSONB normalization may reorder keys but
    // the deep-equal of the parsed object should match.
    const stored = typeof r.summary_json === "string"
      ? JSON.parse(r.summary_json)
      : r.summary_json
    expect(stored).toEqual(summaryFixture)
  })

  test("nullable fields default cleanly", async () => {
    if (!reachable) return  // graceful skip — no DB tunnel
    const id = await persistPhaseEvalRun({
      probeName: SMOKE_PROBE_NAME,
      gitCommit: "abc123",
      seedsUsed: ["seed-a"],
      variantLabels: ["v1"],
      summaryJson: { minimal: true },
      verdict: "SCREEN-FAIL (broken)",
    })

    const rows = await db`
      SELECT experiment_id, notes FROM phase_eval_runs WHERE id = ${id}
    `
    const r = rows[0] as any
    expect(r.experiment_id).toBeNull()
    expect(r.notes).toBeNull()
  })
})
