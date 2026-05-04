/**
 * Phase 4 commit 3 — Planning Snapshot Routes tests.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4"
 *
 * HTTP-level tests via direct handler invocation. DB-backed (skipIf-
 * unreachable) — the routes touch world_bibles / characters /
 * story_spines / chapter_outlines for the hash compute, plus the new
 * planning_snapshots table for record/lock.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import { handlePlanningSnapshotRoute } from "./planning-snapshot-routes"
import { computePlanningSnapshotHash } from "../canon/planning-snapshot"
import {
  findPlanningSnapshot,
  deletePlanningSnapshotsForNovel,
} from "../db/planning-snapshots"
import type { CharacterProfile, WorldBible, StorySpine } from "../types"

const reachable = await dbReachable()

async function seedNovel(novelId: string): Promise<void> {
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
  await deletePlanningSnapshotsForNovel(novelId)
  await db`DELETE FROM characters WHERE novel_id = ${novelId}`
  await db`DELETE FROM world_bibles WHERE novel_id = ${novelId}`
  await db`DELETE FROM story_spines WHERE novel_id = ${novelId}`
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

function makeCharacter(id: string, name: string): CharacterProfile {
  return {
    id, name, role: "protagonist", backstory: "", traits: [],
    speechPattern: "", goals: "G", fears: "F",
    relationships: [], culturalBackground: [], systemAwareness: [], exampleLines: [],
  } as CharacterProfile
}

function makeWorld(setting = "Tower"): WorldBible {
  return { setting } as WorldBible
}

function makeSpine(centralConflict = "X vs Y"): StorySpine {
  return { centralConflict } as StorySpine
}

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const req = new Request(url, init)
  return handlePlanningSnapshotRoute(req, url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handlePlanningSnapshotRoute — non-matching paths", () => {
  test("POST on /current returns null (GET only)", async () => {
    const res = await invoke("POST", "/api/novel/x/planning-snapshot/current")
    expect(res).toBeNull()
  })

  test("GET on /lock returns null (POST only)", async () => {
    const res = await invoke("GET", "/api/novel/x/planning-snapshot/lock")
    expect(res).toBeNull()
  })

  test("unknown path returns null", async () => {
    const res = await invoke("GET", "/api/novel/x/something-else")
    expect(res).toBeNull()
  })
})

describe.skipIf(!reachable)("handlePlanningSnapshotRoute (DB-backed)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-snap-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
    await seedWorld(novelId, makeWorld())
    await seedCharacter(novelId, makeCharacter("c1", "Aria"))
    await seedSpine(novelId, makeSpine())
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  // ── GET /current ──────────────────────────────────────────────────────

  test("GET /current returns the live computed hash + null lock + drift=false", async () => {
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-snapshot/current`),
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.novelId).toBe(novelId)
    expect(body.computedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.version).toBe("v2")
    expect(body.lockedSnapshot).toBeNull()
    expect(body.drift).toBe(false)
  })

  test("GET /current after lock: lockedSnapshot is the row, drift=false on identical state", async () => {
    const hash = await computePlanningSnapshotHash(novelId, "v2")
    await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash,
        lockedBy: { kind: "human", note: "ready to draft" },
      }),
    )
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-snapshot/current`),
    )
    expect(status).toBe(200)
    expect(body.lockedSnapshot).not.toBeNull()
    expect(body.lockedSnapshot.id).toBe(hash)
    expect(body.lockedSnapshot.locked_by_kind).toBe("human")
    expect(body.drift).toBe(false)
  })

  test("GET /current after lock: drift=true after the planning state changes", async () => {
    const beforeHash = await computePlanningSnapshotHash(novelId, "v2")
    await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: beforeHash,
        lockedBy: { kind: "human" },
      }),
    )
    // Mutate planning state — bumps the hash.
    await seedCharacter(novelId, makeCharacter("c2", "Mord"))
    const { body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/planning-snapshot/current`),
    )
    expect(body.drift).toBe(true)
    expect(body.computedHash).not.toBe(body.lockedSnapshot.id)
    expect(body.lockedSnapshot.id).toBe(beforeHash)
  })

  // ── POST /lock ────────────────────────────────────────────────────────

  test("POST /lock with the live hash → 200 + locked row, ds row exists in DB", async () => {
    const hash = await computePlanningSnapshotHash(novelId, "v2")
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash,
        lockedBy: { kind: "human", ref: "operator-1", note: "looks ready" },
      }),
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.snapshot.id).toBe(hash)
    expect(body.snapshot.locked_by_kind).toBe("human")
    expect(body.snapshot.locked_by_ref).toBe("operator-1")
    expect(body.snapshot.locked_note).toBe("looks ready")

    // DB-side: the row is there and locked.
    const row = await findPlanningSnapshot(hash)
    expect(row!.locked_at).not.toBeNull()
  }, 30000)

  test("POST /lock with a hash that doesn't match live → 409 + expectedHash/providedHash", async () => {
    // The route now recomputes the live hash and rejects mismatches.
    // Without this guard, an arbitrary 64-hex string would record +
    // lock, poisoning drift detection against a hash that was never
    // a real planning state.
    const fakeHash = "f".repeat(64)
    expect(await findPlanningSnapshot(fakeHash)).toBeNull()
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: fakeHash,
        lockedBy: { kind: "test" },
      }),
    )
    expect(status).toBe(409)
    expect(body.error).toBe("lock hash does not match live planning snapshot")
    expect(body.providedHash).toBe(fakeHash)
    expect(body.expectedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.expectedHash).not.toBe(fakeHash)
    // No row was recorded — the route bailed before persistence.
    expect(await findPlanningSnapshot(fakeHash)).toBeNull()
  })

  test("POST /lock idempotently records: live hash gets recorded then locked on first call", async () => {
    const liveHash = await computePlanningSnapshotHash(novelId, "v2")
    expect(await findPlanningSnapshot(liveHash)).toBeNull()
    const { status } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: liveHash,
        lockedBy: { kind: "test" },
      }),
    )
    expect(status).toBe(200)
    expect(await findPlanningSnapshot(liveHash)).not.toBeNull()
  })

  test("POST /lock on already-locked → 409 + actualLock metadata", async () => {
    const hash = await computePlanningSnapshotHash(novelId, "v2")
    await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash,
        lockedBy: { kind: "human", note: "first lock" },
      }),
    )
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash,
        lockedBy: { kind: "policy", note: "trying again" },
      }),
    )
    expect(status).toBe(409)
    expect(body.error).toBe("snapshot already locked")
    expect(body.actualLock.lockedByKind).toBe("human")
    expect(body.actualLock.lockedNote).toBe("first lock")
  })

  test("POST /lock with malformed hash → 400", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: "not-a-hash",
        lockedBy: { kind: "human" },
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid request body")
  })

  test("POST /lock with missing lockedBy → 400", async () => {
    const { status } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: "0".repeat(64),
      }),
    )
    expect(status).toBe(400)
  })

  test("POST /lock with bogus kind → 400", async () => {
    const { status } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/planning-snapshot/lock`, {
        hash: "0".repeat(64),
        lockedBy: { kind: "ghost" },
      }),
    )
    expect(status).toBe(400)
  })

  test("POST /lock with malformed JSON body → 400", async () => {
    const url = new URL(`http://localhost/api/novel/${novelId}/planning-snapshot/lock`)
    const req = new Request(url, {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    })
    const res = await handlePlanningSnapshotRoute(req, url)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/malformed json/)
  })
})
