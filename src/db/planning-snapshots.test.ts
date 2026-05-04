/**
 * Phase 4 commit 2 — planning_snapshots persistence tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 4"
 *
 * Skipped when Postgres isn't reachable (CI without DB). Covers the
 * record / find / list / lock / getLocked shape; pins the idempotent-
 * insert and the lock-once invariants that drafting drift detection
 * (Phase 4 commit 5) will lean on.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import {
  recordPlanningSnapshot,
  findPlanningSnapshot,
  listPlanningSnapshots,
  getLockedPlanningSnapshot,
  lockPlanningSnapshot,
  deletePlanningSnapshotsForNovel,
} from "./planning-snapshots"

const reachable = await dbReachable()

async function seedNovel(novelId: string): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function dropNovel(novelId: string): Promise<void> {
  await deletePlanningSnapshotsForNovel(novelId)
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

// 64-hex-character placeholder — real hashes from
// computePlanningSnapshotHash will fit this format.
function fakeHash(seed: string): string {
  // Deterministic 64-char filler. Tests don't need cryptographic strength
  // here — they just need stable distinct ids.
  return seed.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a")
}

describe.skipIf(!reachable)("planning-snapshots persistence", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("record + find: a single snapshot round-trips through Postgres", async () => {
    const hash = fakeHash("abc1")
    const inserted = await recordPlanningSnapshot({ hash, novelId, version: "v1" })
    expect(inserted).toBe(true)

    const row = await findPlanningSnapshot(hash)
    expect(row).not.toBeNull()
    expect(row!.id).toBe(hash)
    expect(row!.novel_id).toBe(novelId)
    expect(row!.version).toBe("v1")
    expect(row!.created_at).not.toBeNull()
    expect(row!.locked_at).toBeNull()
    expect(row!.locked_by_kind).toBeNull()
  })

  test("record is idempotent: rerunning with the same hash returns false", async () => {
    const hash = fakeHash("abc2")
    expect(await recordPlanningSnapshot({ hash, novelId, version: "v1" })).toBe(true)
    expect(await recordPlanningSnapshot({ hash, novelId, version: "v1" })).toBe(false)
    const rows = (await db`SELECT COUNT(*)::int AS c FROM planning_snapshots
                           WHERE id = ${hash}`) as { c: number }[]
    expect(rows[0].c).toBe(1)
  })

  test("findPlanningSnapshot returns null for unknown hashes", async () => {
    expect(await findPlanningSnapshot(fakeHash("nope"))).toBeNull()
  })

  test("list newest-first by created_at", async () => {
    const a = fakeHash("aaa")
    const b = fakeHash("bbb")
    await recordPlanningSnapshot({ hash: a, novelId, version: "v1" })
    // Tiny pause so created_at differs reliably under any clock.
    await new Promise(r => setTimeout(r, 10))
    await recordPlanningSnapshot({ hash: b, novelId, version: "v1" })

    const list = await listPlanningSnapshots(novelId)
    expect(list.length).toBe(2)
    expect(list[0].id).toBe(b)
    expect(list[1].id).toBe(a)
  })

  test("lock: pending → locked transitions; second lock attempt returns false", async () => {
    const hash = fakeHash("lock1")
    await recordPlanningSnapshot({ hash, novelId, version: "v1" })

    const ok1 = await lockPlanningSnapshot({
      hash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: "manual lock",
    })
    expect(ok1).toBe(true)

    // Re-lock attempt fails the WHERE locked_at IS NULL guard.
    const ok2 = await lockPlanningSnapshot({
      hash,
      lockedByKind: "policy",
      lockedByRef: "auto",
      lockedNote: "auto-lock",
    })
    expect(ok2).toBe(false)

    const row = await findPlanningSnapshot(hash)
    expect(row!.locked_at).not.toBeNull()
    expect(row!.locked_by_kind).toBe("human")
    expect(row!.locked_note).toBe("manual lock")
  })

  test("lock: returns false when the hash doesn't exist", async () => {
    const result = await lockPlanningSnapshot({
      hash: fakeHash("ghost"),
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })
    expect(result).toBe(false)
  })

  test("getLockedPlanningSnapshot: returns null when no snapshot is locked", async () => {
    const a = fakeHash("unlocked-a")
    await recordPlanningSnapshot({ hash: a, novelId, version: "v1" })
    expect(await getLockedPlanningSnapshot(novelId)).toBeNull()
  })

  test("getLockedPlanningSnapshot: returns the most recently locked", async () => {
    const a = fakeHash("ld1")
    const b = fakeHash("ld2")
    await recordPlanningSnapshot({ hash: a, novelId, version: "v1" })
    await recordPlanningSnapshot({ hash: b, novelId, version: "v1" })
    await lockPlanningSnapshot({
      hash: a,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })
    await new Promise(r => setTimeout(r, 10))
    await lockPlanningSnapshot({
      hash: b,
      lockedByKind: "policy",
      lockedByRef: null,
      lockedNote: null,
    })
    const locked = await getLockedPlanningSnapshot(novelId)
    expect(locked).not.toBeNull()
    expect(locked!.id).toBe(b)
    expect(locked!.locked_by_kind).toBe("policy")
  })

  // OpenCode review LOW 1 (2026-05-04) — DB-level guard for the one-way
  // lock. The 039 migration installs a BEFORE UPDATE trigger that blocks
  // any mutation of lock fields on an already-locked row. These tests
  // pin the trigger's positive (first lock allowed) and negative
  // (post-lock mutation blocked) sides.
  test("DB trigger: lock fields are immutable once locked_at is non-NULL", async () => {
    const hash = fakeHash("trglock1")
    await recordPlanningSnapshot({ hash, novelId, version: "v1" })
    await lockPlanningSnapshot({
      hash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: "first lock",
    })
    // Direct SQL bypasses the application's WHERE locked_at IS NULL
    // guard. The trigger MUST refuse anyway.
    let raised: Error | null = null
    try {
      await db`UPDATE planning_snapshots
               SET locked_at = NOW(),
                   locked_by_kind = 'policy',
                   locked_note = 'overwrite attempt'
               WHERE id = ${hash}`
    } catch (err) {
      raised = err as Error
    }
    expect(raised).not.toBeNull()
    expect(raised!.message).toContain("already locked")
    // Row state is preserved.
    const row = await findPlanningSnapshot(hash)
    expect(row!.locked_by_kind).toBe("human")
    expect(row!.locked_note).toBe("first lock")
  })

  test("DB trigger: clearing locked_at is also blocked", async () => {
    const hash = fakeHash("trglock2")
    await recordPlanningSnapshot({ hash, novelId, version: "v1" })
    await lockPlanningSnapshot({
      hash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })
    let raised: Error | null = null
    try {
      await db`UPDATE planning_snapshots SET locked_at = NULL WHERE id = ${hash}`
    } catch (err) {
      raised = err as Error
    }
    expect(raised).not.toBeNull()
    const row = await findPlanningSnapshot(hash)
    expect(row!.locked_at).not.toBeNull()
  })

  test("DB trigger: first lock transition (NULL → non-NULL) is allowed", async () => {
    const hash = fakeHash("trglock3")
    await recordPlanningSnapshot({ hash, novelId, version: "v1" })
    // The application path; the trigger should let this succeed.
    const ok = await lockPlanningSnapshot({
      hash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })
    expect(ok).toBe(true)
    const row = await findPlanningSnapshot(hash)
    expect(row!.locked_at).not.toBeNull()
  })

  test("deletePlanningSnapshotsForNovel removes only that novel's rows", async () => {
    const otherNovelId = `${novelId}-other`
    await seedNovel(otherNovelId)
    try {
      const a = fakeHash("a1")
      const b = fakeHash("b1")
      await recordPlanningSnapshot({ hash: a, novelId, version: "v1" })
      await recordPlanningSnapshot({ hash: b, novelId: otherNovelId, version: "v1" })

      await deletePlanningSnapshotsForNovel(novelId)
      expect(await listPlanningSnapshots(novelId)).toEqual([])
      const remaining = await listPlanningSnapshots(otherNovelId)
      expect(remaining.map(r => r.id)).toEqual([b])
    } finally {
      await dropNovel(otherNovelId)
    }
  })
})
