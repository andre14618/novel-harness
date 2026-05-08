import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import db, { migrate } from "../db/connection"
import { createNovel } from "../db/novels"
import { saveChapterOutline } from "../db/outlines"
import { dbReachable } from "../db/test-helpers"
import { deletePlanReadinessItemsForNovel } from "../db/plan-readiness"
import { handlePlanReadinessRoute } from "./plan-readiness-routes"
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
    await deletePlanReadinessItemsForNovel(novelId)
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
})

function outline(): ChapterOutline {
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
    scenes: [beat()],
    establishedFacts: [],
  } as unknown as ChapterOutline
}

function beat(): SceneBeat {
  return {
    beatId: "beat-route-1",
    kind: "dialogue",
    description: "Istra faces Vey but the oath road does not change the choice.",
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
          },
          proposalCandidate: {
            target: {
              kind: "beat_plan",
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
