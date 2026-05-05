import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { dbReachable } from "./test-helpers"
import {
  deletePlanningMutationLineageForNovel,
  findPlanningMutationLineageByProposal,
  listPlanningMutationLineageForRefs,
  recordPlanningMutationLineage,
} from "./planning-mutation-lineage"

const reachable = await dbReachable()
const novelId = `test-planning-lineage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function clean(): Promise<void> {
  await deletePlanningMutationLineageForNovel(novelId)
}

describe.skipIf(!reachable)("planning mutation lineage", () => {
  beforeEach(clean)
  afterEach(clean)

  test("records immutable planning mutation lineage and lists it by old or new ref", async () => {
    const inserted = await recordPlanningMutationLineage({
      id: "lineage-1",
      proposalId: "planning-edit-1",
      proposalKind: "planning_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      actorKind: "human",
      actorRef: "operator-1",
      source: "test",
      targetKind: "chapter_outline",
      previousRef: "ch-001-old",
      nextRef: "ch-001-new",
      fieldPath: "purpose",
      previousVersion: "a".repeat(64),
      nextVersion: "b".repeat(64),
      preconditionKind: "artifact_hash",
      preconditionHash: "a".repeat(64),
      changedAt: "2026-05-04T12:00:00.000Z",
      reason: "test change",
      affectedDownstreamRefs: [{
        kind: "beat_plan",
        ref: "beat-1",
        reason: "chapter references beat",
      }],
      metadata: { previousValue: "old", proposedValue: "new" },
    })
    expect(inserted).toBe(true)
    expect(await recordPlanningMutationLineage({
      id: "lineage-1",
      proposalId: "planning-edit-1",
      proposalKind: "planning_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      actorKind: "human",
      targetKind: "chapter_outline",
      previousRef: "ch-001-old",
      nextRef: "ch-001-new",
      fieldPath: "purpose",
      changedAt: "2026-05-04T12:00:00.000Z",
    })).toBe(false)

    const found = await findPlanningMutationLineageByProposal("planning-edit-1")
    expect(found).toMatchObject({
      id: "lineage-1",
      proposalId: "planning-edit-1",
      proposalKind: "planning_edit",
      actorKind: "human",
      previousRef: "ch-001-old",
      nextRef: "ch-001-new",
      affectedDownstreamRefs: [{ kind: "beat_plan", ref: "beat-1", reason: "chapter references beat" }],
      metadata: { previousValue: "old", proposedValue: "new" },
    })

    expect((await listPlanningMutationLineageForRefs(novelId, ["ch-001-old"]))).toHaveLength(1)
    expect((await listPlanningMutationLineageForRefs(novelId, ["ch-001-new"]))).toHaveLength(1)
  })

  test("records plan-assist lineage sourced from chapter_exhaustions", async () => {
    const inserted = await recordPlanningMutationLineage({
      id: "lineage-plan-assist-1",
      proposalId: "42",
      proposalKind: "planning_edit",
      novelId,
      sourceTable: "chapter_exhaustions",
      actorKind: "human",
      source: "plan-assist:plan-check-exhausted",
      targetKind: "chapter_outline",
      previousRef: "ch-001",
      nextRef: "ch-001",
      fieldPath: "planCheckOverridden",
      previousVersion: "c".repeat(64),
      nextVersion: "d".repeat(64),
      changedAt: "2026-05-05T12:00:00.000Z",
      reason: "operator override",
      metadata: { decision: "override", attempt: 2 },
    })
    expect(inserted).toBe(true)

    const found = await findPlanningMutationLineageByProposal("42", {
      sourceTable: "chapter_exhaustions",
    })
    expect(found).toMatchObject({
      id: "lineage-plan-assist-1",
      proposalId: "42",
      proposalKind: "planning_edit",
      sourceTable: "chapter_exhaustions",
      fieldPath: "planCheckOverridden",
      metadata: { decision: "override", attempt: 2 },
    })
  })

  test("records accepted reviser lineage sourced from chapter_revisions", async () => {
    const inserted = await recordPlanningMutationLineage({
      id: "lineage-reviser-1",
      proposalId: "77",
      proposalKind: "planning_edit",
      novelId,
      sourceTable: "chapter_revisions",
      actorKind: "agent",
      actorRef: "chapter-plan-reviser",
      source: "chapter-plan-reviser:plan-check",
      targetKind: "chapter_outline",
      previousRef: "ch-001",
      nextRef: "ch-001",
      fieldPath: "outline",
      previousVersion: "e".repeat(64),
      nextVersion: "f".repeat(64),
      changedAt: "2026-05-05T12:00:00.000Z",
      reason: "accepted reviser output",
      metadata: { source: "plan-check", revisionId: 77 },
    })
    expect(inserted).toBe(true)

    const found = await findPlanningMutationLineageByProposal("77", {
      sourceTable: "chapter_revisions",
    })
    expect(found).toMatchObject({
      id: "lineage-reviser-1",
      proposalId: "77",
      proposalKind: "planning_edit",
      sourceTable: "chapter_revisions",
      actorKind: "agent",
      actorRef: "chapter-plan-reviser",
      fieldPath: "outline",
      metadata: { source: "plan-check", revisionId: 77 },
    })
  })
})
