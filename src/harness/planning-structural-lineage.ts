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
  | "scene_select"
  | "obligation_reorder"
  | "obligation_replace"

export interface StructuralPlanningMutationLineageDraft {
  targetKind: "scene_plan" | "beat_obligation"
  previousRef: string
  nextRef: string
  fieldPath: string
  previousVersion: string
  nextVersion: string
  metadata: Record<string, unknown> & {
    structuralOperation: StructuralPlanningLineageOperation
  }
}

type SceneRefKind = "sceneId" | "beatId"

interface SceneSlot {
  sceneRef: string
  sceneRefKind: SceneRefKind
  scene: SceneBeatInOutline
  index: number
}

interface ObligationSlot {
  obligationId: string
  obligation: Record<string, unknown>
  sceneRef: string
  sceneRefKind: SceneRefKind
  sceneIndex: number
  listKey: ObligationListKey
  itemIndex: number
}

export function collectStructuralPlanningMutationLineage(
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft[] {
  const previousScenes = collectSceneSlots(previousOutline)
  const nextScenes = collectSceneSlots(nextOutline)
  const previousSceneRefs = new Set(previousScenes.map((slot) => slot.sceneRef))
  const nextSceneRefs = new Set(nextScenes.map((slot) => slot.sceneRef))
  const nextSceneByRef = new Map(nextScenes.map((slot) => [slot.sceneRef, slot]))
  const previousSceneByIndex = new Map(previousScenes.map((slot) => [slot.index, slot]))
  const nextSceneByIndex = new Map(nextScenes.map((slot) => [slot.index, slot]))
  const drafts: StructuralPlanningMutationLineageDraft[] = []
  const replacedPreviousRefs = new Set<string>()

  for (const previous of previousScenes) {
    const next = nextSceneByRef.get(previous.sceneRef)
    if (!next || next.index === previous.index) continue
    drafts.push(buildSceneReorderDraft(previous, next, previousOutline, nextOutline))
  }

  const maxSceneIndex = Math.max(previousOutline.scenes?.length ?? 0, nextOutline.scenes?.length ?? 0)
  for (let index = 0; index < maxSceneIndex; index++) {
    const previous = previousSceneByIndex.get(index)
    const next = nextSceneByIndex.get(index)
    if (!previous || !next || previous.sceneRef === next.sceneRef) continue
    if (nextSceneRefs.has(previous.sceneRef) || previousSceneRefs.has(next.sceneRef)) continue
    drafts.push(buildSceneReplaceDraft(previous, next, previousOutline, nextOutline))
    replacedPreviousRefs.add(previous.sceneRef)
  }

  for (const previous of previousScenes) {
    if (nextSceneRefs.has(previous.sceneRef) || replacedPreviousRefs.has(previous.sceneRef)) continue
    drafts.push(buildSceneSelectRemovalDraft(previous, previousOutline, nextOutline))
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

function buildSceneReorderDraft(
  previous: SceneSlot,
  next: SceneSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "scene_plan",
    previousRef: previous.sceneRef,
    nextRef: next.sceneRef,
    fieldPath: "scenes",
    previousVersion: structuralLocationVersion({
      targetKind: "scene_plan",
      ref: previous.sceneRef,
      ...sceneRefLocation(previous),
      chapterId: previousOutline.chapterId,
      chapterNumber: previousOutline.chapterNumber,
      index: previous.index,
    }),
    nextVersion: structuralLocationVersion({
      targetKind: "scene_plan",
      ref: next.sceneRef,
      ...sceneRefLocation(next),
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
      previousSceneRef: previous.sceneRef,
      nextSceneRef: next.sceneRef,
      previousSceneRefKind: previous.sceneRefKind,
      nextSceneRefKind: next.sceneRefKind,
      ...legacyBeatIdMetadata(previous, "previous"),
      ...legacyBeatIdMetadata(next, "next"),
      exactIdMatch: true,
      versionShape: "structural_location_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function buildSceneReplaceDraft(
  previous: SceneSlot,
  next: SceneSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "scene_plan",
    previousRef: previous.sceneRef,
    nextRef: next.sceneRef,
    fieldPath: "scenes",
    previousVersion: stableHash(previous.scene),
    nextVersion: stableHash(next.scene),
    metadata: compactRecord({
      structuralOperation: "beat_replace",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousIndex: previous.index,
      nextIndex: next.index,
      previousSceneRef: previous.sceneRef,
      nextSceneRef: next.sceneRef,
      previousSceneRefKind: previous.sceneRefKind,
      nextSceneRefKind: next.sceneRefKind,
      ...legacyBeatIdMetadata(previous, "previous"),
      ...legacyBeatIdMetadata(next, "next"),
      supersessionBasis: "same_index_exact_id_absence",
      versionShape: "artifact_hash_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function buildSceneSelectRemovalDraft(
  previous: SceneSlot,
  previousOutline: ChapterOutline,
  nextOutline: ChapterOutline,
): StructuralPlanningMutationLineageDraft {
  return {
    targetKind: "scene_plan",
    previousRef: previous.sceneRef,
    nextRef: previous.sceneRef,
    fieldPath: "scenes",
    previousVersion: stableHash(previous.scene),
    nextVersion: structuralLocationVersion({
      targetKind: "scene_plan",
      ref: previous.sceneRef,
      ...sceneRefLocation(previous),
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      removedFromChapterScenes: true,
      previousIndex: previous.index,
    }),
    metadata: compactRecord({
      structuralOperation: "scene_select",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousIndex: previous.index,
      previousSceneRef: previous.sceneRef,
      previousSceneRefKind: previous.sceneRefKind,
      ...legacyBeatIdMetadata(previous, "previous"),
      previousSceneCount: previousOutline.scenes?.length,
      nextSceneCount: nextOutline.scenes?.length,
      removedFromChapterScenes: true,
      versionShape: "selection_removal_v1",
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
      ...obligationSceneRefLocation(previous),
      listKey: previous.listKey,
      itemIndex: previous.itemIndex,
    }),
    nextVersion: structuralLocationVersion({
      targetKind: "beat_obligation",
      ref: next.obligationId,
      ...obligationSceneRefLocation(next),
      listKey: next.listKey,
      itemIndex: next.itemIndex,
    }),
    metadata: compactRecord({
      structuralOperation: "obligation_reorder",
      chapterId: nextOutline.chapterId ?? previousOutline.chapterId,
      chapterNumber: nextOutline.chapterNumber ?? previousOutline.chapterNumber,
      previousSceneRef: previous.sceneRef,
      nextSceneRef: next.sceneRef,
      previousSceneRefKind: previous.sceneRefKind,
      nextSceneRefKind: next.sceneRefKind,
      previousSceneIndex: previous.sceneIndex,
      nextSceneIndex: next.sceneIndex,
      ...legacyObligationBeatIdMetadata(previous, "previous"),
      ...legacyObligationBeatIdMetadata(next, "next"),
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
      sceneRef: next.sceneRef,
      sceneRefKind: next.sceneRefKind,
      sceneIndex: next.sceneIndex,
      ...legacyObligationBeatIdMetadata(next),
      listKey: next.listKey,
      previousIndex: previous.itemIndex,
      nextIndex: next.itemIndex,
      supersessionBasis: "same_beat_list_index_exact_id_absence",
      versionShape: "artifact_hash_v1",
    }) as StructuralPlanningMutationLineageDraft["metadata"],
  }
}

function collectSceneSlots(outline: ChapterOutline): SceneSlot[] {
  const slots: SceneSlot[] = []
  const scenes = outline.scenes ?? []
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index]
    const ref = sceneEntryRef(scene)
    if (!ref) continue
    slots.push({ sceneRef: ref.value, sceneRefKind: ref.kind, scene, index })
  }
  return slots
}

function collectObligationSlots(outline: ChapterOutline): ObligationSlot[] {
  const slots: ObligationSlot[] = []
  const scenes = outline.scenes ?? []
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const beat = scenes[sceneIndex]
    const ref = sceneEntryRef(beat)
    if (!ref) continue
    for (const listKey of OBLIGATION_LIST_KEYS) {
      const list = obligationList(beat, listKey)
      for (let itemIndex = 0; itemIndex < list.length; itemIndex++) {
        const obligation = list[itemIndex]
        const obligationId = stableId(obligation.obligationId)
        if (!obligationId) continue
        slots.push({
          obligationId,
          obligation,
          sceneRef: ref.value,
          sceneRefKind: ref.kind,
          sceneIndex,
          listKey,
          itemIndex,
        })
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
  return `${slot.sceneRef}:${slot.listKey}:${slot.itemIndex}`
}

function obligationsShareStructuralSlot(a: ObligationSlot, b: ObligationSlot): boolean {
  return a.sceneRef === b.sceneRef && a.listKey === b.listKey && a.itemIndex === b.itemIndex
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

function sceneEntryRef(scene: SceneBeatInOutline): { value: string; kind: SceneRefKind } | null {
  const sceneId = stableId((scene as { sceneId?: unknown }).sceneId)
  if (sceneId) return { value: sceneId, kind: "sceneId" }
  const beatId = stableId((scene as { beatId?: unknown }).beatId)
  if (beatId) return { value: beatId, kind: "beatId" }
  return null
}

function sceneRefLocation(slot: SceneSlot): Record<string, unknown> {
  return slot.sceneRefKind === "sceneId"
    ? { sceneId: slot.sceneRef }
    : { beatId: slot.sceneRef }
}

function obligationSceneRefLocation(slot: ObligationSlot): Record<string, unknown> {
  return slot.sceneRefKind === "sceneId"
    ? { sceneId: slot.sceneRef }
    : { beatId: slot.sceneRef }
}

function legacyBeatIdMetadata(
  slot: SceneSlot,
  prefix?: "previous" | "next",
): Record<string, unknown> {
  if (slot.sceneRefKind !== "beatId") return {}
  const key = prefix === undefined
    ? "beatId"
    : `${prefix}BeatId`
  return { [key]: slot.sceneRef }
}

function legacyObligationBeatIdMetadata(
  slot: ObligationSlot,
  prefix?: "previous" | "next",
): Record<string, unknown> {
  if (slot.sceneRefKind !== "beatId") return {}
  const idKey = prefix === undefined ? "beatId" : `${prefix}BeatId`
  const indexKey = prefix === undefined ? "beatIndex" : `${prefix}BeatIndex`
  return { [idKey]: slot.sceneRef, [indexKey]: slot.sceneIndex }
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
