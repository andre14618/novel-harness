import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { dbReachable } from "./test-helpers"
import {
  deleteProposalCheckerObservationsForNovel,
  deleteProposalResolutionImpactsForNovel,
  deleteProposalResolutionOutcomesForNovel,
  findDraftProposalResolutionImpactsByResultHash,
  findProposalResolutionImpact,
  findProposalResolutionOutcome,
  listCheckerObservationsForDraftHash,
  recordDraftCheckerObservationForHash,
  recordProposalResolutionImpact,
  recordProposalResolutionOutcome,
} from "./proposal-resolution-outcomes"

const reachable = await dbReachable()
const novelId = `test-proposal-resolution-outcomes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function clean(): Promise<void> {
  await deleteProposalCheckerObservationsForNovel(novelId)
  await deleteProposalResolutionImpactsForNovel(novelId)
  await deleteProposalResolutionOutcomesForNovel(novelId)
}

describe.skipIf(!reachable)("proposal resolution outcomes", () => {
  beforeEach(clean)
  afterEach(clean)

  test("records and upserts downstream observations by source proposal", async () => {
    await recordProposalResolutionOutcome({
      id: "outcome-1",
      proposalId: "proposal-1",
      proposalKind: "artifact_patch",
      novelId,
      sourceTable: "proposal_envelopes",
      resolvedAt: "2026-05-04T12:00:00.000Z",
      observedAt: "2026-05-04T12:10:00.000Z",
      downstreamCheckerFired: false,
      downstreamEditChurn: 1,
      downstreamCanonConflict: false,
      notes: "initial observation",
      metadata: { source: "test" },
    })
    await recordProposalResolutionOutcome({
      id: "outcome-1-replacement-id-is-ignored",
      proposalId: "proposal-1",
      proposalKind: "artifact_patch",
      novelId,
      sourceTable: "proposal_envelopes",
      resolvedAt: "2026-05-04T12:00:00.000Z",
      observedAt: "2026-05-04T12:15:00.000Z",
      downstreamCheckerFired: true,
      downstreamEditChurn: 2,
      downstreamCanonConflict: true,
      notes: "updated observation",
      metadata: { source: "test", updated: true },
    })

    const outcome = await findProposalResolutionOutcome("proposal_envelopes", "proposal-1")

    expect(outcome).toMatchObject({
      id: "outcome-1",
      proposalId: "proposal-1",
      proposalKind: "artifact_patch",
      novelId,
      sourceTable: "proposal_envelopes",
      downstreamCheckerFired: true,
      downstreamEditChurn: 2,
      downstreamCanonConflict: true,
      notes: "updated observation",
      metadata: { source: "test", updated: true },
    })
  })

  test("records draft impact contexts for exact checker correlation", async () => {
    await recordProposalResolutionImpact({
      id: "impact-1",
      proposalId: "proposal-1",
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      targetKind: "draft",
      targetRef: "chapter:2",
      chapterNumber: 2,
      priorHash: "a".repeat(64),
      resultHash: "b".repeat(64),
      resultVersion: "chapter:2:draft:v4",
      resolvedAt: "2026-05-04T12:00:00.000Z",
      metadata: { source: "test" },
    })

    const impact = await findProposalResolutionImpact("proposal_envelopes", "proposal-1")
    expect(impact).toMatchObject({
      id: "impact-1",
      proposalId: "proposal-1",
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      targetKind: "draft",
      targetRef: "chapter:2",
      chapterNumber: 2,
      priorHash: "a".repeat(64),
      resultHash: "b".repeat(64),
      resultVersion: "chapter:2:draft:v4",
      metadata: { source: "test" },
    })

    const matches = await findDraftProposalResolutionImpactsByResultHash(
      novelId,
      2,
      "b".repeat(64),
    )
    expect(matches.map((m) => m.proposalId)).toEqual(["proposal-1"])
  })

  test("checker observations match draft impact hash and roll up outcome fire state", async () => {
    await recordProposalResolutionOutcome({
      id: "outcome-1",
      proposalId: "proposal-1",
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      resolvedAt: "2026-05-04T12:00:00.000Z",
      observedAt: "2026-05-04T12:00:00.000Z",
      downstreamEditChurn: 1,
      metadata: { source: "test" },
    })
    await recordProposalResolutionImpact({
      id: "impact-1",
      proposalId: "proposal-1",
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      targetKind: "draft",
      targetRef: "chapter:2",
      chapterNumber: 2,
      priorHash: "a".repeat(64),
      resultHash: "b".repeat(64),
      resultVersion: "chapter:2:draft:v4",
      resolvedAt: "2026-05-04T12:00:00.000Z",
    })

    const observations = await recordDraftCheckerObservationForHash({
      novelId,
      chapterNumber: 2,
      resultHash: "b".repeat(64),
      checkerName: "validation-check",
      fired: true,
      observedAt: "2026-05-04T12:05:00.000Z",
      details: { blockers: ["POV missing"] },
    })

    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      proposalId: "proposal-1",
      checkerName: "validation-check",
      fired: true,
      details: { blockers: ["POV missing"] },
    })
    expect(
      await listCheckerObservationsForDraftHash(novelId, 2, "b".repeat(64)),
    ).toHaveLength(1)

    const outcome = await findProposalResolutionOutcome("proposal_envelopes", "proposal-1")
    expect(outcome!.downstreamCheckerFired).toBe(true)
    expect(outcome!.downstreamEditChurn).toBe(1)
  })
})
