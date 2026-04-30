import type { ChapterOutline } from "../../types"

export function buildContext(outline: ChapterOutline, beatProses: string[]): string {
  const plannedState = {
    establishedFacts: outline.establishedFacts ?? [],
    characterStateChanges: outline.characterStateChanges ?? [],
    knowledgeChanges: outline.knowledgeChanges ?? [],
  }

  const beats = beatProses.map((prose, index) => ({
    beat_index: index,
    beat_description: outline.scenes[index]?.description ?? "",
    planned_characters: outline.scenes[index]?.characters ?? [],
    prose,
  }))

  return [
    "EVIDENCE_TIERS:",
    "required: PLANNED_STATE and CHAPTER_PROSE_BY_BEAT below.",
    "supporting: beat descriptions and planned character lists are included only to identify the intended beat job.",
    "inventory: none.",
    "",
    "CHAPTER:",
    JSON.stringify({
      chapterNumber: outline.chapterNumber,
      title: outline.title,
      povCharacter: outline.povCharacter,
      setting: outline.setting,
      purpose: outline.purpose,
    }, null, 2),
    "",
    "PLANNED_STATE:",
    JSON.stringify(plannedState, null, 2),
    "",
    "CHAPTER_PROSE_BY_BEAT:",
    JSON.stringify(beats, null, 2),
  ].join("\n")
}
