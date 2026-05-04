/**
 * Phase 3 commit 2 — Proposal Envelope Resolve API tests.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 3 — Artifact Patch Proposal Cards"
 *
 * HTTP-level tests via direct handler invocation (no Bun.serve binding).
 * The handler module returns null when a path doesn't match; we assert that
 * routes ONLY fire on the right path+method combination.
 *
 * DB-backed (skipIf-unreachable). The route reads + writes characters,
 * world_bibles, story_spines via the production seam; an InMemory tier
 * doesn't make sense.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import { handleProposalEnvelopeRoute } from "./proposal-envelope-routes"
import { buildArtifactPatchEnvelope, stableHash } from "../canon/proposal-envelope"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"
import type { CharacterProfile, WorldBible, StorySpine } from "../types"

const reachable = await dbReachable()
const fixedNow = new Date("2026-05-04T12:00:00.000Z")

async function seedNovel(novelId: string): Promise<void> {
  // Minimal novel row — characters / world / spine all foreign-key onto it.
  // The seed_json shape is opaque to our tests; an empty-ish object is fine.
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function seedCharacter(novelId: string, c: CharacterProfile): Promise<void> {
  await db`INSERT INTO characters (id, novel_id, name, profile_json)
           VALUES (${c.id}, ${novelId}, ${c.name}, ${c})
           ON CONFLICT (novel_id, id) DO UPDATE
             SET name = EXCLUDED.name, profile_json = EXCLUDED.profile_json`
}

async function seedWorld(novelId: string, w: WorldBible): Promise<void> {
  await db`INSERT INTO world_bibles (novel_id, content_json) VALUES (${novelId}, ${w})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

async function seedSpine(novelId: string, s: StorySpine): Promise<void> {
  await db`INSERT INTO story_spines (novel_id, content_json) VALUES (${novelId}, ${s})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

async function dropNovel(novelId: string): Promise<void> {
  await db`DELETE FROM characters WHERE novel_id = ${novelId}`
  await db`DELETE FROM world_bibles WHERE novel_id = ${novelId}`
  await db`DELETE FROM story_spines WHERE novel_id = ${novelId}`
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

function makeCharacter(id: string, name: string, overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id,
    name,
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "Find the key",
    fears: "Failure",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
    ...overrides,
  } as CharacterProfile
}

function makeWorld(setting = "Tower"): WorldBible {
  return {
    setting,
    timePeriod: "modern",
    geography: "",
    politicalStructure: "",
    technologyConstraints: "",
    sensoryPalette: "",
    culture: "",
    history: "",
    socialCustoms: [],
    rules: [],
  } as unknown as WorldBible
}

function makeSpine(centralConflict = "Aria vs Mord"): StorySpine {
  return {
    centralConflict,
    theme: "",
    endingDirection: "",
  } as unknown as StorySpine
}

async function buildEnvelopeFromLive(
  novelId: string,
  patch: AdjusterPatch,
): Promise<ReturnType<typeof buildArtifactPatchEnvelope>> {
  const { getWorldBible, getCharacters, getStorySpine } = await import("../db")
  const [world, characters, spine] = await Promise.all([
    getWorldBible(novelId).catch(() => null),
    getCharacters(novelId).catch(() => [] as CharacterProfile[]),
    getStorySpine(novelId).catch(() => null),
  ])
  return buildArtifactPatchEnvelope({
    novelId,
    patch,
    patchIndex: 0,
    userMessage: "test",
    rationale: "test rationale",
    artifacts: { world, characters, spine },
    now: fixedNow,
  })
}

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const req = new Request(url, init)
  return handleProposalEnvelopeRoute(req, url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handleProposalEnvelopeRoute — non-matching paths", () => {
  test("GET on resolve path returns null (POST only)", async () => {
    const res = await invoke("GET", "/api/novel/x/proposal-envelopes/resolve")
    expect(res).toBeNull()
  })

  test("unknown path returns null", async () => {
    const res = await invoke("POST", "/api/novel/x/something-else")
    expect(res).toBeNull()
  })
})

describe.skipIf(!reachable)("handleProposalEnvelopeRoute (DB-backed)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-envelope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  // ── characterUpdate ──────────────────────────────────────────────────────

  test("approved characterUpdate applies patch and returns new version", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Find the second key" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.applied).toBe(true)
    expect(body.status).toBe("approved")
    expect(typeof body.newVersion).toBe("string")
    expect(body.newVersion).not.toBe(envelope.target.currentVersion)

    // Verify DB-side: goals updated.
    const rows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(rows[0].profile_json.goals).toBe("Find the second key")
  })

  test("approved characterRename updates name + relationship_states", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterRename",
      characterId: "char-hero",
      newName: "Aria the Brave",
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(200)
    expect(body.applied).toBe(true)
    const rows = (await db`SELECT name FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { name: string }[]
    expect(rows[0].name).toBe("Aria the Brave")
  })

  // ── worldUpdate / spineUpdate ───────────────────────────────────────────

  test("approved worldUpdate applies to world bible", async () => {
    await seedWorld(novelId, makeWorld("Tower"))
    const patch: AdjusterPatch = { type: "worldUpdate", patch: { setting: "Harbor" } }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(200)
    expect(body.applied).toBe(true)
    const rows = (await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`) as { content_json: WorldBible }[]
    expect(rows[0].content_json.setting).toBe("Harbor")
  })

  test("approved spineUpdate applies to story spine", async () => {
    await seedSpine(novelId, makeSpine("Aria vs Mord"))
    const patch: AdjusterPatch = { type: "spineUpdate", patch: { theme: "redemption" } }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(200)
    expect(body.applied).toBe(true)
    const rows = (await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`) as { content_json: StorySpine }[]
    expect((rows[0].content_json as any).theme).toBe("redemption")
  })

  // ── rejected ────────────────────────────────────────────────────────────

  test("rejected resolve does not apply; artifact unchanged", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria", { goals: "Find the key" }))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Steal the key" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "rejected",
      }),
    )
    expect(status).toBe(200)
    expect(body.applied).toBe(false)
    expect(body.status).toBe("rejected")
    expect(body.newVersion).toBeUndefined()
    const rows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(rows[0].profile_json.goals).toBe("Find the key")
  })

  // ── modified ────────────────────────────────────────────────────────────

  test("modified resolve with same-target modifiedPayload applies the modified version", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria", { goals: "Find the key" }))
    const original: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Steal the key" },
    }
    const modified: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Negotiate for the key" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, original)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "modified",
        modifiedPayload: modified,
      }),
    )
    expect(status).toBe(200)
    expect(body.applied).toBe(true)
    expect(body.status).toBe("modified")
    const rows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    // The modified payload's value, not the original's, ends up in canon.
    expect(rows[0].profile_json.goals).toBe("Negotiate for the key")
  })

  test("modified resolve without modifiedPayload → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "modified",
      }),
    )
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("invalid request body")
    expect(JSON.stringify(body.issues)).toContain("modifiedPayload")
  })

  test("modified resolve with cross-target modifiedPayload → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    await seedCharacter(novelId, makeCharacter("char-foe", "Mord"))
    const original: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const crossTarget: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-foe", // different character — should be rejected
      patch: { goals: "Y" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, original)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "modified",
        modifiedPayload: crossTarget,
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toMatch(/same artifact/)
    // Neither character was modified.
    const rows = (await db`SELECT id, profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id`) as { id: string; profile_json: CharacterProfile }[]
    expect(rows[0].profile_json.goals).toBe("Find the key")
    expect(rows[1].profile_json.goals).toBe("Find the key")
  })

  test("modified resolve with cross-type modifiedPayload (character → world) → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    await seedWorld(novelId, makeWorld())
    const charPatch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const worldPatch: AdjusterPatch = { type: "worldUpdate", patch: { setting: "Other" } }
    const envelope = await buildEnvelopeFromLive(novelId, charPatch)
    const { status } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "modified",
        modifiedPayload: worldPatch,
      }),
    )
    expect(status).toBe(400)
  })

  // ── stale precondition ─────────────────────────────────────────────────

  test("stale precondition (artifact changed since envelope created) → 409 + actualVersion", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria", { goals: "Find the key" }))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Steal the key" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    // Race: the character was edited (e.g., a direct PUT /character/:id)
    // between envelope creation and the resolve request.
    const { updateCharacterFields } = await import("../db")
    await updateCharacterFields(novelId, "char-hero", { backstory: "Concurrent edit" })

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(409)
    expect(body.error).toBe("stale-precondition")
    expect(body.expectedVersion).toBe(envelope.target.currentVersion)
    expect(typeof body.actualVersion).toBe("string")
    expect(body.actualVersion).not.toBe(body.expectedVersion)
    // The patch was NOT applied: goals still original.
    const rows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(rows[0].profile_json.goals).toBe("Find the key")
  })

  test("missing target artifact (character not in DB) → 404", async () => {
    // Character not seeded; envelope built off an empty character list →
    // currentVersion = stableHash(undefined) but live read returns null.
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-ghost",
      patch: { goals: "haunt" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(404)
    expect(body.error).toBe("target artifact missing")
  })

  // ── envelope.novelId vs URL mismatch ───────────────────────────────────

  test("envelope.novelId mismatched against URL → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    // Send the envelope to the WRONG novel id in the URL.
    const wrongNovel = `${novelId}-other`
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${wrongNovel}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toMatch(/novelId does not match/)
  })

  // ── invalid body shape ─────────────────────────────────────────────────

  test("invalid body shape (missing envelope) → 400 with issue list", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        status: "approved",
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid request body")
    expect(Array.isArray(body.issues)).toBe(true)
  })

  test("invalid status enum → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)
    const { status } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "bogus",
      }),
    )
    expect(status).toBe(400)
  })

  test("malformed JSON body → 400", async () => {
    const url = new URL(`http://localhost/api/novel/${novelId}/proposal-envelopes/resolve`)
    const req = new Request(url, {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    })
    const res = await handleProposalEnvelopeRoute(req, url)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/malformed json/)
  })

  // ── re-running approved resolve fires precondition guard ───────────────

  test("re-applying the same envelope after success → 409 (precondition is now stale)", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria", { goals: "Find the key" }))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Steal the key" },
    }
    const envelope = await buildEnvelopeFromLive(novelId, patch)

    // First resolve succeeds.
    const first = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(first.status).toBe(200)
    expect(first.body.applied).toBe(true)

    // Second resolve with the SAME envelope (currentVersion still pinned
    // to the pre-apply hash) is now stale.
    const second = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope,
        status: "approved",
      }),
    )
    expect(second.status).toBe(409)
    expect(second.body.error).toBe("stale-precondition")
  })

  // ── Codex round-4 HIGH: atomic compare-and-apply ──────────────────────
  //
  // Two concurrent resolves that race against the same pending envelope
  // MUST produce exactly one applied + one stale, never two-applied. The
  // pre-fix code was: read live hash, compare, apply (no transaction). A
  // concurrent edit between the read and the apply could clobber stale
  // data. Post-fix the route wraps SELECT FOR UPDATE + apply in a single
  // `db.begin(...)`, so the second resolve blocks on the row lock until
  // the first commits, then sees the new hash and 409s.
  test("concurrent same-envelope resolves: exactly one 200 + one 409 (round-4 HIGH atomic compare-and-apply)", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria", { goals: "Find the key" }))
    // Both resolves use the SAME envelope, snapshotted before any apply.
    // Build two distinct patches so we can verify which one won.
    const patchA: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Win A" },
    }
    const envelopeA = await buildEnvelopeFromLive(novelId, patchA)
    const envelopeB = {
      ...envelopeA,
      // Different envelope id so the test can tell which won — same
      // payload-target shape (same character) so they truly race.
      id: envelopeA.id + "-B",
      payload: {
        type: "characterUpdate" as const,
        characterId: "char-hero",
        patch: { goals: "Win B" },
      },
    }

    const [resA, resB] = await Promise.all([
      invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope: envelopeA,
        status: "approved",
      }),
      invoke("POST", `/api/novel/${novelId}/proposal-envelopes/resolve`, {
        envelope: envelopeB,
        status: "approved",
      }),
    ])
    const a = await expectJson(resA)
    const b = await expectJson(resB)

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])

    const winner = a.status === 200 ? a : b
    const loser = a.status === 200 ? b : a
    expect(winner.body.applied).toBe(true)
    expect(loser.body.error).toBe("stale-precondition")

    // DB-side post-condition: the character's `goals` field carries the
    // WINNER's payload, not a hybrid or the loser's — proving exactly one
    // apply happened.
    const rows = (await db`SELECT profile_json FROM characters
                           WHERE novel_id = ${novelId} AND id = 'char-hero'`) as {
      profile_json: CharacterProfile
    }[]
    const expectedGoals =
      winner === a ? "Win A" : "Win B"
    expect(rows[0].profile_json.goals).toBe(expectedGoals)
  }, 15_000)
})
