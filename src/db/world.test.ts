/**
 * Codex round-4 MEDIUM 2 — characterRename atomicity.
 *
 * The rename path on `updateCharacterFields` is multi-statement:
 *   1. UPDATE characters SET name = ..., profile_json = ...
 *   2. UPDATE relationship_states SET character_a = ... (referenced by name)
 *   3. UPDATE relationship_states SET character_b = ...
 *
 * Pre-fix the three statements ran on the bare `db` connection. A failure
 * on (2) or (3) — e.g. a transient pool error, or the in-flight outer
 * transaction throwing — left `characters.name` and `relationship_states`
 * inconsistent. Codex round-4 MEDIUM 2.
 *
 * Post-fix the function wraps its internal work in `db.begin(...)` (or
 * threads an outer caller's executor through). These tests pin two
 * complementary properties:
 *   1. The rename happy path now updates relationship_states atomically
 *      with the character row.
 *   2. When called inside an outer transaction that rolls back, all of
 *      the rename's effects roll back together — the executor parameter
 *      is honored.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import { updateCharacterFields } from "./world"
import type { CharacterProfile } from "../types"

const reachable = await dbReachable()

async function seedNovel(novelId: string): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function seedCharacter(novelId: string, profile: CharacterProfile): Promise<void> {
  await db`INSERT INTO characters (id, novel_id, name, profile_json)
           VALUES (${profile.id}, ${novelId}, ${profile.name}, ${profile})
           ON CONFLICT (novel_id, id) DO UPDATE
             SET name = EXCLUDED.name, profile_json = EXCLUDED.profile_json`
}

async function seedRelationship(
  novelId: string,
  charA: string,
  charB: string,
  chapter = 1,
): Promise<void> {
  await db`INSERT INTO relationship_states (novel_id, character_a, character_b, chapter_number, dynamic)
           VALUES (${novelId}, ${charA}, ${charB}, ${chapter}, 'unspecified')
           ON CONFLICT DO NOTHING`
}

async function dropNovel(novelId: string): Promise<void> {
  await db`DELETE FROM relationship_states WHERE novel_id = ${novelId}`
  await db`DELETE FROM characters WHERE novel_id = ${novelId}`
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

function makeCharacter(id: string, name: string): CharacterProfile {
  return {
    id,
    name,
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "",
    fears: "",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  } as CharacterProfile
}

describe.skipIf(!reachable)("updateCharacterFields rename atomicity (round-4 MEDIUM 2)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("happy path: rename updates character row + both relationship_states sides", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    await seedCharacter(novelId, makeCharacter("char-foe", "Mord"))
    // Aria appears as both character_a and character_b in different rows.
    await seedRelationship(novelId, "Aria", "Mord", 1)
    await seedRelationship(novelId, "Mord", "Aria", 1)

    await updateCharacterFields(novelId, "char-hero", { name: "Aria the Brave" })

    const charRow = (await db`SELECT name, profile_json FROM characters
                              WHERE novel_id = ${novelId} AND id = 'char-hero'`) as {
      name: string
      profile_json: CharacterProfile
    }[]
    expect(charRow[0].name).toBe("Aria the Brave")
    expect(charRow[0].profile_json.name).toBe("Aria the Brave")

    const relsAsA = (await db`SELECT character_a FROM relationship_states
                              WHERE novel_id = ${novelId} AND character_b = 'Mord'`) as {
      character_a: string
    }[]
    const relsAsB = (await db`SELECT character_b FROM relationship_states
                              WHERE novel_id = ${novelId} AND character_a = 'Mord'`) as {
      character_b: string
    }[]
    expect(relsAsA.map((r) => r.character_a)).toEqual(["Aria the Brave"])
    expect(relsAsB.map((r) => r.character_b)).toEqual(["Aria the Brave"])
  })

  test("non-rename path: bare patch does not touch relationship_states", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    await seedRelationship(novelId, "Aria", "Mord", 1)

    await updateCharacterFields(novelId, "char-hero", { goals: "Find the second key" })

    // Still indexed under "Aria" — non-rename patches must not perturb the
    // relationship rows.
    const rels = (await db`SELECT character_a, character_b FROM relationship_states
                           WHERE novel_id = ${novelId}`) as {
      character_a: string
      character_b: string
    }[]
    expect(rels).toHaveLength(1)
    expect(rels[0].character_a).toBe("Aria")
  })

  test("outer-tx rollback: rename-in-flight rolls back ALL writes (executor honored)", async () => {
    // Pins the executor-threading contract that Codex round-4 HIGH builds
    // on. When called inside an outer `db.begin(...)` that throws, the
    // character row update AND the relationship_states rewrites must roll
    // back together. Without the executor parameter (or with separate
    // db.begin calls per statement), some writes would commit before the
    // outer rollback.
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    await seedRelationship(novelId, "Aria", "Mord", 1)

    let caught: unknown
    try {
      await db.begin(async (tx: typeof db) => {
        await updateCharacterFields(novelId, "char-hero", { name: "Aria the Brave" }, tx)
        // Simulate an outer-flow failure AFTER the rename's writes — e.g.
        // a precondition recheck that surfaced a race, or a downstream
        // error in a multi-step apply.
        throw new Error("simulated outer rollback")
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()

    const charRow = (await db`SELECT name, profile_json FROM characters
                              WHERE novel_id = ${novelId} AND id = 'char-hero'`) as {
      name: string
      profile_json: CharacterProfile
    }[]
    expect(charRow[0].name).toBe("Aria")
    expect(charRow[0].profile_json.name).toBe("Aria")

    const rels = (await db`SELECT character_a FROM relationship_states
                           WHERE novel_id = ${novelId}`) as { character_a: string }[]
    expect(rels[0].character_a).toBe("Aria")
  })
})
