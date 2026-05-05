import type { ChapterOutline } from "../types"
import { stableHash } from "../canon/proposal-envelope"
import { normalizeChapterOutlineForPersistence } from "../db/outlines"
import {
  recordPlanningMutationLineage,
  type PlanningMutationAffectedRef,
} from "../db/planning-mutation-lineage"

export type ReviserLineageSource = "plan-check" | "validation"

export interface ReviserAcceptedLineageInput {
  novelId: string
  chapter: number
  attempt: number
  source: ReviserLineageSource
  revisionId?: number | null
  previousOutline: ChapterOutline
  nextOutline: ChapterOutline
  issueCount: number
  changedAt?: string
}

export function buildReviserAcceptedLineage(input: ReviserAcceptedLineageInput) {
  const previousOutline = normalizeChapterOutlineForPersistence(input.previousOutline)
  const nextOutline = normalizeChapterOutlineForPersistence(input.nextOutline)
  const previousVersion = stableHash(previousOutline)
  const nextVersion = stableHash(nextOutline)
  const sourceId = reviserSourceId(input, previousVersion, nextVersion)
  const previousRef = previousOutline.chapterId ?? `chapter:${input.chapter}`
  const nextRef = nextOutline.chapterId ?? previousRef
  const affectedDownstreamRefs = outlineBeatRefs(previousOutline, "previous beat changed by chapter-plan-reviser")
    .concat(outlineBeatRefs(nextOutline, "revised beat produced by chapter-plan-reviser"))

  return {
    id: reviserLineageId(sourceId, previousVersion, nextVersion),
    proposalId: sourceId,
    proposalKind: "planning_edit" as const,
    novelId: input.novelId,
    sourceTable: "chapter_revisions" as const,
    actorKind: "agent",
    actorRef: "chapter-plan-reviser",
    source: `chapter-plan-reviser:${input.source}`,
    targetKind: "chapter_outline",
    previousRef,
    nextRef,
    fieldPath: "outline",
    previousVersion,
    nextVersion,
    changedAt: input.changedAt ?? new Date().toISOString(),
    reason: `chapter-plan-reviser accepted ${input.source} outline replacement`,
    affectedDownstreamRefs,
    metadata: {
      chapter: input.chapter,
      attempt: input.attempt,
      source: input.source,
      revisionId: input.revisionId ?? null,
      issueCount: input.issueCount,
      previousBeatIds: beatIds(previousOutline),
      nextBeatIds: beatIds(nextOutline),
    },
  }
}

export async function recordReviserAcceptedLineage(
  input: ReviserAcceptedLineageInput,
): Promise<void> {
  await recordPlanningMutationLineage(buildReviserAcceptedLineage(input))
}

function reviserSourceId(
  input: ReviserAcceptedLineageInput,
  previousVersion: string,
  nextVersion: string,
): string {
  if (typeof input.revisionId === "number" && input.revisionId > 0) {
    return String(input.revisionId)
  }
  return `chapter-reviser:${stableHash({
    novelId: input.novelId,
    chapter: input.chapter,
    attempt: input.attempt,
    source: input.source,
    previousVersion,
    nextVersion,
  }).slice(0, 16)}`
}

function reviserLineageId(
  sourceId: string,
  previousVersion: string,
  nextVersion: string,
): string {
  return `lineage:chapter-reviser:${stableHash({
    sourceId,
    fieldPath: "outline",
    previousVersion,
    nextVersion,
  }).slice(0, 16)}`
}

function outlineBeatRefs(outline: ChapterOutline, reason: string): PlanningMutationAffectedRef[] {
  return (outline.scenes ?? [])
    .map((beat) => beat.beatId)
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
    .map((ref) => ({ kind: "beat_plan", ref, reason }))
}

function beatIds(outline: ChapterOutline): string[] {
  return (outline.scenes ?? [])
    .map((beat) => beat.beatId)
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
}
