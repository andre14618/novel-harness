import {
  getTimelineEventsForChapter, getTimelineEventsUpToChapter,
  getKnowledgeForChapter, getCharacters, getStorySpine,
} from "../../db"

export async function buildContext(novelId: string, chapterNum: number): Promise<string> {
  const characters = await getCharacters(novelId)
  const thisChapterEvents = await getTimelineEventsForChapter(novelId, chapterNum)
  const priorEvents = await getTimelineEventsUpToChapter(novelId, chapterNum)
  const knowledgeGains = await getKnowledgeForChapter(novelId, chapterNum)

  let storyThemes: string[] = []
  try {
    const spine = await getStorySpine(novelId)
    if (spine.theme) storyThemes.push(spine.theme)
  } catch {}

  const sections: string[] = []

  // Character reference
  sections.push(`CHARACTERS:\n${characters.map(c => `- ${c.name} (id: ${c.id}, role: ${c.role})`).join("\n")}`)

  // Story themes
  if (storyThemes.length > 0) {
    sections.push(`STORY THEMES:\n${storyThemes.map(t => `- ${t}`).join("\n")}`)
  }

  // This chapter's events (with IDs)
  if (thisChapterEvents.length > 0) {
    sections.push(`THIS CHAPTER'S EVENTS (chapter ${chapterNum}):\n${thisChapterEvents.map(e =>
      `- [${e.id}] ${e.event} at ${e.location}. Participants: ${e.participants.join(", ")}${e.consequences ? `. Consequences: ${e.consequences}` : ""}`
    ).join("\n")}`)
  }

  // Prior events (with IDs, last 50 for context)
  const recentPrior = priorEvents.slice(-50)
  if (recentPrior.length > 0) {
    sections.push(`PRIOR EVENTS (for causal linking):\n${recentPrior.map(e =>
      `- [${e.id}] ch${e.chapterNumber}: ${e.event} at ${e.location}. Participants: ${e.participants.join(", ")}`
    ).join("\n")}`)
  }

  // Knowledge gains this chapter (with IDs)
  if (knowledgeGains.length > 0) {
    sections.push(`KNOWLEDGE GAINED THIS CHAPTER:\n${knowledgeGains.map(k =>
      `- [${k.id}] ${k.characterId} ${k.source} that "${k.knowledge}" (category: ${k.category}${k.isFalse ? ", FALSE BELIEF" : ""})`
    ).join("\n")}`)
  }

  sections.push("Analyze these events and knowledge gains. Produce causal links, knowledge propagation, and thematic tags.")

  return sections.join("\n\n")
}
