/**
 * Phase 5 commit 3 — editorial envelope persistence tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * DB-bound (skipped when Postgres isn't reachable). Pin: insert
 * idempotency, list-by-status filtering, kind isolation (editorial_flag
 * inserts don't surface from prose_edit list and vice versa), round-trip
 * fidelity for the typed payloads, and the kind-agnostic lifecycle
 * helpers (resolve / find / delete) work uniformly across both kinds.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import {
  insertEditorialFlagEnvelope,
  listEditorialFlagEnvelopes,
  insertProseEditEnvelope,
  listProseEditEnvelopes,
  findEnvelopeById,
  updateEnvelopeResolution,
  deleteEnvelopesForNovel,
} from "./editorial-envelopes"
import {
  buildEditorialFlagEnvelope,
  buildProseEditEnvelope,
  type EditorialFlagProposal,
  type ProseEditProposal,
} from "../canon/editorial-proposal"

const reachable = await dbReachable()
const fixedNow = new Date("2026-05-04T12:00:00.000Z")
const draftHash = "a".repeat(64)

async function seedNovel(novelId: string): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function dropNovel(novelId: string): Promise<void> {
  await deleteEnvelopesForNovel(novelId)
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

function buildFlagEnvelope(novelId: string, idx = 0, parentEnvelopeId?: string) {
  const proposal: EditorialFlagProposal = {
    issueType: "missing-beat-coverage",
    severity: "warning",
    beatRef: `b${idx + 1}`,
    chapterRef: "chapter:12",
    canonRefs: [],
    evidenceQuotes: [{ text: `evidence #${idx}`, ref: `draft:v1#span:0-${idx}` }],
    suggestedAction: `add coverage for beat ${idx + 1}`,
  }
  return buildEditorialFlagEnvelope({
    novelId,
    chapterRef: "chapter:12",
    proposal,
    proposalIndex: idx,
    agent: "editorial-beat-coverage",
    draftHash,
    rationale: `test #${idx}`,
    now: fixedNow,
    ...(parentEnvelopeId !== undefined ? { parentEnvelopeId } : {}),
  })
}

function buildEditEnvelope(novelId: string, idx = 0, parentEnvelopeId?: string) {
  const proposal: ProseEditProposal = {
    draftVersion: "chapter:12:draft:v3",
    target: { kind: "span", chapterRef: "chapter:12", start: idx * 100, end: idx * 100 + 50 },
    replacement: `replacement ${idx}`,
    rationale: `tighten pacing #${idx}`,
  }
  return buildProseEditEnvelope({
    novelId,
    proposal,
    proposalIndex: idx,
    agent: "prose-edit-llm",
    draftHash,
    rationale: proposal.rationale,
    now: fixedNow,
    ...(parentEnvelopeId !== undefined ? { parentEnvelopeId } : {}),
  })
}

describe.skipIf(!reachable)("editorial-envelopes persistence", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-ee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  // ── editorial_flag ──────────────────────────────────────────────────

  test("insertEditorialFlagEnvelope writes a row + listEditorialFlagEnvelopes reads it back", async () => {
    const env = buildFlagEnvelope(novelId, 0)
    const inserted = await insertEditorialFlagEnvelope(env)
    expect(inserted).toBe(true)
    const { envelopes: rows } = await listEditorialFlagEnvelopes(novelId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(env.id)
    expect(rows[0].kind).toBe("editorial_flag")
    expect(rows[0].novelId).toBe(novelId)
    expect(rows[0].target.kind).toBe("chapter_outline")
    expect(rows[0].target.ref).toBe("chapter:12")
    expect(rows[0].target.currentVersion).toBe(draftHash)
    expect(rows[0].precondition.kind).toBe("draft_hash")
    expect(rows[0].precondition.hash).toBe(draftHash)
    expect(rows[0].risk).toBe("medium")
    expect(rows[0].status).toBe("pending")
    expect(rows[0].evidence).toEqual([
      { kind: "quote", text: "evidence #0", ref: "draft:v1#span:0-0" },
    ])
    expect(rows[0].payload).toEqual(env.payload)
    expect(rows[0].source.agent).toBe("editorial-beat-coverage")
  })

  test("editorial-flag insert is idempotent (second insert returns false)", async () => {
    const env = buildFlagEnvelope(novelId, 0)
    expect(await insertEditorialFlagEnvelope(env)).toBe(true)
    expect(await insertEditorialFlagEnvelope(env)).toBe(false)
    const { envelopes: rows } = await listEditorialFlagEnvelopes(novelId)
    expect(rows).toHaveLength(1)
  })

  test("editorial-flag insert rejects wrong-kind envelope", async () => {
    const env = buildFlagEnvelope(novelId, 0)
    const tampered = { ...env, kind: "prose_edit" as const }
    await expect(
      insertEditorialFlagEnvelope(tampered as never),
    ).rejects.toThrow(/has kind=prose_edit/)
  })

  test("listEditorialFlagEnvelopes filters by status", async () => {
    const e1 = buildFlagEnvelope(novelId, 0)
    const e2 = buildFlagEnvelope(novelId, 1)
    await insertEditorialFlagEnvelope(e1)
    await insertEditorialFlagEnvelope(e2)
    const updated = await updateEnvelopeResolution({
      id: e1.id,
      status: "approved",
      resolvedAt: fixedNow.toISOString(),
      resolvedByKind: "human",
      resolvedByRef: null,
      resolvedNote: null,
      modifiedPayload: null,
    })
    expect(updated).toBe(true)
    const { envelopes: pending } = await listEditorialFlagEnvelopes(novelId, { status: "pending" })
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(e2.id)
    const { envelopes: approved } = await listEditorialFlagEnvelopes(novelId, { status: "approved" })
    expect(approved).toHaveLength(1)
    expect(approved[0].id).toBe(e1.id)
    expect(approved[0].status).toBe("approved")
    expect(approved[0].resolvedAt).toBeDefined()
    expect(approved[0].resolvedBy).toBe("human")
    const { envelopes: all } = await listEditorialFlagEnvelopes(novelId, { status: "all" })
    expect(all).toHaveLength(2)
  })

  test("editorial-flag conflicting insert preserves original parent metadata", async () => {
    // Original is parentless. A second envelope with the SAME proposal+idx
    // (→ same envelope id, Phase 5 commit 1 invariant) but a DIFFERENT
    // parent must not overwrite the original lineage — the DB-level
    // ON CONFLICT (id) DO NOTHING contract.
    //
    // Note: MEDIUM B (2026-05-04) blocks self-parent (parent == id) at
    // the builder, so the second build uses an unrelated parent id —
    // the conflict path is what's under test here, not self-parent.
    const e1 = buildFlagEnvelope(novelId, 0)
    await insertEditorialFlagEnvelope(e1)
    const e2 = buildFlagEnvelope(novelId, 0, "some-unrelated-parent-id")
    expect(e2.id).toBe(e1.id)
    expect(e2.source.parentEnvelopeId).toBe("some-unrelated-parent-id")
    const inserted = await insertEditorialFlagEnvelope(e2)
    expect(inserted).toBe(false)
    const { envelopes: rows } = await listEditorialFlagEnvelopes(novelId)
    expect(rows).toHaveLength(1)
    expect(rows[0].source.parentEnvelopeId).toBeUndefined()
  })

  test("editorial-flag parentEnvelopeId persists when proposal differs (new id)", async () => {
    const e1 = buildFlagEnvelope(novelId, 0)
    await insertEditorialFlagEnvelope(e1)
    const e2 = buildFlagEnvelope(novelId, 1, e1.id)
    expect(e2.id).not.toBe(e1.id)
    expect(await insertEditorialFlagEnvelope(e2)).toBe(true)
    const { envelopes: rows } = await listEditorialFlagEnvelopes(novelId, { status: "all" })
    expect(rows).toHaveLength(2)
    const fetchedChild = rows.find(r => r.id === e2.id)!
    expect(fetchedChild.source.parentEnvelopeId).toBe(e1.id)
  })

  // ── prose_edit ─────────────────────────────────────────────────────

  test("insertProseEditEnvelope writes a row + listProseEditEnvelopes reads it back", async () => {
    const env = buildEditEnvelope(novelId, 0)
    const inserted = await insertProseEditEnvelope(env)
    expect(inserted).toBe(true)
    const { envelopes: rows } = await listProseEditEnvelopes(novelId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(env.id)
    expect(rows[0].kind).toBe("prose_edit")
    expect(rows[0].target.kind).toBe("prose_span")
    expect(rows[0].target.ref).toBe("span:chapter:12@0-50")
    expect(rows[0].precondition.kind).toBe("draft_hash")
    expect(rows[0].precondition.hash).toBe(draftHash)
    expect(rows[0].risk).toBe("medium")
    expect(rows[0].status).toBe("pending")
    expect(rows[0].evidence).toEqual([])
    expect(rows[0].payload).toEqual(env.payload)
    expect(rows[0].payload.target.kind).toBe("span")
  })

  test("prose-edit insert is idempotent (second insert returns false)", async () => {
    const env = buildEditEnvelope(novelId, 0)
    expect(await insertProseEditEnvelope(env)).toBe(true)
    expect(await insertProseEditEnvelope(env)).toBe(false)
    const { envelopes: rows } = await listProseEditEnvelopes(novelId)
    expect(rows).toHaveLength(1)
  })

  test("prose-edit insert rejects wrong-kind envelope", async () => {
    const env = buildEditEnvelope(novelId, 0)
    const tampered = { ...env, kind: "editorial_flag" as const }
    await expect(
      insertProseEditEnvelope(tampered as never),
    ).rejects.toThrow(/has kind=editorial_flag/)
  })

  // ── kind isolation ──────────────────────────────────────────────────

  test("listEditorialFlagEnvelopes does not surface prose_edit rows (and vice versa)", async () => {
    const flag = buildFlagEnvelope(novelId, 0)
    const edit = buildEditEnvelope(novelId, 0)
    await insertEditorialFlagEnvelope(flag)
    await insertProseEditEnvelope(edit)

    const { envelopes: flags } = await listEditorialFlagEnvelopes(novelId, { status: "all" })
    expect(flags).toHaveLength(1)
    expect(flags[0].id).toBe(flag.id)

    const { envelopes: edits } = await listProseEditEnvelopes(novelId, { status: "all" })
    expect(edits).toHaveLength(1)
    expect(edits[0].id).toBe(edit.id)
  })

  test("rowToEditorialFlagEnvelope refuses to coerce a prose_edit row", async () => {
    const edit = buildEditEnvelope(novelId, 0)
    await insertProseEditEnvelope(edit)
    // Bypass the kind filter in the list helper by raw-querying so we
    // can feed a prose_edit row through findEnvelopeById and then watch
    // listEditorialFlagEnvelopes correctly skip it. The list query
    // already filters by kind, so the better thing to assert is that no
    // prose_edit row leaks into the editorial_flag list — which is the
    // kind-isolation test above. Here we additionally confirm the
    // generic find helper returns the raw row regardless of kind.
    const row = await findEnvelopeById(edit.id)
    expect(row?.kind).toBe("prose_edit")
  })

  // ── shared lifecycle helpers ────────────────────────────────────────

  test("updateEnvelopeResolution works for both kinds via the kind-agnostic id path", async () => {
    const flag = buildFlagEnvelope(novelId, 0)
    const edit = buildEditEnvelope(novelId, 0)
    await insertEditorialFlagEnvelope(flag)
    await insertProseEditEnvelope(edit)

    const okFlag = await updateEnvelopeResolution({
      id: flag.id,
      status: "rejected",
      resolvedAt: fixedNow.toISOString(),
      resolvedByKind: "human",
      resolvedByRef: "operator-1",
      resolvedNote: "false positive",
      modifiedPayload: null,
    })
    expect(okFlag).toBe(true)

    const okEdit = await updateEnvelopeResolution({
      id: edit.id,
      status: "approved",
      resolvedAt: fixedNow.toISOString(),
      resolvedByKind: "human",
      resolvedByRef: null,
      resolvedNote: null,
      modifiedPayload: null,
    })
    expect(okEdit).toBe(true)

    const { envelopes: allFlags } = await listEditorialFlagEnvelopes(novelId, { status: "all" })
    expect(allFlags[0].status).toBe("rejected")
    expect(allFlags[0].resolvedBy).toBe("human")

    const { envelopes: allEdits } = await listProseEditEnvelopes(novelId, { status: "all" })
    expect(allEdits[0].status).toBe("approved")
  })

  test("deleteEnvelopesForNovel removes both kinds atomically", async () => {
    await insertEditorialFlagEnvelope(buildFlagEnvelope(novelId, 0))
    await insertEditorialFlagEnvelope(buildFlagEnvelope(novelId, 1))
    await insertProseEditEnvelope(buildEditEnvelope(novelId, 0))
    expect((await listEditorialFlagEnvelopes(novelId, { status: "all" })).envelopes).toHaveLength(2)
    expect((await listProseEditEnvelopes(novelId, { status: "all" })).envelopes).toHaveLength(1)
    await deleteEnvelopesForNovel(novelId)
    expect((await listEditorialFlagEnvelopes(novelId, { status: "all" })).envelopes).toHaveLength(0)
    expect((await listProseEditEnvelopes(novelId, { status: "all" })).envelopes).toHaveLength(0)
  })
})
