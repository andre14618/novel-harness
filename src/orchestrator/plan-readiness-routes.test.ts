import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import db, { migrate } from "../db/connection"
import { createNovel } from "../db/novels"
import { getChapterOutline, saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { deletePlanReadinessItemsForNovel } from "../db/plan-readiness"
import { deleteEnvelopesForNovel, listPlanningEditEnvelopes } from "../db/proposal-envelopes"
import { deletePlanningMutationLineageForNovel } from "../db/planning-mutation-lineage"
import { handlePlanReadinessRoute } from "./plan-readiness-routes"
import { handlePlanningProposalRoute } from "./planning-proposal-routes"
import type { ChapterOutline, SceneBeat } from "../types"

const reachable = await dbReachable()

async function invoke(method: string, path: string, body?: unknown): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return handlePlanReadinessRoute(new Request(url, init), url)
}

async function expectJson(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

async function resolvePlanningProposal(
  novelId: string,
  envelopeId: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const url = new URL(`http://localhost/api/novel/${novelId}/planning-proposals/${envelopeId}/resolve`)
  const res = await handlePlanningProposalRoute(
    new Request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    url,
  )
  return expectJson(res)
}

describe("handlePlanReadinessRoute - validation", () => {
  test("unknown path returns null", async () => {
    expect(await invoke("GET", "/api/novel/x/not-plan-readiness")).toBeNull()
  })

  test("DELETE on plan-readiness returns method not allowed", async () => {
    const res = await invoke("DELETE", "/api/novel/x/plan-readiness")
    expect(res?.status).toBe(405)
  })

  test("invalid disposition shape is rejected before DB lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing/plan-readiness/item-1/disposition",
      { status: "proposal_created" },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.issues).toContainEqual({
      path: "proposalEnvelopeId",
      message: "proposalEnvelopeId is required when status === \"proposal_created\"",
    })
  })

  test("create-planning-proposal requires proposedValue before DB lookup", async () => {
    const { status, body } = await expectJson(await invoke(
      "POST",
      "/api/novel/missing/plan-readiness/item-1/create-planning-proposal",
      { operatorNote: "needs revision" },
    ))

    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("proposedValue is required")
  })
})

