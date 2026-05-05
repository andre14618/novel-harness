/**
 * DB round-trip for `facts.role` (sql/049_world_fact_roles.sql).
 *
 * Verifies:
 *   - `saveFact` without an explicit role persists `operational` (DB default).
 *   - `saveFact` with an explicit role round-trips that role unchanged.
 *   - `getFactsUpToChapter` and `getFactsForChapter` always return a defined
 *     `role` string from the union.
 *
 * Skipped when Postgres is unreachable, matching the pattern in
 * `src/db/chapter-exhaustions.test.ts`.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { saveFact, getFactsUpToChapter, getFactsForChapter, clearFactsForChapter } from "./facts"
import { dbReachable } from "./test-helpers"

const reachable = await dbReachable()

const TEST_NOVEL = `test-fact-role-${Date.now()}`

async function seedNovel(): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${TEST_NOVEL}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function clean(): Promise<void> {
  await db`DELETE FROM facts WHERE novel_id = ${TEST_NOVEL}`
  await db`DELETE FROM novels WHERE id = ${TEST_NOVEL}`
}

describe.skipIf(!reachable)("facts.role round-trip", () => {
  beforeEach(async () => {
    await clean()
    await seedNovel()
  })
  afterEach(clean)

  test("saveFact without role defaults to 'operational'", async () => {
    const id = await saveFact(TEST_NOVEL, {
      fact: "The Compiler writes only in marginalia.",
      category: "rule",
      establishedInChapter: 1,
    })
    expect(typeof id).toBe("string")

    const facts = await getFactsForChapter(TEST_NOVEL, 1)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.role).toBe("operational")
    expect(facts[0]!.fact).toBe("The Compiler writes only in marginalia.")
  })

  test("saveFact preserves explicit role values", async () => {
    await saveFact(TEST_NOVEL, {
      fact: "Sable was Rowan's spectral familiar.",
      category: "character",
      establishedInChapter: 1,
      role: "operational",
    })
    await saveFact(TEST_NOVEL, {
      fact: "The library has 17,000 catalogued volumes.",
      category: "physical",
      establishedInChapter: 1,
      role: "reference",
    })
    await saveFact(TEST_NOVEL, {
      fact: "The Compiler will die before the seventh chime.",
      category: "rule",
      establishedInChapter: 2,
      role: "hidden",
    })

    const facts = await getFactsUpToChapter(TEST_NOVEL, 2)
    const byFact = new Map(facts.map((f) => [f.fact, f.role]))
    expect(byFact.get("Sable was Rowan's spectral familiar.")).toBe("operational")
    expect(byFact.get("The library has 17,000 catalogued volumes.")).toBe("reference")
    expect(byFact.get("The Compiler will die before the seventh chime.")).toBe("hidden")
  })

  test("clearFactsForChapter does not affect facts in other chapters", async () => {
    await saveFact(TEST_NOVEL, {
      fact: "ch1 fact",
      category: "rule",
      establishedInChapter: 1,
      role: "reference",
    })
    await saveFact(TEST_NOVEL, {
      fact: "ch2 fact",
      category: "rule",
      establishedInChapter: 2,
      role: "operational",
    })

    await clearFactsForChapter(TEST_NOVEL, 2)
    const remaining = await getFactsUpToChapter(TEST_NOVEL, 5)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.fact).toBe("ch1 fact")
    expect(remaining[0]!.role).toBe("reference")
  })
})
