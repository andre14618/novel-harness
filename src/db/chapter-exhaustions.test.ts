/**
 * Restart-recovery test for chapter_exhaustions.
 *
 * Verifies `cleanOrphanedExhaustionsForNovel` marks all pending rows for a
 * novel as orphaned in one shot, leaves resolved rows alone, and is safe to
 * call on a novel with no pending rows.
 *
 * Skipped if DATABASE_URL is unset.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import {
  cleanOrphanedExhaustionsForNovel,
  logExhaustionFired,
  listExhaustionsForNovel,
  markExhaustionOrphaned,
} from "./chapter-exhaustions"

const reachable = !!(process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL)

const TEST_NOVEL = `test-restart-recovery-${Date.now()}`

async function clean() {
  await db`DELETE FROM chapter_exhaustions WHERE novel_id = ${TEST_NOVEL}`
}

describe.skipIf(!reachable)("cleanOrphanedExhaustionsForNovel", () => {
  beforeEach(clean)
  afterEach(clean)

  test("marks all pending rows for the novel as orphaned in one call", async () => {
    await logExhaustionFired({
      novelId: TEST_NOVEL, chapter: 1, attempt: 1, kind: "plan-check-exhausted",
      resolverMode: "web", unresolvedDeviations: [{ description: "deviation a", beat_index: null }],
    })
    await logExhaustionFired({
      novelId: TEST_NOVEL, chapter: 2, attempt: 3, kind: "reviser-rejected",
      resolverMode: "web", unresolvedDeviations: [{ description: "deviation b", beat_index: 5 }],
    })

    const cleaned = await cleanOrphanedExhaustionsForNovel(TEST_NOVEL, "test cleanup reason")
    expect(cleaned).toBe(2)

    const rows = await listExhaustionsForNovel(TEST_NOVEL)
    expect(rows.length).toBe(2)
    for (const r of rows) {
      expect(r.decidedAt).not.toBeNull()
      expect(r.decision).toBe("orphaned")
      // decisionDetails is returned as a jsonb string by bun-pg; parse before
      // shape-checking. (Other consumers JSON.parse on read; the helper does
      // not normalize.)
      const parsed = typeof r.decisionDetails === "string" ? JSON.parse(r.decisionDetails) : r.decisionDetails
      expect(parsed).toMatchObject({ reason: "test cleanup reason" })
    }
  })

  test("leaves already-decided rows alone", async () => {
    const id = await logExhaustionFired({
      novelId: TEST_NOVEL, chapter: 1, attempt: 1, kind: "plan-check-exhausted",
      resolverMode: "web", unresolvedDeviations: [],
    })
    await markExhaustionOrphaned(id, "manual decision")

    const cleaned = await cleanOrphanedExhaustionsForNovel(TEST_NOVEL, "should not touch")
    expect(cleaned).toBe(0)

    const rows = await listExhaustionsForNovel(TEST_NOVEL)
    expect(rows.length).toBe(1)
    const parsed = typeof rows[0]!.decisionDetails === "string"
      ? JSON.parse(rows[0]!.decisionDetails as string)
      : rows[0]!.decisionDetails
    expect(parsed).toMatchObject({ reason: "manual decision" })
  })

  test("returns 0 when there are no pending rows for the novel", async () => {
    const cleaned = await cleanOrphanedExhaustionsForNovel(TEST_NOVEL, "noop")
    expect(cleaned).toBe(0)
  })

  test("does not affect other novels' rows", async () => {
    const otherNovel = `${TEST_NOVEL}-other`
    try {
      await logExhaustionFired({
        novelId: otherNovel, chapter: 1, attempt: 1, kind: "plan-check-exhausted",
        resolverMode: "web", unresolvedDeviations: [],
      })
      await logExhaustionFired({
        novelId: TEST_NOVEL, chapter: 1, attempt: 1, kind: "plan-check-exhausted",
        resolverMode: "web", unresolvedDeviations: [],
      })

      const cleaned = await cleanOrphanedExhaustionsForNovel(TEST_NOVEL, "scoped to test novel")
      expect(cleaned).toBe(1)

      const otherRows = await listExhaustionsForNovel(otherNovel)
      expect(otherRows.length).toBe(1)
      expect(otherRows[0]!.decidedAt).toBeNull()
    } finally {
      await db`DELETE FROM chapter_exhaustions WHERE novel_id = ${otherNovel}`
    }
  })
})
