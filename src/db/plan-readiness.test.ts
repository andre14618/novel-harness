import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { migrate } from "./connection"
import { dbReachable } from "./test-helpers"
import {
  deletePlanReadinessItemsForNovel,
  listPlanReadinessItems,
  markStalePlanReadinessItems,
  updatePlanReadinessDisposition,
  upsertPlanReadinessItem,
} from "./plan-readiness"
import type { PlanReadinessItemDraft } from "../harness/plan-readiness"

const reachable = await dbReachable()
const novelId = `test-plan-readiness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!reachable)("plan readiness persistence", () => {
  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    await deletePlanReadinessItemsForNovel(novelId)
  })

  afterEach(async () => {
    await deletePlanReadinessItemsForNovel(novelId)
  })

  test("upserts readiness items without resetting operator disposition", async () => {
    const inserted = await upsertPlanReadinessItem(draft())
    expect(inserted.inserted).toBe(true)
    expect(inserted.item.status).toBe("open")
    expect(inserted.item.target.ref).toBe("scn-001-01")

    const disposition = await updatePlanReadinessDisposition({
      id: inserted.item.id,
      novelId,
      status: "accepted_as_is",
      operatorDisposition: "acceptable_choice",
      operatorNote: "Intentional quiet scene.",
      proposalEnvelopeId: null,
    })
    expect(disposition?.status).toBe("accepted_as_is")

    const updated = await upsertPlanReadinessItem({
      ...draft(),
      explanation: "updated judge wording",
    })
    expect(updated.inserted).toBe(false)
    expect(updated.item.explanation).toBe("updated judge wording")
    expect(updated.item.status).toBe("accepted_as_is")
    expect(updated.item.operatorDisposition).toBe("acceptable_choice")
  })

  test("lists by status and records proposal-created dispositions", async () => {
    const first = await upsertPlanReadinessItem(draft({ id: "readiness-a" }))
    await upsertPlanReadinessItem(draft({
      id: "readiness-b",
      diagnosticLabel: "WFACT-1",
      dimension: "worldFactPressure",
    }))

    await updatePlanReadinessDisposition({
      id: first.item.id,
      novelId,
      status: "proposal_created",
      operatorDisposition: "real_issue",
      operatorNote: "Needs a stronger scene contract.",
      proposalEnvelopeId: "planning-edit-1",
    })

    const pending = await listPlanReadinessItems(novelId)
    expect(pending.map(item => item.id)).toEqual(["readiness-b"])

    const proposals = await listPlanReadinessItems(novelId, { status: "proposal_created" })
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.proposalEnvelopeId).toBe("planning-edit-1")
  })

  test("marks open or deferred items stale when target hashes change", async () => {
    await upsertPlanReadinessItem(draft({ id: "readiness-open", sourceHash: "a".repeat(64) }))
    const deferred = await upsertPlanReadinessItem(draft({
      id: "readiness-deferred",
      diagnosticLabel: "WFACT-1",
      dimension: "worldFactPressure",
      sourceHash: "a".repeat(64),
    }))
    await updatePlanReadinessDisposition({
      id: deferred.item.id,
      novelId,
      status: "deferred",
      operatorDisposition: "defer_to_drafting",
      operatorNote: null,
      proposalEnvelopeId: null,
    })

    const stale = await markStalePlanReadinessItems(novelId, [{
      targetKind: "beat_plan",
      targetRef: "scn-001-01",
      sourceHash: "b".repeat(64),
    }])

    expect(stale.staleCount).toBe(2)
    expect((await listPlanReadinessItems(novelId, { status: "stale" }))).toHaveLength(2)
  })
})

function draft(overrides: Partial<PlanReadinessItemDraft> = {}): PlanReadinessItemDraft {
  return {
    id: "readiness-test",
    novelId,
    target: {
      kind: "beat_plan",
      ref: "scn-001-01",
      fieldPath: "description",
    },
    sourceHash: "a".repeat(64),
    sourceHashKind: "target_current_version",
    diagnosticLabel: "MATERIAL-1",
    dimension: "characterMateriality",
    fixIntent: "make_required_character_material_or_remove_requirement",
    severity: "medium",
    explanation: "required character is present but not material",
    missingForNextLevel: "make the character change the outcome",
    preserveIds: {
      obligationIds: ["obl-1"],
      characterIds: ["char-hero", "char-rival"],
      worldFactIds: ["world-oath-road"],
      threadIds: ["thread-main"],
      promiseIds: ["debt-main"],
      payoffIds: ["payoff-main"],
      sourceIds: [],
    },
    evidence: { excerpt: "rival watches" },
    sourceReportPaths: ["/tmp/report.json"],
    importedByKind: "test",
    importedByRef: "db-test",
    metadata: { fixtureId: "fixture" },
    ...overrides,
  }
}
