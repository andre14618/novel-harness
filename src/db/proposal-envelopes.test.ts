/**
 * Phase 3 commit 4 — proposal_envelopes persistence tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 3"
 *
 * Skipped when Postgres isn't reachable (CI without DB). Covers the
 * insert / list / lookup / resolve / delete shape; smoke-tests the
 * idempotent-insert contract that makes /adjust safe to retry.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import {
  insertArtifactPatchEnvelope,
  listArtifactPatchEnvelopes,
  findEnvelopeById,
  updateEnvelopeResolution,
  deleteEnvelopesForNovel,
} from "./proposal-envelopes"
import { buildArtifactPatchEnvelope } from "../canon/proposal-envelope"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"

const reachable = await dbReachable()
const fixedNow = new Date("2026-05-04T12:00:00.000Z")

const baseArtifacts = {
  world: { setting: "Tower" },
  characters: [
    { id: "char-hero", name: "Aria", goals: "Find the key" },
    { id: "char-foe", name: "Mord", goals: "Stop her" },
  ],
  spine: { centralConflict: "Aria vs Mord" },
}

async function seedNovel(novelId: string): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function dropNovel(novelId: string): Promise<void> {
  await deleteEnvelopesForNovel(novelId)
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

function buildEnvelope(
  novelId: string,
  idx = 0,
  patchOverride?: AdjusterPatch,
  parentEnvelopeId?: string,
) {
  const patch: AdjusterPatch = patchOverride ?? {
    type: "characterUpdate",
    characterId: "char-hero",
    patch: { goals: "Find the second key" },
  }
  return buildArtifactPatchEnvelope({
    novelId,
    patch,
    patchIndex: idx,
    userMessage: `test message ${idx}`,
    rationale: `test rationale ${idx}`,
    artifacts: baseArtifacts,
    now: fixedNow,
    ...(parentEnvelopeId !== undefined ? { parentEnvelopeId } : {}),
  })
}

describe.skipIf(!reachable)("proposal-envelopes persistence", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-pe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("insert + list: a single envelope round-trips through Postgres", async () => {
    const env = buildEnvelope(novelId)
    const inserted = await insertArtifactPatchEnvelope(env)
    expect(inserted).toBe(true)

    const list = await listArtifactPatchEnvelopes(novelId)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(env.id)
    expect(list[0].kind).toBe("artifact_patch")
    expect(list[0].novelId).toBe(novelId)
    expect(list[0].target.kind).toBe("character")
    expect(list[0].target.ref).toBe("char-hero")
    expect(list[0].target.currentVersion).toBe(env.target.currentVersion)
    expect(list[0].source.userMessage).toBe("test message 0")
    expect(list[0].status).toBe("pending")
    expect(list[0].risk).toBe(env.risk)
    expect(list[0].payload).toEqual(env.payload)
    expect(list[0].precondition.hash).toBe(env.precondition.hash)
    expect(list[0].policyRecommendation.decision).toBe(env.policyRecommendation.decision)
    expect(list[0].policyRecommendation.reasons).toEqual(env.policyRecommendation.reasons)
    expect(list[0].evidence).toEqual(env.evidence)
  })

  test("insert is idempotent: same id is a no-op (returns false on second call)", async () => {
    const env = buildEnvelope(novelId)
    expect(await insertArtifactPatchEnvelope(env)).toBe(true)
    expect(await insertArtifactPatchEnvelope(env)).toBe(false)
    const rows = (await db`SELECT COUNT(*)::int AS c FROM proposal_envelopes
                           WHERE novel_id = ${novelId}`) as { c: number }[]
    expect(rows[0].c).toBe(1)
  })

  test("list filters by status (default = pending)", async () => {
    const env1 = buildEnvelope(novelId, 0)
    const env2 = buildEnvelope(novelId, 1, {
      type: "worldUpdate",
      patch: { setting: "Harbor" },
    })
    await insertArtifactPatchEnvelope(env1)
    await insertArtifactPatchEnvelope(env2)

    // Resolve env1 as approved.
    await updateEnvelopeResolution({
      id: env1.id,
      status: "approved",
      resolvedAt: new Date().toISOString(),
      resolvedByKind: "human",
      resolvedByRef: null,
      resolvedNote: null,
      modifiedPayload: null,
    })

    const pending = await listArtifactPatchEnvelopes(novelId)
    expect(pending.map((e) => e.id)).toEqual([env2.id])

    const approved = await listArtifactPatchEnvelopes(novelId, { status: "approved" })
    expect(approved.map((e) => e.id)).toEqual([env1.id])

    const all = await listArtifactPatchEnvelopes(novelId, { status: "all" })
    expect(all.map((e) => e.id).sort()).toEqual([env1.id, env2.id].sort())
  })

  test("findEnvelopeById returns null for unknown ids", async () => {
    expect(await findEnvelopeById("planner:bogus:fact-c1-f1:v2")).toBeNull()
  })

  test("findEnvelopeById returns the row for known ids", async () => {
    const env = buildEnvelope(novelId)
    await insertArtifactPatchEnvelope(env)
    const row = await findEnvelopeById(env.id)
    expect(row).not.toBeNull()
    expect(row!.id).toBe(env.id)
    expect(row!.novel_id).toBe(novelId)
  })

  test("updateEnvelopeResolution: pending → approved transitions; second update is no-op", async () => {
    const env = buildEnvelope(novelId)
    await insertArtifactPatchEnvelope(env)
    const resolvedAt = new Date().toISOString()

    const ok1 = await updateEnvelopeResolution({
      id: env.id,
      status: "approved",
      resolvedAt,
      resolvedByKind: "human",
      resolvedByRef: null,
      resolvedNote: "looks fine",
      modifiedPayload: null,
    })
    expect(ok1).toBe(true)

    // Re-resolve attempt fails the WHERE status='pending' guard.
    const ok2 = await updateEnvelopeResolution({
      id: env.id,
      status: "rejected",
      resolvedAt,
      resolvedByKind: "human",
      resolvedByRef: null,
      resolvedNote: "changed mind",
      modifiedPayload: null,
    })
    expect(ok2).toBe(false)

    // The row's status is whatever the FIRST resolve set it to.
    const row = await findEnvelopeById(env.id)
    expect(row?.status).toBe("approved")
    expect(row?.resolved_note).toBe("looks fine")
  })

  test("parentEnvelopeId provenance: round-trips through DB and shows up in source.parentEnvelopeId on read", async () => {
    // Phase 3 commit 4 follow-up B — regen lineage. The schema column
    // `parent_envelope_id` was reserved in commit 4; this test confirms
    // it's now actually populated via `envelope.source.parentEnvelopeId`
    // and reads back through `listArtifactPatchEnvelopes`.
    const parent = buildEnvelope(novelId, 0)
    await insertArtifactPatchEnvelope(parent)
    const child = buildEnvelope(
      novelId,
      1,
      { type: "characterUpdate", characterId: "char-hero", patch: { goals: "Find the third key" } },
      parent.id,
    )
    expect(child.source.parentEnvelopeId).toBe(parent.id)
    await insertArtifactPatchEnvelope(child)

    // Read directly: confirm the column.
    const row = await findEnvelopeById(child.id)
    expect(row).not.toBeNull()
    expect(row!.parent_envelope_id).toBe(parent.id)

    // Read through the typed lister: surfaces on source.parentEnvelopeId.
    const list = await listArtifactPatchEnvelopes(novelId, { status: "all" })
    const childRow = list.find((e) => e.id === child.id)
    expect(childRow).toBeDefined()
    expect(childRow!.source.parentEnvelopeId).toBe(parent.id)
    // Parent's own row has no parent.
    const parentRow = list.find((e) => e.id === parent.id)
    expect(parentRow!.source.parentEnvelopeId).toBeUndefined()
  })

  test("deleteEnvelopesForNovel removes only that novel's rows", async () => {
    const otherNovelId = `${novelId}-other`
    await seedNovel(otherNovelId)
    try {
      const a = buildEnvelope(novelId)
      const b = buildEnvelope(otherNovelId)
      await insertArtifactPatchEnvelope(a)
      await insertArtifactPatchEnvelope(b)

      await deleteEnvelopesForNovel(novelId)
      expect(await listArtifactPatchEnvelopes(novelId)).toEqual([])
      const remaining = await listArtifactPatchEnvelopes(otherNovelId)
      expect(remaining.map((e) => e.id)).toEqual([b.id])
    } finally {
      await dropNovel(otherNovelId)
    }
  })
})
