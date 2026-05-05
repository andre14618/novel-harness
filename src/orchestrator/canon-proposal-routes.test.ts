/**
 * Phase 2A — Canon Proposal Review API tests.
 *
 * Charter: docs/charters/world-bible-architecture.md (§1 cleared)
 * Lane:    docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-2a.md
 *
 * HTTP-level tests via direct handler invocation (no Bun.serve binding).
 * The handler module returns null when a path doesn't match; we assert that
 * routes ONLY fire on the right path+method combination.
 *
 * DB-backed (skipIf-unreachable). The route module talks to canon_proposals
 * and chapter_outlines via the substrate; an InMemory tier doesn't make
 * sense here because the routes ARE the production seam.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import * as canonDb from "../db/canon-substrate"
import {
  deleteProposalResolutionOutcomesForNovel,
  findProposalResolutionOutcome,
} from "../db/proposal-resolution-outcomes"
import { saveChapterOutline } from "../db/outlines"
import {
  handleCanonProposalRoute,
  isResolveConcurrencyConflict,
} from "./canon-proposal-routes"
import { PostgresCanonSubstrate } from "../harness/canon-substrate"
import {
  generatePlannerCanonProposals,
  plannerProposalId,
} from "../harness/planner-canon-proposals"
import type { ChapterOutline } from "../types"
import type { CanonUpdateProposal } from "../canon/api"

const reachable = await dbReachable()

// ── Fixture helpers ─────────────────────────────────────────────────────────
//
// Reuse the Phase-1 test's chapter shape (4 facts + 3 knowledge + 3 state per
// chapter, all referenced by a single coverage beat). Inlined here rather
// than imported because test-fixture sharing is a worse coupling than
// duplication for one shape used in two test files.

function makeChapter(n: number): ChapterOutline {
  const facts = Array.from({ length: 4 }, (_, i) => ({
    id: `fact-c${n}-f${i + 1}`,
    fact: `Chapter ${n} fact ${i + 1}.`,
    category: "physical",
  }))
  const knowledgeChanges = Array.from({ length: 3 }, (_, i) => ({
    id: `know-c${n}-k${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    characterName: `Actor C${n}-${i + 1}`,
    knowledge: `Chapter ${n} knowledge ${i + 1}.`,
    source: "witnessed",
  }))
  const characterStateChanges = Array.from({ length: 3 }, (_, i) => ({
    id: `state-c${n}-s${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    name: `Actor C${n}-${i + 1}`,
    location: `Setting ${n}.${i + 1}`,
    emotionalState: "calm",
    knows: [],
    doesNotKnow: [],
  }))
  return {
    chapterNumber: n,
    title: `Chapter ${n}`,
    povCharacter: "",
    setting: "",
    purpose: `Test chapter ${n}.`,
    targetWords: 1000,
    charactersPresent: [],
    charactersPresentIds: [],
    establishedFacts: facts,
    knowledgeChanges,
    characterStateChanges,
    scenes: [
      {
        beatId: `ch-${String(n).padStart(3, "0")}-test-beat-001-coverage`,
        description: `Cover all chapter ${n} source items.`,
        characters: [],
        kind: "action",
        requiredPayoffs: [],
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
        obligations: {
          mustEstablish: facts.map((f) => ({
            text: `Establish ${f.id}.`,
            sourceId: f.id,
            sourceKind: "fact",
          })),
          mustPayOff: [],
          mustTransferKnowledge: knowledgeChanges.map((k) => ({
            text: `Transfer ${k.id}.`,
            sourceId: k.id,
            sourceKind: "knowledge",
            characterId: k.characterId,
          })),
          mustShowStateChange: characterStateChanges.map((s) => ({
            text: `Show ${s.id}.`,
            sourceId: s.id,
            sourceKind: "state",
            characterId: s.characterId,
          })),
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  } as unknown as ChapterOutline
}

async function seedNovel(novelId: string): Promise<void> {
  // chapter_outlines has a FK to novels; create the parent row before
  // saving outlines. Minimal seed payload — none of the route logic
  // touches it.
  await db`
    INSERT INTO novels (id, phase, seed_json, total_chapters)
    VALUES (${novelId}, 'concept', ${JSON.stringify({ title: novelId })}::jsonb, 3)
    ON CONFLICT (id) DO NOTHING
  `
}

async function seedOutlines(novelId: string): Promise<ChapterOutline[]> {
  await seedNovel(novelId)
  const outlines = [makeChapter(1), makeChapter(2), makeChapter(3)]
  for (const o of outlines) await saveChapterOutline(novelId, o)
  return outlines
}

async function deleteFixture(novelId: string): Promise<void> {
  await deleteProposalResolutionOutcomesForNovel(novelId)
  await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

// Direct handler invocation — same shape as a Bun.serve fetch but no
// network round-trip. Mirrors what server.ts hands the handler.
function invoke(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const url = new URL(`http://test.local${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "Content-Type": "application/json" }
  }
  const req = new Request(url.toString(), init)
  return handleCanonProposalRoute(req, url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  const r = res as Response
  return { status: r.status, body: await r.json() }
}

// ── Pure unit tests (no DB) ─────────────────────────────────────────────────

describe("isResolveConcurrencyConflict (Codex Package B HIGH 1)", () => {
  test("matches harness pre-write status check error", () => {
    expect(
      isResolveConcurrencyConflict(
        "resolveProposal: proposal X already approved",
      ),
    ).toBe(true)
    expect(
      isResolveConcurrencyConflict(
        "resolveProposal: proposal X already rejected",
      ),
    ).toBe(true)
    expect(
      isResolveConcurrencyConflict(
        "resolveProposal: proposal X already modified",
      ),
    ).toBe(true)
  })

  test("matches DB-guard error from updateProposalResolution", () => {
    // This is the case that was previously slipping through to 500.
    expect(
      isResolveConcurrencyConflict(
        "updateProposalResolution: proposal X is not pending (already resolved, or unknown id)",
      ),
    ).toBe(true)
  })

  test("does NOT match unrelated errors", () => {
    expect(isResolveConcurrencyConflict("connection refused")).toBe(false)
    expect(isResolveConcurrencyConflict("invalid jsonb")).toBe(false)
    expect(isResolveConcurrencyConflict("unknown proposalId X")).toBe(false)
    expect(isResolveConcurrencyConflict("")).toBe(false)
  })
})

// ── DB-backed tests ─────────────────────────────────────────────────────────

describe.skipIf(!reachable)("handleCanonProposalRoute", () => {
  let novelId: string

  beforeEach(() => {
    novelId = `test-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  })

  afterEach(async () => {
    await canonDb.deleteAllForNovel(novelId)
    await deleteFixture(novelId)
  })

  // ── Path / method dispatch ────────────────────────────────────────────

  test("returns null on path mismatch", async () => {
    expect(
      await invoke("GET", "/api/something/else"),
    ).toBeNull()
    expect(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals/extra`),
    ).toBeNull()
  })

  test("returns null on wrong method", async () => {
    expect(await invoke("DELETE", `/api/novel/${novelId}/canon-proposals`)).toBeNull()
    expect(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals/abc/resolve`),
    ).toBeNull()
  })

  // ── List ──────────────────────────────────────────────────────────────

  test("GET list — returns 30 pending after generate", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals`),
    )
    expect(status).toBe(200)
    expect(body.proposals).toHaveLength(30)
    for (const p of body.proposals as CanonUpdateProposal[]) {
      expect(p.status).toBe("pending")
    }
  })

  test("GET list — filter by source returns matching only", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const { body: factsBody } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?source=planner-output`,
      ),
    )
    expect(factsBody.proposals).toHaveLength(12)
    for (const p of factsBody.proposals as CanonUpdateProposal[]) {
      expect(p.source).toBe("planner-output")
    }

    const { body: stateBody } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?source=planning-state-mapper`,
      ),
    )
    expect(stateBody.proposals).toHaveLength(18) // 9 knowledge + 9 state
    for (const p of stateBody.proposals as CanonUpdateProposal[]) {
      expect(p.source).toBe("planning-state-mapper")
    }
  })

  test("GET list — filter by chapter returns chapter-scoped only", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const { body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals?chapter=2`),
    )
    expect(body.proposals).toHaveLength(10)
    for (const p of body.proposals as CanonUpdateProposal[]) {
      expect(p.proposedFact.provenance.chapter).toBe(2)
    }
  })

  test("GET list — plannerOnly filters out non-planner proposals", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))

    // Add a non-planner proposal via the substrate's normal route. It gets
    // an auto-generated id (`proposal-N`) which doesn't match the planner
    // prefix.
    const sub = new PostgresCanonSubstrate()
    const extra = await sub.proposeCanonUpdate(novelId, {
      source: "post-draft-extraction",
      proposedFact: {
        id: "fact-other",
        kind: "established_fact",
        text: "Non-planner fact.",
        provenance: {
          source: "post-draft-extraction",
          chapter: 1,
          extractorVersion: "test-v1",
          origin: "observed",
        },
      },
    })

    const { body: allBody } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals`),
    )
    expect(allBody.proposals).toHaveLength(31)

    const { body: plannerBody } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?plannerOnly=true`,
      ),
    )
    expect(plannerBody.proposals).toHaveLength(30)
    expect(
      (plannerBody.proposals as CanonUpdateProposal[]).map((p) => p.id),
    ).not.toContain(extra.id)
  })

  // ── List with ?status= (audit-view extension) ──────────────────────────

  test("GET list — ?status=approved returns only resolved-approved proposals", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    // Approve one + reject one so we have a mixed-status fixture.
    const approveTarget = plannerProposalId(novelId, "fact-c1-f1")
    const rejectTarget = plannerProposalId(novelId, "fact-c1-f2")
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(approveTarget)}/resolve`,
      { status: "approved" },
    )
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(rejectTarget)}/resolve`,
      { status: "rejected" },
    )

    // Default (no status param) still returns pending only — backward compat.
    const { body: defaultBody } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals`),
    )
    expect(defaultBody.proposals).toHaveLength(28)
    for (const p of defaultBody.proposals as CanonUpdateProposal[]) {
      expect(p.status).toBe("pending")
    }

    // ?status=approved → only the one approved row.
    const { body: approvedBody } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals?status=approved`),
    )
    expect(approvedBody.proposals).toHaveLength(1)
    expect((approvedBody.proposals[0] as CanonUpdateProposal).id).toBe(approveTarget)
    expect((approvedBody.proposals[0] as CanonUpdateProposal).status).toBe("approved")

    // ?status=rejected → only the one rejected row.
    const { body: rejectedBody } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals?status=rejected`),
    )
    expect(rejectedBody.proposals).toHaveLength(1)
    expect((rejectedBody.proposals[0] as CanonUpdateProposal).id).toBe(rejectTarget)
  })

  test("GET list — ?status=all returns every proposal regardless of status", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const approveTarget = plannerProposalId(novelId, "fact-c1-f1")
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(approveTarget)}/resolve`,
      { status: "approved" },
    )

    const { body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals?status=all`),
    )
    expect(body.proposals).toHaveLength(30)
    const statuses = new Set(
      (body.proposals as CanonUpdateProposal[]).map((p) => p.status),
    )
    expect(statuses.has("pending")).toBe(true)
    expect(statuses.has("approved")).toBe(true)
  })

  test("GET list — ?status=pending,approved supports CSV", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const approveTarget = plannerProposalId(novelId, "fact-c1-f1")
    const rejectTarget = plannerProposalId(novelId, "fact-c1-f2")
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(approveTarget)}/resolve`,
      { status: "approved" },
    )
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(rejectTarget)}/resolve`,
      { status: "rejected" },
    )

    const { body } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?status=pending,approved`,
      ),
    )
    // 28 pending + 1 approved = 29; rejected one excluded.
    expect(body.proposals).toHaveLength(29)
    const statusSet = new Set(
      (body.proposals as CanonUpdateProposal[]).map((p) => p.status),
    )
    expect(statusSet.has("rejected")).toBe(false)
  })

  test("GET list — ?status=bogus returns 400 with valid-set hint", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))

    const { status, body } = await expectJson(
      await invoke("GET", `/api/novel/${novelId}/canon-proposals?status=bogus`),
    )
    expect(status).toBe(400)
    expect(body.error).toContain("unknown status values: bogus")
    expect(body.error).toContain("pending")
    expect(body.error).toContain("approved")
  })

  test("GET list — status filter composes with source/chapter/plannerOnly filters", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    // Approve one chapter-1 fact; everything else stays pending.
    const approveTarget = plannerProposalId(novelId, "fact-c1-f1")
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(approveTarget)}/resolve`,
      { status: "approved" },
    )

    // status=approved + chapter=1 should narrow to that single row.
    const { body } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?status=approved&chapter=1`,
      ),
    )
    expect(body.proposals).toHaveLength(1)
    expect((body.proposals[0] as CanonUpdateProposal).id).toBe(approveTarget)

    // status=approved + chapter=2 should be empty (the approved row is ch1).
    const { body: empty } = await expectJson(
      await invoke(
        "GET",
        `/api/novel/${novelId}/canon-proposals?status=approved&chapter=2`,
      ),
    )
    expect(empty.proposals).toHaveLength(0)
  })

  // ── Bulk resolve ───────────────────────────────────────────────────────

  test("POST bulk-resolve — approves multiple in one request, per-row results", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const ids = ["fact-c1-f1", "fact-c1-f2", "fact-c2-f1"].map((s) =>
      plannerProposalId(novelId, s),
    )
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: ids.map((id) => ({ proposalId: id, status: "approved" })),
      }),
    )
    expect(status).toBe(200)
    expect(body.counts).toEqual({ ok: 3, error: 0 })
    expect(body.results).toHaveLength(3)
    for (const r of body.results) {
      expect(r.status).toBe("ok")
      expect(r.resolution).toBe("approved")
      expect(r.committedFact).not.toBeNull()
    }
    const sub = new PostgresCanonSubstrate()
    await sub.loadSnapshot(novelId, 2)
    const visibleIds = sub.factsAsOfChapter(novelId, 2).map((f) => f.id)
    expect(visibleIds).toContain("fact-c1-f1")
    expect(visibleIds).toContain("fact-c1-f2")
    expect(visibleIds).toContain("fact-c2-f1")
  })

  test("POST bulk-resolve — partial failure does not abort the batch", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const okId = plannerProposalId(novelId, "fact-c1-f1")
    const unknownId = "planner:does-not-exist:0"
    const modifiedNoFactId = plannerProposalId(novelId, "fact-c1-f2")

    const { body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: [
          { proposalId: okId, status: "approved" },
          { proposalId: unknownId, status: "approved" }, // 404 path
          { proposalId: modifiedNoFactId, status: "modified" }, // missing modifiedFact → 400 path
        ],
      }),
    )
    expect(body.counts).toEqual({ ok: 1, error: 2 })
    expect(body.results[0].status).toBe("ok")
    expect(body.results[1].status).toBe("error")
    expect(body.results[1].error).toMatch(/unknown proposalId/)
    expect(body.results[2].status).toBe("error")
    expect(body.results[2].error).toMatch(/modified requires modifiedFact/)

    // The OK row committed; the failed rows did NOT mutate canon.
    const sub = new PostgresCanonSubstrate()
    await sub.loadSnapshot(novelId, 1)
    const visibleIds = sub.factsAsOfChapter(novelId, 1).map((f) => f.id)
    expect(visibleIds).toContain("fact-c1-f1")
    expect(visibleIds).not.toContain("fact-c1-f2")
  })

  test("POST bulk-resolve — persists policy metadata and resolvedBy for successful rows", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const ids = [
      plannerProposalId(novelId, "fact-c1-f1"),
      plannerProposalId(novelId, "fact-c1-f2"),
      plannerProposalId(novelId, "fact-c2-f1"),
    ]
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: ids.map((id) => ({ proposalId: id, status: "approved" })),
      }),
    )
    expect(status).toBe(200)
    expect(body.counts).toEqual({ ok: 3, error: 0 })

    const rows = (
      await db`
        SELECT id,
               resolved_by_kind,
               resolution_policy_decision,
               resolution_policy_version,
               resolution_policy_reasons
        FROM canon_proposals
        WHERE novel_id = ${novelId}
          AND id = ANY(${ids})
      `
    ) as Array<{
      id: string
      resolved_by_kind: string
      resolution_policy_decision: string
      resolution_policy_version: string
      resolution_policy_reasons: unknown
    }>
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(ids).toContain(row.id)
      expect(row.resolved_by_kind).toBe("human")
      expect(row.resolution_policy_decision).toBe("queue")
      expect(row.resolution_policy_version).toBe("manual-v1")
      const reasons =
        typeof row.resolution_policy_reasons === "string"
          ? JSON.parse(row.resolution_policy_reasons)
          : row.resolution_policy_reasons
      expect(Array.isArray(reasons)).toBe(true)
      expect((reasons as string[]).join(" ")).toContain("manual")
    }
  })

  test("POST bulk-resolve — already-resolved row → 409 entry, others succeed", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const a = plannerProposalId(novelId, "fact-c1-f1")
    const b = plannerProposalId(novelId, "fact-c1-f2")

    // Pre-approve `a` so the bulk call hits the "already resolved" path on it.
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(a)}/resolve`,
      { status: "approved" },
    )

    const { body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: [
          { proposalId: a, status: "approved" },
          { proposalId: b, status: "rejected" },
        ],
      }),
    )
    expect(body.counts).toEqual({ ok: 1, error: 1 })
    const aResult = body.results.find((r: any) => r.proposalId === a)
    const bResult = body.results.find((r: any) => r.proposalId === b)
    expect(aResult.status).toBe("error")
    expect(aResult.error).toMatch(/already approved/)
    expect(aResult.httpStatus).toBe(409)
    expect(bResult.status).toBe("ok")
    expect(bResult.resolution).toBe("rejected")
  })

  test("POST bulk-resolve — all-error batch returns counts.ok=0 + per-row errors (Codex Package C LOW 2)", async () => {
    // Three rows, all bad in different ways: missing proposalId, invalid
    // status, and unknown id. Verify the response is shaped correctly.
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: [
          { status: "approved" }, // missing proposalId
          { proposalId: "x", status: "bogus" }, // invalid status
          { proposalId: "planner:no-such-novel:0:v1", status: "approved" }, // unknown
        ],
      }),
    )
    expect(status).toBe(200)
    expect(body.counts).toEqual({ ok: 0, error: 3 })
    expect(body.results).toHaveLength(3)
    expect(body.results[0].error).toMatch(/missing proposalId/)
    expect(body.results[1].error).toMatch(/invalid status/)
    expect(body.results[2].error).toMatch(/unknown proposalId/)
  })

  test("POST bulk-resolve — empty resolutions returns counts {0,0}", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: [],
      }),
    )
    expect(status).toBe(200)
    expect(body.counts).toEqual({ ok: 0, error: 0 })
    expect(body.results).toEqual([])
  })

  test("POST bulk-resolve — over-cap → 400", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      proposalId: `planner:n:${i}`,
      status: "approved",
    }))
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        resolutions: tooMany,
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toMatch(/cap exceeded/)
  })

  test("POST bulk-resolve — missing resolutions array → 400", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/canon-proposals/bulk-resolve`, {
        notResolutions: [],
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toMatch(/resolutions/)
  })

  // ── Resolve ────────────────────────────────────────────────────────────

  test("POST resolve approve → committedFact returned + visible in canon", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c2-f1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approved" },
      ),
    )
    expect(status).toBe(200)
    expect(body.committedFact?.id).toBe("fact-c2-f1")
    expect(body.committedFact?.provenance.approvalStatus).toBe("human-approved")

    const sub = new PostgresCanonSubstrate()
    await sub.loadSnapshot(novelId, 2)
    const visible = sub.factsAsOfChapter(novelId, 2).map((f) => f.id)
    expect(visible).toContain("fact-c2-f1")
  })

  test("POST resolve reject → canon stays clean", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "know-c1-k1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "rejected", operatorNote: "no" },
      ),
    )
    expect(status).toBe(200)
    expect(body.committedFact).toBeNull()

    const sub = new PostgresCanonSubstrate()
    await sub.loadSnapshot(novelId, 1)
    expect(sub.factsAsOfChapter(novelId, 1)).toEqual([])
  })

  test("POST resolve modified → committed canon carries operator-edited text + human-edited approval", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    // Pull current proposed fact to use as the base for the modified payload.
    const row = await canonDb.findProposal(targetId)
    expect(row).not.toBeNull()
    const proposed = canonDb.proposalFromRow(row!).proposedFact
    const modifiedFact = {
      ...proposed,
      text: "operator-edited text",
    }

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "modified", modifiedFact, operatorNote: "tightened" },
      ),
    )
    expect(status).toBe(200)
    expect(body.committedFact?.text).toBe("operator-edited text")
    expect(body.committedFact?.provenance.approvalStatus).toBe("human-edited")
  })

  // ── Resolve — error paths ──────────────────────────────────────────────

  test("POST resolve unknown id → 404", async () => {
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/does-not-exist/resolve`,
        { status: "approved" },
      ),
    )
    expect(status).toBe(404)
    expect(body.error).toMatch(/unknown proposalId/i)
  })

  test("POST resolve invalid status → 400", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")
    const { status } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approve" }, // typo
      ),
    )
    expect(status).toBe(400)
  })

  test("POST resolve modified without modifiedFact → 400", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "modified" },
      ),
    )
    expect(status).toBe(400)
    expect(body.error).toMatch(/modifiedFact/)
  })

  test("POST resolve invalid resolvedBy is rejected", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approved", resolvedBy: "bot" },
      ),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid resolvedBy in body")
  })

  test("POST resolve invalid JSON body → 400", async () => {
    const url = new URL(
      `http://test.local/api/novel/${novelId}/canon-proposals/abc/resolve`,
    )
    const req = new Request(url.toString(), {
      method: "POST",
      body: "not-json{",
      headers: { "Content-Type": "application/json" },
    })
    const res = await handleCanonProposalRoute(req, url)
    expect(res).not.toBeNull()
    expect((res as Response).status).toBe(400)
  })

  // ── Stale precondition ─────────────────────────────────────────────────

  test("POST resolve with expectedStatus mismatch → 409 + actual status", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c3-f1")

    // Resolve once.
    const first = await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
      { status: "approved" },
    )
    expect((first as Response).status).toBe(200)

    // Try to resolve again with expectedStatus=pending — stale.
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "rejected", expectedStatus: "pending" },
      ),
    )
    expect(status).toBe(409)
    expect(body.expectedStatus).toBe("pending")
    expect(body.actualStatus).toBe("approved")
  })

  // Round-1 LOW (deferred from round-1, closed in round-2 follow-up):
  // deterministic regression test for the concurrent-resolve race surface.
  // The pre-fix bug was that the substrate's DB-level guard could surface a
  // race as "updateProposalResolution: ... is not pending" inside the catch
  // block, which the round-0 code mishandled as 500. The round-1 Package B
  // HIGH 1 fix introduced `isResolveConcurrencyConflict` to recognize both
  // race patterns. This test pins down that contract: two concurrent resolves
  // on the SAME pending proposal MUST resolve to exactly one 200 (winner)
  // and one 409 (loser, with actualStatus reflecting the winner's resolution).
  // Idempotent: regardless of which side the DB schedules first, the
  // post-condition is the same.
  test("POST resolve — concurrent same-proposal resolves: one 200 + one 409 (race-window deterministic)", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    // Fire BOTH resolves concurrently. They share a pending proposal row;
    // exactly one DB-level update must succeed and exactly one must surface
    // as a race conflict via `isResolveConcurrencyConflict`. Promise.all is
    // the JS-side concurrency primitive — the actual DB-side race lives in
    // the `WHERE status='pending'` guard inside `updateProposalResolution`.
    const [resA, resB] = await Promise.all([
      invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approved" },
      ),
      invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "rejected" },
      ),
    ])

    const a = await expectJson(resA)
    const b = await expectJson(resB)
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])

    const winner = a.status === 200 ? a : b
    const loser = a.status === 200 ? b : a
    expect(winner.body.proposalId).toBe(targetId)
    // Either approved (resA) or rejected (resB) wins — both are legal
    // resolutions; we only assert the contract that EXACTLY one wins.
    expect(["approved", "rejected"]).toContain(winner.body.status)
    expect(loser.body.proposalId).toBe(targetId)
    expect(["approved", "rejected"]).toContain(loser.body.actualStatus)
    // The loser's actualStatus must match the winner's resolution.
    expect(loser.body.actualStatus).toBe(winner.body.status)

    // DB-side post-condition: the proposal row reflects exactly one
    // resolution. The winning canon row exists if the winner approved; if
    // the winner rejected, no canon row was committed.
    const proposalRows = (await db`
      SELECT status FROM canon_proposals WHERE id = ${targetId}
    `) as { status: string }[]
    expect(proposalRows).toHaveLength(1)
    expect(proposalRows[0].status).toBe(winner.body.status)

    const factRows = (await db`
      SELECT approval_status FROM canon_facts
      WHERE novel_id = ${novelId} AND logical_id = 'fact-c1-f1'
    `) as { approval_status: string }[]
    if (winner.body.status === "approved") {
      expect(factRows).toHaveLength(1)
      expect(factRows[0].approval_status).toBe("human-approved")
    } else {
      // Winner rejected → no canon row was committed by the resolve.
      expect(factRows).toHaveLength(0)
    }
  }, 30_000)

  test("POST resolve already-resolved proposal (no expectedStatus) → 409", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c3-f2")
    await invoke(
      "POST",
      `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
      { status: "rejected" },
    )
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approved" },
      ),
    )
    expect(status).toBe(409)
    expect(body.actualStatus).toBe("rejected")
  })

  // ── Generate from outline ──────────────────────────────────────────────

  test("POST generate-from-outline → creates 30 proposals; rerun is idempotent", async () => {
    await seedOutlines(novelId)
    const first = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/generate-from-outline`,
      ),
    )
    expect(first.status).toBe(200)
    expect(first.body.gateClear).toBe(true)
    expect(first.body.created).toHaveLength(30)
    expect(first.body.skipped).toHaveLength(0)
    expect(first.body.outlinesCount).toBe(3)

    const second = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/generate-from-outline`,
      ),
    )
    expect(second.status).toBe(200)
    expect(second.body.created).toHaveLength(0)
    expect(second.body.skipped).toHaveLength(30)
  })

  test("POST generate-from-outline — malformed persisted outline → 422 with validation errors (Codex Package B MEDIUM 1)", async () => {
    await seedNovel(novelId)
    // Insert a deliberately malformed outline_json so the route's zod
    // validation pre-check fails before reaching the audit. Pre-fix this
    // raised an uncaught exception inside `runPlannerCanonDeltaAudit` and
    // fell through to a generic 500.
    await db`
      INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json)
      VALUES (${novelId}, 1, ${JSON.stringify({ chapterNumber: "not-a-number" })}::jsonb)
    `
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/generate-from-outline`,
      ),
    )
    expect(status).toBe(422)
    expect(body.error).toMatch(/schema validation/i)
    expect(Array.isArray(body.validationErrors)).toBe(true)
    expect(body.validationErrors.length).toBeGreaterThan(0)
  })

  test("POST generate-from-outline with no outlines → 404", async () => {
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/generate-from-outline`,
      ),
    )
    expect(status).toBe(404)
    expect(body.error).toMatch(/no chapter outlines/i)
  })

  test("POST generate-from-outline with broken gate → gateClear=false, no proposals", async () => {
    await seedNovel(novelId)
    // Seed two chapters with an overlapping fact id — gate fails-closed.
    const ch1 = makeChapter(1)
    const ch2 = makeChapter(2)
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId =
      ch1.establishedFacts[0].id
    await saveChapterOutline(novelId, ch1)
    await saveChapterOutline(novelId, ch2)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/generate-from-outline`,
      ),
    )
    expect(status).toBe(200)
    expect(body.gateClear).toBe(false)
    expect(body.created).toHaveLength(0)
    expect(body.gateReport.summary.duplicateSourceIdCount).toBeGreaterThan(0)

    const rows = (await db`
      SELECT COUNT(*)::int AS c FROM canon_proposals WHERE novel_id = ${novelId}
    `) as Array<{ c: number }>
    expect(rows[0].c).toBe(0)
  })

  // ── Phase 6 commit 4: ApprovalPolicy persistence on canon_proposals resolve ──
  // Mirrors the artifact_patch + prose_edit policy persistence (Phase 6
  // commits 2-3) on the canon_proposals table. The default manual policy
  // produces decision=queue (the operator is overriding when status='approved'
  // is received). The substrate's manualKinds=["canon_update"] default makes
  // canon proposals always queue regardless of mode — even autonomous mode
  // queues them. The audit signal still matters: NULL means "no policy
  // attached", non-NULL means "policy was evaluated and said X".

  test("Phase 6: default manual policy persists decision=queue/manual-v1 on approve", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c2-f1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        { status: "approved" },
      ),
    )
    expect(status).toBe(200)
    expect(body.policy).toEqual({ decision: "queue", version: "manual-v1" })

    const rows = (await db`SELECT resolved_by_kind, resolution_policy_decision, resolution_policy_version,
                                  resolution_policy_reasons
                           FROM canon_proposals WHERE id = ${targetId}`) as Array<{
      resolved_by_kind: string
      resolution_policy_decision: string
      resolution_policy_version: string
      resolution_policy_reasons: unknown
    }>
    expect(rows[0].resolved_by_kind).toBe("human")
    expect(rows[0].resolution_policy_decision).toBe("queue")
    expect(rows[0].resolution_policy_version).toBe("manual-v1")

    const outcome = await findProposalResolutionOutcome("canon_proposals", targetId)
    expect(outcome).not.toBeNull()
    expect(outcome!.proposalKind).toBe("canon_update")
    expect(outcome!.downstreamCanonConflict).toBe(false)
    expect(outcome!.downstreamEditChurn).toBe(0)
    expect(outcome!.metadata.observer).toBe("canon-substrate-resolve")
  })

  test("Phase 6: autonomous policy still queues canon (manualKinds=[canon_update] default)", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        {
          status: "approved",
          policy: { version: "auto-v1", mode: "autonomous" },
        },
      ),
    )
    expect(status).toBe(200)
    // manualKinds default = ["canon_update"] — autonomous policy still
    // returns decision=queue for canon. The operator's status=approved
    // still drives the apply, but the policy disagreed (audit signal).
    expect(body.policy).toEqual({ decision: "queue", version: "auto-v1" })
  })

  test("Phase 6: opt out of manualKinds → autonomous policy approves canon", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    // Empty manualKinds opts out of the canon-update default block.
    // Risk classification = "high" (synthetic envelope), so a ceiling=high
    // policy lets it auto-approve in evaluator terms. Operator status still
    // drives the apply.
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        {
          status: "approved",
          policy: {
            version: "auto-yolo-v1",
            mode: "autonomous",
            autoApproveRiskCeiling: "high",
            manualKinds: [],
          },
        },
      ),
    )
    expect(status).toBe(200)
    expect(body.policy).toEqual({ decision: "approve", version: "auto-yolo-v1" })
  })

  test("Phase 6: invalid policy.mode in body → 400", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        {
          status: "approved",
          policy: { version: "x", mode: "free-for-all" },
        },
      ),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid policy in body")
  })

  test("Phase 6: resolvedBy=policy persists on the audit row", async () => {
    await seedOutlines(novelId)
    await generatePlannerCanonProposals(novelId, await seedHelper(novelId))
    const targetId = plannerProposalId(novelId, "fact-c1-f1")

    const { status } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/canon-proposals/${encodeURIComponent(targetId)}/resolve`,
        {
          status: "rejected",
          policy: { version: "auto-v1", mode: "autonomous" },
          resolvedBy: "policy",
        },
      ),
    )
    expect(status).toBe(200)

    const rows = (await db`SELECT resolved_by_kind FROM canon_proposals WHERE id = ${targetId}`) as Array<{
      resolved_by_kind: string
    }>
    expect(rows[0].resolved_by_kind).toBe("policy")

    const outcome = await findProposalResolutionOutcome("canon_proposals", targetId)
    expect(outcome).not.toBeNull()
    expect(outcome!.downstreamCanonConflict).toBe(true)
    expect(outcome!.downstreamEditChurn).toBe(0)
  })
})

// Tiny re-fetch helper — `seedOutlines` writes via `saveChapterOutline`, but
// the route path uses `getChapterOutlines` which round-trips through Postgres
// (and may surface column defaults the in-memory fixture doesn't carry). For
// the tests that pre-generate proposals BEFORE invoking the GET-list routes,
// we need the same outline shape both surfaces see.
async function seedHelper(novelId: string): Promise<ChapterOutline[]> {
  // The previous beforeEach test cycle already called seedOutlines; just
  // re-read via the same accessor the route module uses, so the proposal
  // generation runs against the canonical persisted shape.
  const outlines = (await db`
    SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  `) as Array<{ outline_json: ChapterOutline }>
  return outlines.map((r) => r.outline_json)
}
