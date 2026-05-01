import type { BeatObligationsContract, ChapterOutline, SceneBeat } from "../types"

export interface BeatStableIdTraceMeta {
  beatDescription: string
  beatCharacters: string[]
  totalBeats: number
  chapterTitle: string
  chapterId?: string
  beatId?: string
  obligationIds: string[]
  sourceIds: string[]
  characterIds: string[]
}

export function collectObligationIds(obligations: BeatObligationsContract | undefined): string[] {
  if (!obligations) return []
  const ids: string[] = []
  for (const key of ["mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange", "mustNotReveal"] as const) {
    for (const item of obligations[key] ?? []) {
      const id = (item as any).obligationId
      if (id && typeof id === "string") ids.push(id)
    }
  }
  return ids
}

export function collectSourceIds(obligations: BeatObligationsContract | undefined): string[] {
  if (!obligations) return []
  const ids = new Set<string>()
  for (const key of ["mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange"] as const) {
    for (const item of obligations[key] ?? []) {
      const id = (item as any).sourceId
      if (id && typeof id === "string") ids.add(id)
    }
  }
  return [...ids]
}

export function collectCharacterIds(obligations: BeatObligationsContract | undefined): string[] {
  if (!obligations) return []
  const ids = new Set<string>()
  for (const key of ["mustTransferKnowledge", "mustShowStateChange"] as const) {
    for (const item of obligations[key] ?? []) {
      const id = (item as any).characterId
      if (id && typeof id === "string") ids.add(id)
    }
  }
  return [...ids]
}

export function beatStableIdTraceMeta(outline: ChapterOutline, beatSpec: SceneBeat): BeatStableIdTraceMeta {
  return {
    beatDescription: beatSpec.description,
    beatCharacters: beatSpec.characters,
    totalBeats: outline.scenes.length,
    chapterTitle: outline.title,
    chapterId: outline.chapterId,
    beatId: beatSpec.beatId,
    obligationIds: collectObligationIds(beatSpec.obligations),
    sourceIds: collectSourceIds(beatSpec.obligations),
    characterIds: collectCharacterIds(beatSpec.obligations),
  }
}