describe.skipIf(!reachable)("handlePlanReadinessRoute (DB-backed)", () => {
  let novelId: string

  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    novelId = `test-plan-readiness-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A trial exposes an oath road.",
      genre: "fantasy",
      characters: [],
    })
    await saveChapterOutline(novelId, outline())
  })

  afterEach(async () => {
    await deletePlanningMutationLineageForNovel(novelId)
    await deletePlanReadinessItemsForNovel(novelId)
    await deleteEnvelopesForNovel(novelId)
    await db`DELETE FROM chapter_outlines WHERE novel_id = ${novelId}`
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("imports aggregate findings, lists them, and records operator disposition", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: aggregate(),
        importedByKind: "test",
        importedByRef: "route-test",
      },
    ))

    expect(imported.status).toBe(200)
    expect(imported.body.ok).toBe(true)
    expect(imported.body.inserted).toBe(1)
    expect(imported.body.items[0].sourceHashKind).toBe("target_current_version")
    expect(imported.body.items[0].target.ref).toBe("beat-route-1")

    const list = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/plan-readiness?status=open`,
    ))
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)

    const itemId = list.body.items[0].id
    const disposition = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/disposition`,
      {
        status: "not_applicable",
        operatorNote: "This is not a relationship scene.",
      },
    ))
    expect(disposition.status).toBe(200)
    expect(disposition.body.item.status).toBe("not_applicable")
    expect(disposition.body.item.operatorDisposition).toBe("not_applicable")
  })

  test("creates a manual planning_edit proposal from an open readiness item", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: aggregate(),
        importedByKind: "test",
        importedByRef: "route-test",
      },
    ))
    const itemId = imported.body.items[0].id

    const created = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/create-planning-proposal`,
      {
        proposedValue: "Istra forces Vey to swear on the oath road, shifting their leverage before the trial ends.",
        operatorNote: "Make the relationship pressure material before drafting.",
      },
    ))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.readinessItem.status).toBe("proposal_created")
    expect(created.body.readinessItem.operatorDisposition).toBe("real_issue")
    expect(created.body.readinessItem.proposalEnvelopeId).toBe(created.body.proposal.envelope.id)
    expect(created.body.proposal.envelope.kind).toBe("planning_edit")
    expect(created.body.proposal.envelope.source.agent).toBe("plan-readiness-review")
    expect(created.body.proposal.envelope.evidence.some((e: any) =>
      e.ref === `plan_readiness_items:${itemId}`
    )).toBe(true)

    const pending = await listPlanningEditEnvelopes(novelId)
    expect(pending.map(envelope => envelope.id)).toContain(created.body.proposal.envelope.id)
  })

  test("creates a remove-requirement planning_edit proposal from a readiness item", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: aggregate(),
        importedByKind: "test",
        importedByRef: "route-test",
      },
    ))
    const itemId = imported.body.items[0].id

    const created = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/create-planning-proposal`,
      {
        action: "beat_requirement_remove",
        proposedValue: {
          requiredCharacterIds: ["char-istra"],
          requiredWorldFactIds: ["world-oath-road"],
        },
        operatorNote: "Vey is present but should not be required for this beat.",
      },
    ))

    expect(created.status).toBe(200)
    expect(created.body.ok).toBe(true)
    expect(created.body.proposal.envelope.payload.action).toBe("beat_requirement_remove")
    expect(created.body.proposal.envelope.target).toMatchObject({
      kind: "scene_plan",
      ref: "beat-route-1",
      fieldPath: "requirements",
    })
    expect(created.body.proposal.diff.before.value.requiredCharacterIds).toEqual(["char-istra", "char-vey"])
    expect(created.body.proposal.diff.after.value.requiredCharacterIds).toEqual(["char-istra"])
  })

  test("creates and applies a character-ref field planning_edit from readiness", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: characterRefAggregate("requiredCharacterIds"),
        importedByKind: "test",
        importedByRef: "character-ref-route-test",
      },
    ))
    const itemId = imported.body.items[0].id
    expect(imported.body.items[0].target).toMatchObject({
      kind: "scene_plan",
      ref: "beat-route-1",
      fieldPath: "requiredCharacterIds",
    })

    const created = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/create-planning-proposal`,
      {
        proposedValue: ["char-istra", "char-vey", "char-kael"],
        operatorNote: "Add the local character ref before drafting.",
      },
    ))

    expect(created.status).toBe(200)
    expect(created.body.proposal.envelope.target).toMatchObject({
      kind: "scene_plan",
      ref: "beat-route-1",
      fieldPath: "requiredCharacterIds",
    })
    expect(created.body.proposal.diff.before.value).toEqual(["char-istra", "char-vey"])
    expect(created.body.proposal.diff.after.value).toEqual(["char-istra", "char-vey", "char-kael"])

    const approved = await resolvePlanningProposal(novelId, created.body.proposal.envelope.id, {
      status: "approved",
      resolvedBy: "test",
      operatorNote: "Approve character ref bridge test.",
    })
    expect(approved.status).toBe(200)

    const saved = await getChapterOutline(novelId, 1)
    expect((saved.scenes![0] as any).requiredCharacterIds).toEqual([
      "char-istra",
      "char-vey",
      "char-kael",
    ])
  })

  test("does not create a proposal when the readiness target is stale", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: aggregate(),
        importedByKind: "test",
        importedByRef: "route-test",
      },
    ))
    const itemId = imported.body.items[0].id

    await saveChapterOutline(novelId, outline("Istra and Vey already changed the road testimony."))

    const stale = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/create-planning-proposal`,
      {
        proposedValue: "A now-stale proposed replacement.",
        operatorNote: "Should not apply to old target hash.",
      },
    ))

    expect(stale.status).toBe(409)
    expect(stale.body.ok).toBe(false)
    expect(stale.body.error).toBe("stale-readiness-item")
    const staleList = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/plan-readiness?status=stale`,
    ))
    expect(staleList.body.items.map((item: any) => item.id)).toContain(itemId)
    expect(await listPlanningEditEnvelopes(novelId)).toHaveLength(0)
  })

  test("outcome report links readiness items to proposal resolution and planning lineage", async () => {
    const imported = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/import`,
      {
        aggregate: aggregate(),
        importedByKind: "test",
        importedByRef: "route-test",
      },
    ))
    const itemId = imported.body.items[0].id
    const created = await expectJson(await invoke(
      "POST",
      `/api/novel/${novelId}/plan-readiness/${itemId}/create-planning-proposal`,
      {
        proposedValue: "Istra forces Vey to swear on the oath road, shifting their leverage before the trial ends.",
        operatorNote: "Make the relationship pressure material before drafting.",
      },
    ))
    const envelopeId = created.body.proposal.envelope.id

    const pendingReport = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/plan-readiness/outcomes`,
    ))
    expect(pendingReport.status).toBe(200)
    expect(pendingReport.body.summary.linkedProposalCount).toBe(1)
    expect(pendingReport.body.summary.byProposalStatus.pending).toBe(1)
    expect(pendingReport.body.items[0].downstream.interpretation).toBe("pending_operator_resolution")

    const approved = await resolvePlanningProposal(novelId, envelopeId, {
      status: "approved",
      resolvedBy: "test",
      operatorNote: "Approve readiness bridge test.",
    })
    expect(approved.status).toBe(200)
    expect(approved.body.ok).toBe(true)

    const report = await expectJson(await invoke(
      "GET",
      `/api/novel/${novelId}/plan-readiness/outcomes`,
    ))
    expect(report.status).toBe(200)
    expect(report.body.summary.appliedProposalCount).toBe(1)
    expect(report.body.summary.planningLineageRecordedCount).toBe(1)
    expect(report.body.summary.needsDownstreamObservationCount).toBe(1)
    expect(report.body.summary.downstreamObservedCount).toBe(0)
    expect(report.body.items).toHaveLength(1)
    expect(report.body.items[0].readinessItem.id).toBe(itemId)
    expect(report.body.items[0].proposal.id).toBe(envelopeId)
    expect(report.body.items[0].proposal.status).toBe("approved")
    expect(report.body.items[0].downstream.observationStatus).toBe("lineage_only")
    expect(report.body.items[0].downstream.interpretation).toBe("applied_no_downstream_observation")
    expect(report.body.items[0].downstream.planningLineage[0].proposalId).toBe(envelopeId)
  })
})

