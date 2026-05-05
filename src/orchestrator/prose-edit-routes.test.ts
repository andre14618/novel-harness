/**
 * Phase 5 commit 4 — prose-edit envelope apply route tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * DB-backed (skipIf-unreachable). Pin: approved+clean span apply
 * persists the new draft + flips the envelope to approved; approved+
 * stale precondition surfaces 409 with actualHash and rolls back; reject
 * persists status without writing a draft; missing draft → 404; beat-
 * target → 422 (unsupported in v1); body shape 4xxes; novelId mismatch
 * 4xxes; concurrent-resolve race surfaces alreadyResolved.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import {
  handleProseEditRoute,
  computeProseHash,
} from "./prose-edit-routes"
import {
  buildProseEditEnvelope,
  type ProseEditProposal,
} from "../canon/editorial-proposal"
import {
  insertProseEditEnvelope,
  deleteEnvelopesForNovel,
} from "../db/editorial-envelopes"
import { findEnvelopeById } from "../db/proposal-envelopes"
import {
  deleteProposalResolutionImpactsForNovel,
  deleteProposalResolutionOutcomesForNovel,
  findProposalResolutionImpact,
  findProposalResolutionOutcome,
} from "../db/proposal-resolution-outcomes"
import {
  saveChapterDraft,
  getLatestChapterDraft,
} from "../db/drafts"

const reachable = await dbReachable()
const fixedNow = new Date("2026-05-04T12:00:00.000Z")

async function seedNovel(novelId: string): Promise<void> {
  await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
           ON CONFLICT (id) DO NOTHING`
}

async function dropNovel(novelId: string): Promise<void> {
  await deleteProposalResolutionImpactsForNovel(novelId)
  await deleteProposalResolutionOutcomesForNovel(novelId)
  await deleteEnvelopesForNovel(novelId)
  await db`DELETE FROM chapter_drafts WHERE novel_id = ${novelId}`
  await db`DELETE FROM novels WHERE id = ${novelId}`
}

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const req = new Request(url, init)
  return handleProseEditRoute(req, url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

function buildSpanEnvelope(args: {
  novelId: string
  chapter: number
  start: number
  end: number
  replacement: string
  draftHash: string
}) {
  const proposal: ProseEditProposal = {
    draftVersion: `chapter:${args.chapter}:draft:v1`,
    target: { kind: "span", chapterRef: `chapter:${args.chapter}`, start: args.start, end: args.end },
    replacement: args.replacement,
    rationale: "test edit",
  }
  return buildProseEditEnvelope({
    novelId: args.novelId,
    proposal,
    proposalIndex: 0,
    agent: "test-prose-edit",
    draftHash: args.draftHash,
    rationale: proposal.rationale,
    now: fixedNow,
  })
}

describe("handleProseEditRoute — non-matching paths", () => {
  test("GET on resolve path returns null (POST only — pre-DB)", async () => {
    const url = new URL("http://localhost/api/novel/x/prose-edits/resolve")
    const res = await handleProseEditRoute(new Request(url, { method: "GET" }), url)
    // GET on a matching path returns 405, not null — the matcher fires first.
    expect(res).not.toBeNull()
    expect(res!.status).toBe(405)
  })

  test("unknown path returns null", async () => {
    const res = await invoke("POST", "/api/novel/x/something-else")
    expect(res).toBeNull()
  })
})

describe.skipIf(!reachable)("handleProseEditRoute (DB-backed)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-prose-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("approved span edit: live hash matches → apply persists new draft + flips envelope", async () => {
    const initialProse = "She paused at the threshold, mindful of the lock."
    await saveChapterDraft(novelId, 1, initialProse, initialProse.split(/\s+/).length)
    const liveHash = computeProseHash(initialProse)

    const envelope = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, // "paused"
      replacement: "halted",
      draftHash: liveHash,
    })
    await insertProseEditEnvelope(envelope)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved", operatorNote: "tightening pacing",
      }),
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.envelopeId).toBe(envelope.id)
    expect(body.status).toBe("approved")
    expect(body.newDraftVersion).toBe(2)
    const expectedProse = "She halted at the threshold, mindful of the lock."
    expect(body.newDraftHash).toBe(computeProseHash(expectedProse))

    const latest = await getLatestChapterDraft(novelId, 1)
    expect(latest).not.toBeNull()
    expect(latest!.prose).toBe(expectedProse)
    expect(latest!.version).toBe(2)

    const persisted = await findEnvelopeById(envelope.id)
    expect(persisted!.status).toBe("approved")
    expect(persisted!.resolved_note).toBe("tightening pacing")

    const outcome = await findProposalResolutionOutcome("proposal_envelopes", envelope.id)
    expect(outcome).toMatchObject({
      proposalId: envelope.id,
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      downstreamEditChurn: 1,
      downstreamCheckerFired: null,
      downstreamCanonConflict: null,
      metadata: {
        observer: "prose-edit-resolve-route",
        outcome: "approved",
        chapter: 1,
        targetKind: "span",
      },
    })

    const impact = await findProposalResolutionImpact("proposal_envelopes", envelope.id)
    expect(impact).toMatchObject({
      proposalId: envelope.id,
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      targetKind: "draft",
      targetRef: "chapter:1",
      chapterNumber: 1,
      priorHash: liveHash,
      resultHash: computeProseHash(expectedProse),
      resultVersion: "chapter:1:draft:v2",
      metadata: {
        observer: "prose-edit-resolve-route",
        targetKind: "span",
      },
    })
  })

  test("approved span edit: stale precondition → 409 + actualHash, no draft writes", async () => {
    const initialProse = "She paused at the threshold."
    await saveChapterDraft(novelId, 1, initialProse, initialProse.split(/\s+/).length)
    const staleHash = "0".repeat(64) // not the live hash

    const envelope = buildSpanEnvelope({
      novelId, chapter: 1, start: 0, end: 5,
      replacement: "He",
      draftHash: staleHash,
    })
    await insertProseEditEnvelope(envelope)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved",
      }),
    )
    expect(status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("stale draft hash")
    expect(body.expectedHash).toBe(staleHash)
    expect(body.actualHash).toBe(computeProseHash(initialProse))

    // Original draft preserved; envelope still pending.
    const latest = await getLatestChapterDraft(novelId, 1)
    expect(latest!.version).toBe(1)
    expect(latest!.prose).toBe(initialProse)
    const persisted = await findEnvelopeById(envelope.id)
    expect(persisted!.status).toBe("pending")
  })

  test("rejected: persists status, no draft work, even with stale hash", async () => {
    const initialProse = "She paused."
    await saveChapterDraft(novelId, 1, initialProse, 2)
    const envelope = buildSpanEnvelope({
      novelId, chapter: 1, start: 0, end: 3,
      replacement: "He",
      draftHash: "0".repeat(64), // stale hash is fine on reject; precondition not checked.
    })
    await insertProseEditEnvelope(envelope)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "rejected", operatorNote: "wrong direction",
      }),
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("rejected")

    const latest = await getLatestChapterDraft(novelId, 1)
    expect(latest!.version).toBe(1) // no new draft
    const persisted = await findEnvelopeById(envelope.id)
    expect(persisted!.status).toBe("rejected")
    expect(persisted!.resolved_note).toBe("wrong direction")

    const outcome = await findProposalResolutionOutcome("proposal_envelopes", envelope.id)
    expect(outcome).toMatchObject({
      proposalId: envelope.id,
      proposalKind: "prose_edit",
      novelId,
      downstreamEditChurn: 0,
      downstreamCheckerFired: null,
      downstreamCanonConflict: null,
      metadata: {
        observer: "prose-edit-resolve-route",
        outcome: "rejected",
      },
    })
  })

  test("missing draft → 404", async () => {
    const envelope = buildSpanEnvelope({
      novelId, chapter: 7, start: 0, end: 5,
      replacement: "x",
      draftHash: "0".repeat(64),
    })
    await insertProseEditEnvelope(envelope)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved",
      }),
    )
    expect(status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("draft not found")
    expect(body.chapter).toBe(7)
  })

  test("beat target → 422 (unsupported in v1)", async () => {
    const initialProse = "x"
    await saveChapterDraft(novelId, 1, initialProse, 1)
    // Build a beat-target proposal — the schema accepts it but the route refuses.
    const proposal: ProseEditProposal = {
      draftVersion: "chapter:1:draft:v1",
      target: { kind: "beat", chapterRef: "chapter:1", beatRef: "b3" },
      replacement: "Whole new beat text",
      rationale: "test",
    }
    const envelope = buildProseEditEnvelope({
      novelId,
      proposal,
      proposalIndex: 0,
      agent: "test",
      draftHash: computeProseHash(initialProse),
      rationale: "test",
      now: fixedNow,
    })
    await insertProseEditEnvelope(envelope)
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved",
      }),
    )
    expect(status).toBe(422)
    expect(body.error).toContain("unsupported target kind")
    expect(body.targetKind).toBe("beat")

    const persisted = await findEnvelopeById(envelope.id)
    expect(persisted!.status).toBe("pending") // unchanged
  })

  test("span out of range → 422", async () => {
    const initialProse = "short"
    await saveChapterDraft(novelId, 1, initialProse, 1)
    const liveHash = computeProseHash(initialProse)
    const envelope = buildSpanEnvelope({
      novelId, chapter: 1, start: 0, end: 999, // way past prose.length
      replacement: "x",
      draftHash: liveHash,
    })
    await insertProseEditEnvelope(envelope)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved",
      }),
    )
    expect(status).toBe(422)
    expect(body.error).toBe("span out of range")
    // Envelope stays pending — the 422 means the envelope is malformed, but
    // we did NOT write a draft. The caller should fix it and re-propose.
    const persisted = await findEnvelopeById(envelope.id)
    expect(persisted!.status).toBe("pending")
  })

  test("body shape: novelId mismatch → 400", async () => {
    const envelope = buildSpanEnvelope({
      novelId: "different-novel", chapter: 1, start: 0, end: 1,
      replacement: "x",
      draftHash: "0".repeat(64),
    })
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "approved",
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toContain("novelId in path does not match")
  })

  test("body shape: missing envelope → 400", async () => {
    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        status: "approved",
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid body")
  })

  test("body shape: invalid JSON → 400", async () => {
    const url = new URL(`http://localhost/api/novel/${novelId}/prose-edits/resolve`)
    const req = new Request(url, {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    })
    const res = await handleProseEditRoute(req, url)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toBe("invalid JSON")
  })

  test("alreadyResolved: pre-resolve race surfaces 409 + actualStatus", async () => {
    const initialProse = "She paused at the threshold."
    await saveChapterDraft(novelId, 1, initialProse, 4)
    const liveHash = computeProseHash(initialProse)
    const envelope = buildSpanEnvelope({
      novelId, chapter: 1, start: 0, end: 5,
      replacement: "He",
      draftHash: liveHash,
    })
    await insertProseEditEnvelope(envelope)
    // Externally rejected before our resolve fires.
    await db`UPDATE proposal_envelopes SET status = 'rejected'
             WHERE id = ${envelope.id}`

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope, status: "rejected",
      }),
    )
    expect(status).toBe(409)
    expect(body.error).toContain("already resolved")
    expect(body.actualStatus).toBe("rejected")
  })

  // ── Phase 6 commit 3: ApprovalPolicy persistence on prose_edit resolve ──
  // Mirrors the artifact_patch route's policy persistence (Phase 6 commit 2).
  // Default manual policy applies when no `policy` is in the request body;
  // operator's status still drives the apply.

  test("Phase 6: default manual policy persists decision=queue/manual-v1 on approve", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, replacement: "halted", draftHash,
    })
    await insertProseEditEnvelope(env)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope: env,
        status: "approved",
      }),
    )
    expect(status).toBe(200)
    expect(body.policy).toEqual({ decision: "queue", version: "manual-v1" })

    const rows = (await db`SELECT resolution_policy_decision, resolution_policy_version, resolution_policy_reasons
                           FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      resolution_policy_decision: string
      resolution_policy_version: string
      resolution_policy_reasons: string[] | string
    }>
    expect(rows[0].resolution_policy_decision).toBe("queue")
    expect(rows[0].resolution_policy_version).toBe("manual-v1")
    const reasons = typeof rows[0].resolution_policy_reasons === "string"
      ? JSON.parse(rows[0].resolution_policy_reasons)
      : rows[0].resolution_policy_reasons
    expect(reasons.join(" ")).toContain("manual")
  })

  test("Phase 6: assisted-mode mechanical prose_edit evaluates approve", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    // buildSpanEnvelope uses buildProseEditEnvelope's conservative default
    // risk=medium. Deterministic lint producers mark their own envelopes
    // mechanical; this unit-local fixture overrides risk to exercise the
    // assisted-mode mechanical path without invoking the lint converter.
    const env = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, replacement: "halted", draftHash,
    })
    const mechanicalEnv = { ...env, risk: "mechanical" as const }
    await insertProseEditEnvelope(mechanicalEnv)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope: mechanicalEnv,
        status: "approved",
        policy: { version: "assisted-v1", mode: "assisted" },
      }),
    )
    expect(status).toBe(200)
    expect(body.policy).toEqual({ decision: "approve", version: "assisted-v1" })

    const rows = (await db`SELECT resolution_policy_decision FROM proposal_envelopes WHERE id = ${mechanicalEnv.id}`) as Array<{
      resolution_policy_decision: string
    }>
    expect(rows[0].resolution_policy_decision).toBe("approve")
  })

  test("Phase 6: rejected resolve also persists policy evaluation", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, replacement: "halted", draftHash,
    })
    await insertProseEditEnvelope(env)

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope: env,
        status: "rejected",
        policy: { version: "auto-v9", mode: "autonomous" },
      }),
    )
    expect(status).toBe(200)
    // env.risk = "medium" (default for prose_edit per classifyEditRisk);
    // autonomous default ceiling = "low" → queue.
    expect(body.policy).toEqual({ decision: "queue", version: "auto-v9" })

    const rows = (await db`SELECT resolution_policy_decision, resolution_policy_version, status
                           FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      resolution_policy_decision: string
      resolution_policy_version: string
      status: string
    }>
    expect(rows[0].status).toBe("rejected")
    expect(rows[0].resolution_policy_decision).toBe("queue")
    expect(rows[0].resolution_policy_version).toBe("auto-v9")
  })

  test("Phase 6: producer reject without reasons does not crash policy evaluation", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, replacement: "halted", draftHash,
    })
    await insertProseEditEnvelope(env)
    const legacyEnvelope = {
      ...env,
      policyRecommendation: { decision: "reject" },
    }

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope: legacyEnvelope,
        status: "rejected",
        policy: { version: "auto-v10", mode: "autonomous" },
      }),
    )
    expect(status).toBe(200)
    expect(body.policy).toEqual({ decision: "reject", version: "auto-v10" })

    const rows = (await db`SELECT resolution_policy_decision, resolution_policy_reasons
                           FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      resolution_policy_decision: string
      resolution_policy_reasons: string[] | string
    }>
    expect(rows[0].resolution_policy_decision).toBe("reject")
    const reasons = typeof rows[0].resolution_policy_reasons === "string"
      ? JSON.parse(rows[0].resolution_policy_reasons)
      : rows[0].resolution_policy_reasons
    expect(reasons).toEqual(["producer recommended reject"])
  })

  test("Phase 6: invalid policy.mode in body returns 400", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanEnvelope({
      novelId, chapter: 1, start: 4, end: 10, replacement: "halted", draftHash,
    })

    const { status, body } = await expectJson(
      await invoke("POST", `/api/novel/${novelId}/prose-edits/resolve`, {
        envelope: env,
        status: "approved",
        policy: { version: "x", mode: "free-for-all" },
      }),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid body")
  })

  test("computeProseHash is deterministic + bytewise sensitive", () => {
    const a = "She paused at the threshold."
    const b = "She halted at the threshold." // 1-word swap
    expect(computeProseHash(a)).toBe(computeProseHash(a))
    expect(computeProseHash(a)).not.toBe(computeProseHash(b))
    expect(computeProseHash(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})
