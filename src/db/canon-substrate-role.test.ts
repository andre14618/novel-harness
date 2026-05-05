/**
 * DB round-trip for `canon_facts.role` (sql/050_canon_fact_roles.sql).
 *
 * Verifies:
 *   - `insertFact` persists `fact.role` and `loadFactsSnapshot` →
 *     `factFromRow` returns the same value.
 *   - Default `operational` is applied at the DB layer when a fact arrives
 *     without role through the legacy code path (e.g. raw SQL insert).
 *   - Symmetric to `src/db/facts.test.ts` for the legacy `facts` table.
 *
 * Skipped when Postgres is unreachable (matches sibling test pattern).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import { insertFact, loadFactsSnapshot, factFromRow, deleteAllForNovel, bumpGeneration } from "./canon-substrate"
import type { CanonFact, FactRole } from "../canon/api"

const reachable = await dbReachable()

const TEST_NOVEL = `test-canon-fact-role-${Date.now()}`

async function seedNovel(): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${TEST_NOVEL}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function clean(): Promise<void> {
  await deleteAllForNovel(TEST_NOVEL)
  await db`DELETE FROM novels WHERE id = ${TEST_NOVEL}`
}

function makeFact(id: string, role: FactRole): CanonFact {
  return {
    id,
    kind: "established_fact",
    text: `fact ${id} (${role})`,
    provenance: {
      source: "post-draft-extraction",
      chapter: 1,
      extractorVersion: "test-v1",
      approvalStatus: "human-approved",
      origin: "observed",
      createdAt: "2026-05-05T00:00:00Z",
      updatedAt: "2026-05-05T00:00:00Z",
    },
    role,
  }
}

describe.skipIf(!reachable)("canon_facts.role round-trip", () => {
  beforeEach(async () => {
    await clean()
    await seedNovel()
    await bumpGeneration(TEST_NOVEL)
  })
  afterEach(clean)

  test("insertFact persists role and loadFactsSnapshot returns it via factFromRow", async () => {
    await insertFact({ novelId: TEST_NOVEL, fact: makeFact("fact-op", "operational"), version: 1 })
    await insertFact({ novelId: TEST_NOVEL, fact: makeFact("fact-ref", "reference"), version: 1 })
    await insertFact({ novelId: TEST_NOVEL, fact: makeFact("fact-hidden", "hidden"), version: 1 })

    const rows = await loadFactsSnapshot(TEST_NOVEL, 5)
    expect(rows.length).toBe(3)
    const byId = new Map(rows.map((row) => [row.logical_id, factFromRow(row)]))
    expect(byId.get("fact-op")?.role).toBe("operational")
    expect(byId.get("fact-ref")?.role).toBe("reference")
    expect(byId.get("fact-hidden")?.role).toBe("hidden")
  })

  test("DB defaults role to 'operational' for legacy raw inserts that omit the column", async () => {
    await db`
      INSERT INTO canon_facts (
        novel_id, logical_id, version, kind, text,
        source, committed_at_chapter, extractor_version,
        approval_status, origin, created_at, updated_at
      ) VALUES (
        ${TEST_NOVEL}, 'fact-legacy', 1, 'established_fact', 'legacy fact',
        'post-draft-extraction', 1, 'legacy-test',
        'human-approved', 'observed', NOW(), NOW()
      )
    `

    const rows = await loadFactsSnapshot(TEST_NOVEL, 5)
    expect(rows).toHaveLength(1)
    expect(factFromRow(rows[0]!).role).toBe("operational")
  })

  test("factFromRow defends against unrecognized DB role values", async () => {
    const synthetic = {
      novel_id: TEST_NOVEL,
      logical_id: "fact-synth",
      version: 1,
      kind: "established_fact",
      text: "synthetic",
      data: null,
      source: "post-draft-extraction",
      committed_at_chapter: 1,
      committed_at_beat: null,
      extractor_version: "test",
      confidence: null,
      approval_status: "human-approved",
      origin: "observed",
      supersedes_logical_id: null,
      superseded_by_version: null,
      superseded_at_chapter: null,
      created_at: "2026-05-05T00:00:00Z",
      updated_at: "2026-05-05T00:00:00Z",
      role: "garbage-value-from-future-migration",
    }
    expect(factFromRow(synthetic).role).toBe("operational")
  })
})
