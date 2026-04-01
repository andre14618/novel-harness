import {
  getRecentSummaries, getFactsForChapter, getCharacterStatesAtChapter,
} from "../../db"

export function buildContext(novelId: string, totalChapters: number): string {
  let ctx = "MANUSCRIPT REVIEW\n\n"

  for (let ch = 1; ch <= totalChapters; ch++) {
    const summaries = getRecentSummaries(novelId, ch + 1, 1)
    const facts = getFactsForChapter(novelId, ch)

    ctx += `CHAPTER ${ch}:\n`
    if (summaries.length > 0) {
      ctx += `Summary: ${summaries[0].summary}\n`
      ctx += `Key events: ${summaries[0].keyEvents.join("; ")}\n`
    }
    if (facts.length > 0) {
      ctx += `Facts established: ${facts.map(f => `[${f.category}] ${f.fact}`).join("; ")}\n`
    }
    ctx += "\n"
  }

  const finalStates = getCharacterStatesAtChapter(novelId, totalChapters + 1)
  if (finalStates.length > 0) {
    ctx += "CHARACTER STATES (end of manuscript):\n"
    ctx += finalStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")
    ctx += "\n"
  }

  ctx += "\nCheck this manuscript for cross-chapter continuity issues. Report contradictions, timeline problems, knowledge violations, and dropped threads."

  return ctx
}

export const buildCrossChapterContext = buildContext
