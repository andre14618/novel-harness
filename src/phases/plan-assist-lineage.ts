import type { ChapterOutline } from "../types"
import type { PlanAssistGatePayload } from "../gates"
import { stableHash } from "../canon/proposal-envelope"
import { normalizeChapterOutlineForPersistence } from "../db/outlines"
import {
  recordPlanningMutationLineage,
  type PlanningMutationAffectedRef,
} from "../db/planning-mutation-lineage"

interface PlanAssistLineageBase {
  novelId: string
  chapter: number
  payload: PlanAssistGatePayload
  exhaustionId?: number | null
  changedAt?: string
}

export interface PlanAssistOutlineLineageInput extends PlanAssistLineageBase {
  previousOutline: ChapterOutline
  nextOutline: ChapterOutline
  reason?: string | null
}

export interface PlanAssistOverrideLineageInput extends PlanAssistLineageBase {
  outline: ChapterOutline
  previousValue: boolean
  nextValue: boolean
  reason?: string | null
}

export function normalizePlanAssistReplacementOutline(
  previousOutline: ChapterOutline,
  replacementOutline: ChapterOutline,
): ChapterOutline {
  const previous = normalizeChapterOutlineForPersistence(previousOutline)
  return normalizeChapterOutlineForPersistence({
    ...previous,
    ...replacementOutline,
    chapterNumber: previous.chapterNumber,
    chapterId: previous.chapterId,
  } as ChapterOutline)
}

export function buildPlanAssistOutlineLineage(input: PlanAssistOutlineLineageInput) {
  const previousOutline = normalizeChapterOutlineForPersistence(input.previousOutline)
  const nextOutline = normalizeChapterOutlineForPersistence(input.nextOutline)
  const previousVersion = stableHash(previousOutline)
  const nextVersion = stableHash(nextOutline)
  const sourceId = planAssistSourceId(input, "edit-plan", previousVersion, nextVersion)
  const changedAt = input.changedAt ?? new Date().toISOString()
  const previousRef = previousOutline.chapterId ?? `chapter:${input.chapter}`
  const nextRef = nextOutline.chapterId ?? previousRef
  const affectedDownstreamRefs = outlineBeatRefs(previousOutline, "previous beat changed by plan-assist outline replacement")
    .concat(outlineBeatRefs(nextOutline, "new beat produced by plan-assist outline replacement"))

  return {
    id: planAssistLineageId(sourceId, "outline", previousVersion, nextVersion),
    proposalId: sourceId,
    proposalKind: "planning_edit" as const,
    novelId: input.novelId,
    sourceTable: "chapter_exhaustions" as const,
    actorKind: "human",
    source: `plan-assist:${input.payload.kind}`,
    targetKind: "chapter_outline",
    previousRef,
    nextRef,
    fieldPath: "outline",
    previousVersion,
    nextVersion,
    changedAt,
    reason: input.reason ?? "operator edited outline at plan-assist gate",
    affectedDownstreamRefs,
    metadata: {
      decision: "edit-plan",
      chapter: input.chapter,
      attempt: input.payload.attempt,
      planAssistKind: input.payload.kind,
      unresolvedDeviationCount: input.payload.unresolvedDeviations.length,
      previousBeatIds: beatIds(previousOutline),
      nextBeatIds: beatIds(nextOutline),
    },
  }
}

export function buildPlanAssistOverrideLineage(input: PlanAssistOverrideLineageInput) {
  const outline = normalizeChapterOutlineForPersistence(input.outline)
  const previousVersion = stableHash(input.previousValue)
  const nextVersion = stableHash(input.nextValue)
  const sourceId = planAssistSourceId(input, "override", previousVersion, nextVersion)
  const changedAt = input.changedAt ?? new Date().toISOString()
  const chapterRef = outline.chapterId ?? `chapter:${input.chapter}`

  return {
    id: planAssistLineageId(sourceId, "planCheckOverridden", previousVersion, nextVersion),
    proposalId: sourceId,
    proposalKind: "planning_edit" as const,
    novelId: input.novelId,
    sourceTable: "chapter_exhaustions" as const,
    actorKind: "human",
    source: `plan-assist:${input.payload.kind}`,
    targetKind: "chapter_outline",
    previousRef: chapterRef,
    nextRef: chapterRef,
    fieldPath: "planCheckOverridden",
    previousVersion,
    nextVersion,
    changedAt,
    reason: input.reason ?? "operator overrode plan checks at plan-assist gate",
    affectedDownstreamRefs: [],
    metadata: {
      decision: "override",
      chapter: input.chapter,
      attempt: input.payload.attempt,
      planAssistKind: input.payload.kind,
      unresolvedDeviationCount: input.payload.unresolvedDeviations.length,
      previousValue: input.previousValue,
      nextValue: input.nextValue,
    },
  }
}

export async function recordPlanAssistOutlineLineage(
  input: PlanAssistOutlineLineageInput,
): Promise<void> {
  await recordPlanningMutationLineage(buildPlanAssistOutlineLineage(input))
}

export async function recordPlanAssistOverrideLineage(
  input: PlanAssistOverrideLineageInput,
): Promise<void> {
  await recordPlanningMutationLineage(buildPlanAssistOverrideLineage(input))
}

function planAssistSourceId(
  input: PlanAssistLineageBase,
  decision: "edit-plan" | "override",
  previousVersion: string,
  nextVersion: string,
): string {
  if (typeof input.exhaustionId === "number" && input.exhaustionId > 0) {
    return String(input.exhaustionId)
  }
  return `plan-assist:${stableHash({
    novelId: input.novelId,
    chapter: input.chapter,
    attempt: input.payload.attempt,
    kind: input.payload.kind,
    decision,
    previousVersion,
    nextVersion,
  }).slice(0, 16)}`
}

function planAssistLineageId(
  sourceId: string,
  fieldPath: string,
  previousVersion: string,
  nextVersion: string,
): string {
  return `lineage:plan-assist:${stableHash({
    sourceId,
    fieldPath,
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
