import type { ChapterOutline } from "../../types"

export function buildContext(outline: ChapterOutline, beatProses: string[]): string {
  // PLANNED_STATE items already carry their durable ids from
  // `enrichOutlineIds` (establishedFacts.id, knowledgeChanges.id,
  // characterStateChanges.id). Serialized verbatim so the model can copy a
  // matched item's id back as `planned_item_id` per the system prompt. The
  // wrapper still validates the emitted id against the input registry
  // before threading it onto the warning, so the prompt is best-effort, not
  // load-bearing.
  const plannedState = {
    establishedFacts: outline.establishedFacts ?? [],
    characterStateChanges: outline.characterStateChanges ?? [],
    knowledgeChanges: outline.knowledgeChanges ?? [],
  }

  const beats = beatProses.map((prose, index) => {
    const scene = outline.scenes[index]
    const beatId = typeof scene?.beatId === "string" && scene.beatId.length > 0 ? scene.beatId : undefined
    return {
      beat_index: index,
      ...(beatId ? { beat_id: beatId } : {}),
      beat_description: scene?.description ?? "",
      planned_characters: scene?.characters ?? [],
      prose,
    }
  })

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
