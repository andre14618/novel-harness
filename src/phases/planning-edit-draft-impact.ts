import { createHash } from "node:crypto"
import { recordProposalResolutionImpact } from "../db/proposal-resolution-outcomes"
import { listPlanningEditMutationLineageForChapter } from "../db/planning-mutation-lineage"

export interface RecordPlanningEditDraftImpactsArgs {
  novelId: string
  chapterNumber: number
  prose: string
  draftVersion: number
}

export async function recordPlanningEditDraftImpactsForChapter(
  args: RecordPlanningEditDraftImpactsArgs,
): Promise<{ recorded: number; proposalIds: string[]; resultHash: string }> {
  const resultHash = proseHash(args.prose)
  const lineages = await listPlanningEditMutationLineageForChapter(args.novelId, args.chapterNumber)
  const byProposal = new Map<string, typeof lineages>()
  for (const lineage of lineages) {
    const rows = byProposal.get(lineage.proposalId) ?? []
    rows.push(lineage)
    byProposal.set(lineage.proposalId, rows)
  }

  for (const [proposalId, rows] of byProposal) {
    const latest = rows[0]!
    await recordProposalResolutionImpact({
      id: `impact:planning-edit-draft:${proposalId}`,
      proposalId,
      proposalKind: "planning_edit",
      novelId: args.novelId,
      sourceTable: "proposal_envelopes",
      targetKind: "draft",
      targetRef: `chapter:${args.chapterNumber}:draft`,
      chapterNumber: args.chapterNumber,
      priorHash: null,
      resultHash,
      resultVersion: `v${args.draftVersion}`,
      resolvedAt: latest.changedAt,
      metadata: {
        observer: "drafting-approval-planning-edit-impact",
        chapterNumber: args.chapterNumber,
        draftVersion: args.draftVersion,
        lineageIds: rows.map((row) => row.id),
      },
    })
  }

  return {
    recorded: byProposal.size,
    proposalIds: [...byProposal.keys()],
    resultHash,
  }
}

function proseHash(prose: string): string {
  return createHash("sha256").update(prose, "utf8").digest("hex")
}