function outline(beatDescription = "Istra faces Vey but the oath road does not change the choice."): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-route-1",
    title: "Oath Trial",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "Trial road",
    purpose: "Show the oath road law.",
    targetWords: 600,
    charactersPresent: ["Istra", "Vey"],
    charactersPresentIds: ["char-istra", "char-vey"],
    scenes: [beat(beatDescription)],
    establishedFacts: [],
  } as unknown as ChapterOutline
}

function beat(description: string): SceneBeat {
  return {
    beatId: "beat-route-1",
    kind: "dialogue",
    description,
    characters: ["Istra", "Vey"],
    requiredCharacterIds: ["char-istra", "char-vey"],
    requiredWorldFactIds: ["world-oath-road"],
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
  } as unknown as SceneBeat
}

function aggregate() {
  return {
    sourceReports: ["/tmp/report.json"],
    groups: [
      {
        groupId: "001",
        fixtureId: "route-fixture",
        armId: "test:method",
        methodPackEnabled: true,
        unitType: "scene",
        chapterId: "ch-route-1",
        sceneId: "beat-route-1",
        sourceIds: {
          obligationIds: ["obl-route-1"],
          characterIds: ["char-istra", "char-vey"],
          worldFactIds: ["world-oath-road"],
        },
        rewritePacket: {
          preserveIds: {
            obligationIds: ["obl-route-1"],
            characterIds: ["char-istra", "char-vey"],
            worldFactIds: ["world-oath-road"],
            sceneTurnIds: ["turn-route-choice"],
            threadIds: ["thread-route"],
            promiseIds: ["debt-route"],
            payoffIds: ["payoff-route"],
          },
          proposalCandidate: {
            target: {
              kind: "scene_plan",
              ref: "beat-route-1",
              fieldPath: "description",
            },
          },
        },
        findings: [
          {
            findingId: "001.1",
            sourceReport: "/tmp/report.json",
            promptMode: "evidence-first",
            dimension: "relationshipDelta",
            label: "REL-1",
            severity: "medium",
            fixIntent: "add_relationship_delta_or_mark_not_relationship_scene",
            rationale: "relationship-applicable scene appears static",
            missingForNextLevel: "change trust, leverage, debt, or power",
            evidence: { relationship: "Istra and Vey" },
          },
        ],
        excerpt: "Scene: beat-route-1",
      },
    ],
  }
}

function characterRefAggregate(fieldPath: "requiredCharacterIds" | "affectedCharacterIds") {
  return {
    sourceReports: ["/tmp/character-context.json"],
    labels: ["CHARACTERREF-1"],
    groups: [
      {
        groupId: "001",
        fixtureId: "route-fixture",
        armId: "corpus-recreation:exact-id-scene",
        methodPackEnabled: false,
        unitType: "scene",
        chapterId: "ch-route-1",
        sceneId: "beat-route-1",
        sourceIds: {
          obligationIds: ["obl-route-1"],
          characterIds: ["char-istra", "char-vey", "char-kael"],
          worldFactIds: ["world-oath-road"],
          sceneTurnIds: ["turn-route-choice"],
          threadIds: ["thread-route"],
          promiseIds: ["debt-route"],
          payoffIds: ["payoff-route"],
          sourceIds: ["char-istra", "char-vey", "char-kael"],
        },
        rewritePacket: {
          preserveIds: {
            obligationIds: ["obl-route-1"],
            characterIds: ["char-istra", "char-vey", "char-kael"],
            worldFactIds: ["world-oath-road"],
            sceneTurnIds: ["turn-route-choice"],
            threadIds: ["thread-route"],
            promiseIds: ["debt-route"],
            payoffIds: ["payoff-route"],
            sourceIds: ["char-istra", "char-vey", "char-kael"],
          },
          proposalCandidate: {
            action: "field_replace",
            target: {
              kind: "scene_plan",
              ref: "beat-route-1",
              fieldPath,
            },
          },
        },
        findings: [
          {
            findingId: "001.1",
            sourceReport: "/tmp/character-context.json",
            promptMode: "deterministic-character-ref-repair",
            dimension: "characterRefClosure",
            label: "CHARACTERREF-1",
            severity: "medium",
            fixIntent: "close_character_context_refs",
            rationale: "The scene names char-kael but the durable character refs are incomplete.",
            missingForNextLevel: "add char-kael to the correct character ref field",
            evidence: { characterIdsToAdd: "char-kael", fieldPath },
          },
        ],
        excerpt: "character char-kael is named in scene contract but missing requiredCharacterIds/source obligation",
      },
    ],
  }
}
