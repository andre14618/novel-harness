import type { ChapterOutline } from "../types"
import type { PlanAssistGatePayload, PlanAssistAllowedEntityPatch } from "../gates"
import { normalizeChapterOutlineForPersistence } from "../db/outlines"

export interface AppliedAllowedEntityPatch {
  beatIndex: number
  sceneId?: string
  beatId?: string
  addedEntities: string[]
  alreadyAllowedEntities: string[]
  missingEntities: string[]
}

export interface PlanAssistAllowedEntityPatchResult {
  outline: ChapterOutline
  applied: AppliedAllowedEntityPatch[]
}

export function buildAllowedEntityPatchesFromPlanAssistPayload(
  payload: PlanAssistGatePayload,
): PlanAssistAllowedEntityPatch[] {
  const byBeat = new Map<number, Set<string>>()
  for (const deviation of payload.unresolvedDeviations) {
    if (!Number.isInteger(deviation.beat_index) || deviation.beat_index == null || deviation.beat_index < 0) continue
    const entity = readHallucUngroundedEntity(deviation)
    if (!entity) continue
    const set = byBeat.get(deviation.beat_index) ?? new Set<string>()
    set.add(entity)
    byBeat.set(deviation.beat_index, set)
  }

  return [...byBeat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([beatIndex, entities]) => ({
      beatIndex,
      entities: [...entities].sort((a, b) => a.localeCompare(b)),
    }))
}

export function applyAllowedEntityPatchesToOutline(
  outline: ChapterOutline,
  patches: readonly PlanAssistAllowedEntityPatch[],
): PlanAssistAllowedEntityPatchResult {
  const next = normalizeChapterOutlineForPersistence(outline)
  const applied: AppliedAllowedEntityPatch[] = []

  for (const patch of patches) {
    const beatIndex = patch.beatIndex
    const scene = Number.isInteger(beatIndex) && beatIndex >= 0
      ? next.scenes?.[beatIndex]
      : undefined
    const cleanedEntities = uniqueCleanStrings(patch.entities)
    if (!scene) {
      applied.push({
        beatIndex,
        addedEntities: [],
        alreadyAllowedEntities: [],
        missingEntities: cleanedEntities,
      })
      continue
    }

    scene.obligations ??= {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    }
    scene.obligations.allowedNewEntities ??= []

    const existingByLower = new Map(
      scene.obligations.allowedNewEntities
        .map(entity => [entity.toLowerCase(), entity] as const),
    )
    const addedEntities: string[] = []
    const alreadyAllowedEntities: string[] = []

    for (const entity of cleanedEntities) {
      if (existingByLower.has(entity.toLowerCase())) {
        alreadyAllowedEntities.push(existingByLower.get(entity.toLowerCase()) ?? entity)
        continue
      }
      scene.obligations.allowedNewEntities.push(entity)
      existingByLower.set(entity.toLowerCase(), entity)
      addedEntities.push(entity)
    }

    applied.push({
      beatIndex,
      ...(scene.sceneId ? { sceneId: scene.sceneId } : {}),
      ...(scene.beatId ? { beatId: scene.beatId } : {}),
      addedEntities,
      alreadyAllowedEntities,
      missingEntities: [],
    })
  }

  return { outline: next, applied }
}

function readHallucUngroundedEntity(
  deviation: PlanAssistGatePayload["unresolvedDeviations"][number],
): string | null {
  const metadataEntity = readNestedString(deviation.metadata, ["hallucUngrounded", "entity"])
  if (metadataEntity) return metadataEntity
  const match = deviation.description.match(/Ungrounded entity "([^"]+)"/)
  return cleanString(match?.[1])
}

function readNestedString(root: unknown, path: readonly string[]): string | null {
  let cursor = root
  for (const part of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cleanString(cursor)
}

function uniqueCleanStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = cleanString(value)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}
