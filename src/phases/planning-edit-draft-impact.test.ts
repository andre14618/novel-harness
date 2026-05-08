import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import db, { migrate } from "../db/connection"
import { createNovel } from "../db/novels"
import { dbReachable } from "../db/test-helpers"
import {
  deleteProposalCheckerObservationsForNovel,
  deleteProposalResolutionImpactsForNovel,
  findProposalResolutionImpact,
  listProposalCheckerObservationsByProposal,
  recordDraftCheckerObservationForHash,
} from "../db/proposal-resolution-outcomes"
import {
  deletePlanningMutationLineageForNovel,
  recordPlanningMutationLineage,
} from "../db/planning-mutation-lineage"
import { recordPlanningEditDraftImpactsForChapter } from "./planning-edit-draft-impact"

const reachable = await dbReachable()

describe.skipIf(!reachable)("planning edit draft impact capture", () => {
  let novelId: string

  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    novelId = `test-planning-edit-impact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await createNovel(novelId, {
      premise: "A trial exposes an oath road.",
      genre: "fantasy",
      characters: [],
    })
  })

  afterEach(async () => {
    await deleteProposalCheckerObservationsForNovel(novelId)
    await deleteProposalResolutionImpactsForNovel(novelId)
    await deletePlanningMutationLineageForNovel(novelId)
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("records draft impact contexts for planning edits that affected a chapter", async () => {
    await recordPlanningMutationLineage({
      id: `lineage-${novelId}`,
      proposalId: `planning-edit-${novelId}`,
      proposalKind: "planning_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      actorKind: "test",
      source: "plan-readiness-review",
      targetKind: "beat_plan",
      previousRef: "beat-route-1",
      nextRef: "beat-route-1",
      fieldPath: "requirements",
      previousVersion: "old",
      nextVersion: "new",
      changedAt: "2026-05-08T12:00:00.000Z",
      metadata: {
        containingChapterNumber: 1,
        containingChapterId: "ch-route-1",
      },
    })

    const result = await recordPlanningEditDraftImpactsForChapter({
      novelId,
      chapterNumber: 1,
      prose: "Istra makes the oath road matter.",
      draftVersion: 3,
    })

    expect(result.recorded).toBe(1)
    expect(result.proposalIds).toEqual([`planning-edit-${novelId}`])
    const impact = await findProposalResolutionImpact("proposal_envelopes", `planning-edit-${novelId}`)
    expect(impact).toMatchObject({
      proposalId: `planning-edit-${novelId}`,
      proposalKind: "planning_edit",
      targetKind: "draft",
      targetRef: "chapter:1:draft",
      chapterNumber: 1,
      resultVersion: "v3",
    })

    await recordDraftCheckerObservationForHash({
      novelId,
      chapterNumber: 1,
      resultHash: result.resultHash,
      checkerName: "validation-check",
      fired: false,
      observedAt: "2026-05-08T12:02:00.000Z",
      details: { blockers: [] },
    })
    const observations = await listProposalCheckerObservationsByProposal(
      "proposal_envelopes",
      `planning-edit-${novelId}`,
    )
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      proposalKind: "planning_edit",
      checkerName: "validation-check",
      fired: false,
    })
  })
})
