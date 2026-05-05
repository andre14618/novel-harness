/**
 * Phase 6 commit 5 — autonomous policy-decide endpoint tests.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 6"
 *
 * DB-backed (skipIf-unreachable). Pin the four decisions (queue / shadow /
 * approve / reject) × the two supported kinds (artifact_patch, prose_edit),
 * plus error paths (404 missing, 400 novelId mismatch, 409 already-resolved,
 * 422 unsupported kind).
 *
 * The "approve" path is the load-bearing demonstrability test: an autonomous
 * policy with default ceiling=low fires the apply on a low-risk artifact_patch
 * envelope WITHOUT operator intervention. The audit row carries
 * resolved_by_kind="policy", resolution_policy_decision="approve",
 * resolution_policy_version="auto-v1".
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import { handlePolicyDecideRoute } from "./policy-decide-routes"
import { buildArtifactPatchEnvelope } from "../canon/proposal-envelope"
import { buildProseEditEnvelope } from "../canon/editorial-proposal"
import { computeProseHash } from "./prose-edit-routes"
import { saveChapterDraft } from "../db/drafts"
import {
  insertArtifactPatchEnvelope,
  deleteEnvelopesForNovel,
} from "../db/proposal-envelopes"
import { insertProseEditEnvelope } from "../db/editorial-envelopes"
import type { CharacterProfile, WorldBible, StorySpine } from "../types"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"
import type { ProseEditProposal } from "../canon/editorial-proposal"

const reachable = await dbReachable()
const fixedNow = new Date("2026-05-04T12:00:00.000Z")

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

async function dropNovel(novelId: string): Promise<void> {
  await deleteEnvelopesForNovel(novelId)
  await db`DELETE FROM characters WHERE novel_id = ${novelId}`
  await db`DELETE FROM chapter_drafts WHERE novel_id = ${novelId}`
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

async function buildArtifactPatchEnvelopeFromLive(
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

function buildSpanProseEditEnvelope(args: {
  novelId: string
  chapter: number
  start: number
  end: number
  replacement: string
  draftHash: string
  riskOverride?: "mechanical" | "low" | "medium" | "high"
}) {
  const proposal: ProseEditProposal = {
    draftVersion: `chapter:${args.chapter}:draft:v1`,
    target: { kind: "span", chapterRef: `chapter:${args.chapter}`, start: args.start, end: args.end },
    replacement: args.replacement,
    rationale: "test edit",
  }
  const env = buildProseEditEnvelope({
    novelId: args.novelId,
    proposal,
    proposalIndex: 0,
    agent: "test-policy",
    draftHash: args.draftHash,
    rationale: proposal.rationale,
    now: fixedNow,
  })
  return args.riskOverride ? { ...env, risk: args.riskOverride } : env
}

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  const req = new Request(url, init)
  return handlePolicyDecideRoute(req, url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("handlePolicyDecideRoute — non-matching paths", () => {
  test("GET on policy-decide path returns 405", async () => {
    const url = new URL("http://localhost/api/novel/x/proposal-envelopes/y/policy-decide")
    const res = await handlePolicyDecideRoute(new Request(url, { method: "GET" }), url)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(405)
  })

  test("unrelated path returns null", async () => {
    const res = await invoke("POST", "/api/novel/x/something-else")
    expect(res).toBeNull()
  })
})

describe.skipIf(!reachable)("handlePolicyDecideRoute (artifact_patch)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-policy-decide-ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("autonomous + low-risk: policy decides approve, apply fires, audit row tagged resolved_by=policy", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Find the second key" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    expect(env.risk).toBe("low")
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("approve")
    expect(body.applied).toBe(true)
    expect(body.policy.version).toBe("auto-v1")
    expect(typeof body.newVersion).toBe("string")

    // Live artifact updated.
    const charRows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(charRows[0].profile_json.goals).toBe("Find the second key")

    // Audit trail: resolved_by=policy, status=approved, policy_decision=approve.
    const audit = (await db`SELECT status, resolved_by_kind, resolution_policy_decision, resolution_policy_version
                            FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      status: string
      resolved_by_kind: string
      resolution_policy_decision: string
      resolution_policy_version: string
    }>
    expect(audit[0].status).toBe("approved")
    expect(audit[0].resolved_by_kind).toBe("policy")
    expect(audit[0].resolution_policy_decision).toBe("approve")
    expect(audit[0].resolution_policy_version).toBe("auto-v1")
  }, 15_000)

  test("autonomous + medium-risk: policy decides queue, no mutation", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterRename",
      characterId: "char-hero",
      newName: "Aria the Brave",
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    expect(env.risk).toBe("medium") // characterRename = medium per classifyPatchRisk
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("queue")
    expect(body.mutated).toBe(false)

    // Envelope still pending; live artifact untouched.
    const audit = (await db`SELECT status FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{ status: string }>
    expect(audit[0].status).toBe("pending")
    const charRows = (await db`SELECT name FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { name: string }[]
    expect(charRows[0].name).toBe("Aria") // unchanged
  }, 15_000)

  test("queue decision re-checks envelope pending status right before returning", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterRename",
      characterId: "char-hero",
      newName: "Aria the Brave",
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    let releaseConcurrentResolve!: () => void
    let concurrentResolveStarted!: () => void
    const releaseConcurrentResolvePromise = new Promise<void>((resolve) => {
      releaseConcurrentResolve = resolve
    })
    const concurrentResolveStartedPromise = new Promise<void>((resolve) => {
      concurrentResolveStarted = resolve
    })
    const concurrentResolve = db.begin(async (tx) => {
      await tx`
        UPDATE proposal_envelopes
        SET status = 'approved',
            resolved_at = now(),
            resolved_by_kind = 'human'
        WHERE id = ${env.id}
      `
      concurrentResolveStarted()
      await releaseConcurrentResolvePromise
    })
    await concurrentResolveStartedPromise

    const routeResponse = invoke(
      "POST",
      `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
      { policy: { version: "auto-v1", mode: "autonomous" } },
    )
    await sleep(25)
    releaseConcurrentResolve()
    await concurrentResolve

    const { status, body } = await expectJson(await routeResponse)
    expect(status).toBe(409)
    expect(body.error).toBe("envelope already resolved")
    expect(body.actualStatus).toBe("approved")
  }, 15_000)

  test("manual mode: every kind queues regardless", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "x" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "manual-default", mode: "manual" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("queue")
    expect(body.mutated).toBe(false)
  }, 15_000)

  test("eval mode: shadow recorded, no apply, status=shadowed", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Find the second key" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "eval-v1", mode: "eval" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("shadow")
    expect(body.shadowOf).toBe("approve") // low-risk → would-have-approved in autonomous
    expect(body.mutated).toBe(true)
    expect(body.status).toBe("shadowed")

    // Audit row has status=shadowed, resolved_by=policy.
    const audit = (await db`SELECT status, resolved_by_kind, resolution_policy_decision
                            FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      status: string
      resolved_by_kind: string
      resolution_policy_decision: string
    }>
    expect(audit[0].status).toBe("shadowed")
    expect(audit[0].resolved_by_kind).toBe("policy")
    expect(audit[0].resolution_policy_decision).toBe("shadow")

    // Live artifact untouched (eval mode never mutates).
    const charRows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(charRows[0].profile_json.goals).toBe("Find the key") // unchanged
  }, 15_000)

  test("envelope not found → 404", async () => {
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/no-such-envelope-id/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(404)
    expect(body.error).toContain("not found")
  })

  test("novelId mismatch → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "x" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/some-other-novel/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(400)
    expect(body.error).toContain("does not match")
  })

  test("envelope already resolved → 409 + actualStatus", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "x" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    // First call: approve via policy.
    const first = await invoke(
      "POST",
      `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
      { policy: { version: "auto-v1", mode: "autonomous" } },
    )
    expect(first!.status).toBe(200)

    // Second call: same envelope, now resolved → 409.
    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(409)
    expect(body.actualStatus).toBe("approved")
  }, 15_000)

  test("body shape: missing policy field → 400", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "x" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        {}, // no policy
      ),
    )
    expect(status).toBe(400)
    expect(body.error).toBe("invalid request body")
  })

  test("producer-recommended reject: autonomous policy still rejects (overrides approve path)", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Steal the key" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    // Override producer recommendation to reject.
    const rejectEnv = {
      ...env,
      policyRecommendation: {
        decision: "reject" as const,
        reasons: ["producer says no"],
      },
    }
    await insertArtifactPatchEnvelope(rejectEnv)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${rejectEnv.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("reject")
    expect(body.applied).toBe(false)
    expect(body.mutated).toBe(true)

    const audit = (await db`SELECT status, resolved_by_kind FROM proposal_envelopes WHERE id = ${rejectEnv.id}`) as Array<{
      status: string
      resolved_by_kind: string
    }>
    expect(audit[0].status).toBe("rejected")
    expect(audit[0].resolved_by_kind).toBe("policy")

    // Artifact untouched.
    const charRows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(charRows[0].profile_json.goals).toBe("Find the key")
  }, 15_000)

  test("approve-reject reissue failures keep inner error semantics and do not overlay policy success fields", async () => {
    await seedCharacter(novelId, makeCharacter("char-hero", "Aria"))
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Find the second key" },
    }
    const env = await buildArtifactPatchEnvelopeFromLive(novelId, patch)
    await insertArtifactPatchEnvelope(env)

    const staleProfile = (await db`
      SELECT profile_json FROM characters
      WHERE novel_id = ${novelId} AND id = 'char-hero'
    `) as Array<{ profile_json: CharacterProfile }>
    expect(staleProfile).toHaveLength(1)
    await db`
      UPDATE characters
      SET profile_json = ${{ ...staleProfile[0].profile_json, goals: "already moved on" }}
      WHERE novel_id = ${novelId} AND id = 'char-hero'
    `

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("stale-precondition")
    expect(body.decision).toBeUndefined()
    expect(body.policy).toBeUndefined()
    expect(body.policyEvaluation).toMatchObject({
      decision: "approve",
      version: "auto-v1",
    })

    // No mutation should happen on stale resolve failures.
    const charRows = (await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = 'char-hero'`) as { profile_json: CharacterProfile }[]
    expect(charRows[0].profile_json.goals).toBe("already moved on")
  }, 20_000)
})

describe.skipIf(!reachable)("handlePolicyDecideRoute (prose_edit)", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-policy-decide-pe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await seedNovel(novelId)
  })

  afterEach(async () => {
    await dropNovel(novelId)
  })

  test("assisted + mechanical risk: policy decides approve, span apply fires", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanProseEditEnvelope({
      novelId,
      chapter: 1,
      start: 4,
      end: 10,
      replacement: "halted",
      draftHash,
      riskOverride: "mechanical",
    })
    await insertProseEditEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "assisted-v1", mode: "assisted" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("approve")
    expect(typeof body.newDraftVersion).toBe("number")
    expect(body.policy.version).toBe("assisted-v1")

    const audit = (await db`SELECT status, resolved_by_kind, resolution_policy_decision
                            FROM proposal_envelopes WHERE id = ${env.id}`) as Array<{
      status: string
      resolved_by_kind: string
      resolution_policy_decision: string
    }>
    expect(audit[0].status).toBe("approved")
    expect(audit[0].resolved_by_kind).toBe("policy")
    expect(audit[0].resolution_policy_decision).toBe("approve")
  }, 15_000)

  test("autonomous + default ceiling=low: medium-risk prose_edit queues", async () => {
    const prose = "She paused at the threshold of the laboratory."
    const draftHash = computeProseHash(prose)
    await saveChapterDraft(novelId, 1, prose, prose.split(/\s+/).length)
    const env = buildSpanProseEditEnvelope({
      novelId,
      chapter: 1,
      start: 4,
      end: 10,
      replacement: "halted",
      draftHash,
      // default risk is medium for prose_edit per classifyEditRisk
    })
    expect(env.risk).toBe("medium")
    await insertProseEditEnvelope(env)

    const { status, body } = await expectJson(
      await invoke(
        "POST",
        `/api/novel/${novelId}/proposal-envelopes/${env.id}/policy-decide`,
        { policy: { version: "auto-v1", mode: "autonomous" } },
      ),
    )
    expect(status).toBe(200)
    expect(body.decision).toBe("queue")
    expect(body.mutated).toBe(false)
  }, 15_000)
})
