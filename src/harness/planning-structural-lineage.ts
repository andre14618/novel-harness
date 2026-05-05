import { stableHash } from "../canon/proposal-envelope"
import type { ChapterOutline } from "../types"

const OBLIGATION_LIST_KEYS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
] as const

type ObligationListKey = (typeof OBLIGATION_LIST_KEYS)[number]
type SceneBeatInOutline = NonNullable<ChapterOutline["scenes"]>[number]

export type StructuralPlanningLineageOperation =
  | "beat_reorder"
  | "beat_replace"
  | "obligation_reorder"
  | "obligation_replace"

export interface StructuralPlanningMutationLineageDraft {
  targetKind: "beat_plan" | "beat_obligation"
  previousRef: string
  nextRef: string
  fieldPath: string
  previousVersion: string
  nextVersion: string
  metadata: Record<string, unknown> & {
    structuralOperation: StructuralPlanningLineageOperation
  }
}

interface BeatSlot {
  beatId: string
  beat: SceneBeatInOutline
  index: number
}

interface ObligationSlot {
  obligationId: string
  obligation: Record<string, unknown>
  beatId: string
  beatIndex: number
  listKey: ObligationListKey
  itemIndex: number
}

export function collectStructuralPlanningMutationLineage(
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft[] {
  const previousBeats = collectBeatSlots(previousOutline)
  const nextBeats = collectBeatSlots(nextOutline)
  const previousBeatIds = new Set(previousBeats.map((slot) => slot.beatId))
  const nextBeatIds = new Set(nextBeats.map((slot) => slot.beatId))
  const nextBeatById = new Map(nextBeats.map((slot) => [slot.beatId, slot]))
  const previousBeatByIndex = new Map(previousBeats.map((slot) => [slot.index, slot]))
  const nextBeatByIndex = new Map(nextBeats.map((slot) => [slot.index, slot]))
  const drafts: StructuralPlanningMutationLineageDraft[] = []

  for (const previous of previousBeats) {
    const next = nextBeatById.get(previous.beatId)
    if (!next || next.index === previous.index) continue
    drafts.push(buildBeatReorderDraft(previous, next, previousOutline, nextOutline))
  }

  const maxBeatIndex = Math.max(previousOutline.scenes?.length ?? 0, nextOutline.scenes?.length ?? 0)
  for (let index = 0; index < maxBeatIndex; index++) {
    const previous = previousBeatByIndex.get(index)
    const next = nextBeatByIndex.get(index)
    if (!previous || !next || previous.beatId === next.beatId) continue
    if (nextBeatIds.has(previous.beatId) || previousBeatIds.has(next.beatId)) continue
    drafts.push(buildBeatReplaceDraft(previous, next, previousOutline, nextOutline))
  }

  drafts.push(...collectObligationStructuralLineage(previousOutline, nextOutline))
  return drafts
}

function collectObligationStructuralLineage(
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft[] {
  const previousSlots = collectObligationSlots(previousOutline)
  const nextSlots = collectObligationSlots(nextOutline)
  const previousIds = new Set(previousSlots.map((slot) => slot.obligationId))
  const nextIds = new Set(nextSlots.map((slot) => slot.obligationId))
  const nextById = new Map(nextSlots.map((slot) => [slot.obligationId, slot]))
  const previousBySlot = new Map(previousSlots.map((slot) => [obligationStructuralSlotKey(slot), slot]))
  const nextBySlot = new Map(nextSlots.map((slot) => [obligationStructuralSlotKey(slot), slot]))
  const drafts: StructuralPlanningMutationLineageDraft[] = []

  for (const previous of previousSlots) {
    const next = nextById.get(previous.obligationId)
    if (!next || obligationsShareStructuralSlot(previous, next)) continue
    drafts.push(buildObligationReorderDraft(previous, next, previousOutline, nextOutline))
  }

  for (const [slotKey, previous] of previousBySlot) {
    const next = nextBySlot.get(slotKey)
    if (!next || previous.obligationId === next.obligationId) continue
    if (nextIds.has(previous.obligationId) || previousIds.has(next.obligationId)) continue
    drafts.push(buildObligationReplaceDraft(previous, next, previousOutline, nextOutline))
  }

  return drafts
}

function buildBeatReorderDraft(
  previous: BeatSlot,
  next: BeatSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "beat_plan",
    previousRef: previous.beatId,
    nextRef: next.beatId,
    fieldPath: "scenes",
    previousVersion: structuralLocationVersion({
      targetKind: "beat_plan",
      ref: previous.beatId,
      chapterId: previousOutline.chapterId,
      chapterNumber: previousOutline.chapterNumber,
      index: previous.index,
    }),
    nextVersion: structuralLocationVersion({
      targetKind: "beat_plan",
      ref: next.beatId,
      chapterId: nextOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber,
      index: next.index,
    }),
    metadata: compactRecord({
      structuralOperation: "beat_reorder",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousIndex: previous.index,
      nextIndex: next.index,
      exactIdMatch: true,
      versionShape: "structural_location_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function buildBeatReplaceDraft(
  previous: BeatSlot,
  next: BeatSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "beat_plan",
    previousRef: previous.beatId,
    nextRef: next.beatId,
    fieldPath: "scenes",
    previousVersion: stableHash(previous.beat),
    nextVersion: stableHash(next.beat),
    metadata: compactRecord({
      structuralOperation: "beat_replace",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousIndex: previous.index,
      nextIndex: next.index,
      supersessionBasis: "same_index_exact_id_absence",
      versionShape: "artifact_hash_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function buildObligationReorderDraft(
  previous: ObligationSlot,
  next: ObligationSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  const fieldPath = previous.listKey === next.listKey
    ? `obligations.${previous.listKey}`
    : "obligations"
  return {
    targetKind: "beat_obligation",
    previousRef: previous.obligationId,
    nextRef: next.obligationId,
    fieldPath,
    previousVersion: structuralLocationVersion({
      targetKind: "beat_obligation",
      ref: previous.obligationId,
      beatId: previous.beatId,
      listKey: previous.listKey,
      itemIndex: previous.itemIndex,
    }),
    nextVersion: structuralLocationVersion({
      targetKind: "beat_obligation",
      ref: next.obligationId,
      beatId: next.beatId,
      listKey: next.listKey,
      itemIndex: next.itemIndex,
    }),
    metadata: compactRecord({
      structuralOperation: "obligation_reorder",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousBeatId: previous.beatId,
      nextBeatId: next.beatId,
      previousBeatIndex: previous.beatIndex,
      nextBeatIndex: next.beatIndex,
      previousListKey: previous.listKey,
      nextListKey: next.listKey,
      previousIndex: previous.itemIndex,
      nextIndex: next.itemIndex,
      exactIdMatch: true,
      versionShape: "structural_location_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function buildObligationReplaceDraft(
  previous: ObligationSlot,
  next: ObligationSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "beat_obligation",
    previousRef: previous.obligationId,
    nextRef: next.obligationId,
    fieldPath: `obligations.${previous.listKey}`,
    previousVersion: stableHash(previous.obligation),
    nextVersion: stableHash(next.obligation),
    metadata: compactRecord({
      structuralOperation: "obligation_replace",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      beatId: next.beatId,
      beatIndex: next.beatIndex,
      listKey: next.listKey,
      previousIndex: previous.itemIndex,
      nextIndex: next.itemIndex,
      supersessionBasis: "same_beat_list_index_exact_id_absence",
      versionShape: "artifact_hash_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function collectBeatSlots(outline: ChapterOutline): BeatSlot[] {
  const slots: BeatSlot[] = []
  const scenes = outline.scenes ?? []
  for (let index = 0; index < scenes.length; index++) {
    const beat = scenes[index]
    const beatId = stableId(beat.beatId)
    if (!beatId) continue
    slots.push({ beatId, beat, index })
  }
  return slots
}

function collectObligationSlots(outline: ChapterOutline): ObligationSlot[] {
  const slots: ObligationSlot[] = []
  const scenes = outline.scenes ?? []
  for (let beatIndex = 0; beatIndex < scenes.length; beatIndex++) {
    const beat = scenes[beatIndex]
    const beatId = stableId(beat.beatId)
    if (!beatId) continue
    for (const listKey of OBLIGATION_LIST_KEYS) {
      const list = obligationList(beat, listKey)
      for (let itemIndex = 0; itemIndex < list.length; itemIndex++) {
        const obligation = list[itemIndex]
        const obligationId = stableId(obligation.obligationId)
        if (!obligationId) continue
        slots.push({ obligationId, obligation, beatId, beatIndex, listKey, itemIndex })
      }
    }
  }
  return slots
}

function obligationList(
  beat: SceneBeatInOutline,
  listKey: ObligationListKey,
): Record<string, unknown>[] {
  const obligations = beat.obligations as Record<string, unknown> | undefined
  const list = obligations?.[listKey]
  if (!Array.isArray(list)) return []
  return list.filter((item): item is Record<string, unknown> => {
    return typeof item === "object" && item !== null && !Array.isArray(item)
  })
}

function obligationStructuralSlotKey(slot: ObligationSlot): string {
  return `${slot.beatId}:${slot.listKey}:${slot.itemIndex}`
}

function obligationsShareStructuralSlot(a: ObligationSlot, b: ObligationSlot): boolean {
  return a.beatId === b.beatId && a.listKey === b.listKey && a.itemIndex === b.itemIndex
}

function structuralLocationVersion(location: Record<string, unknown>): string {
  return stableHash({
    versionShape: "structural_location_v1",
    ...compactRecord(location),
  })
}

function stableId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
