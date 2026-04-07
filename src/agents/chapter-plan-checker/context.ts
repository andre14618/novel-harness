import type { ChapterOutline } from "../planning-plotter/schema"

export function buildContext(prose: string, outline: ChapterOutline): string {
  const sections: string[] = []

  // Chapter metadata
  sections.push(`CHAPTER ${outline.chapterNumber}: "${outline.title}"`)
  sections.push(`POV: ${outline.povCharacter}`)
  sections.push(`Setting: ${outline.setting}`)
  sections.push(`Purpose: ${outline.purpose}`)
  sections.push(`Characters present: ${outline.charactersPresent.join(", ")}`)
  sections.push("")

  // Scene beats
  sections.push("SCENE BEATS:")
  for (let i = 0; i < outline.scenes.length; i++) {
    const s = outline.scenes[i]
    sections.push(`  Beat ${i + 1}: ${s.description}`)
    sections.push(`    Characters: ${s.characters.join(", ")}`)
    if (s.emotionalShift) sections.push(`    Emotional shift: ${s.emotionalShift}`)
  }
  sections.push("")

  // State updates (if present)
  if (outline.establishedFacts.length > 0) {
    sections.push("FACTS THAT SHOULD BE ESTABLISHED:")
    for (const f of outline.establishedFacts) {
      sections.push(`  - [${f.category}] ${f.fact}`)
    }
    sections.push("")
  }

  if (outline.characterStateChanges.length > 0) {
    sections.push("CHARACTER STATES AT END OF CHAPTER:")
    for (const cs of outline.characterStateChanges) {
      sections.push(`  ${cs.name}: location=${cs.location}, emotional=${cs.emotionalState}`)
      if (cs.knows.length > 0) sections.push(`    knows: ${cs.knows.join("; ")}`)
      if (cs.doesNotKnow.length > 0) sections.push(`    doesn't know: ${cs.doesNotKnow.join("; ")}`)
    }
    sections.push("")
  }

  if (outline.knowledgeChanges.length > 0) {
    sections.push("KNOWLEDGE CHANGES:")
    for (const kc of outline.knowledgeChanges) {
      sections.push(`  ${kc.characterName} ${kc.source} that: ${kc.knowledge}`)
    }
    sections.push("")
  }

  // The prose to check
  sections.push("---")
  sections.push("CHAPTER PROSE:")
  sections.push(prose)

  return sections.join("\n")
}
