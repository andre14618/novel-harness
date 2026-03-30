import type { SeedInput, WorldBible, CharacterProfile, StorySpine, Fact, CharacterState, ChapterSummary, ContinuityIssue } from "./types"
import {
  getChapterOutline, getCharacters, getWorldBible, getStorySpine,
  getRecentSummaries, getFactsUpToChapter, getCharacterStatesAtChapter,
  getOpenIssues,
} from "./db"

// ── Phase 1: Concept ───────────────────────────────────────────────────────

export function buildConceptContext(seed: SeedInput): { world: string; character: string; plotter: string } {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  const base = `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}`

  return {
    world: `${base}\n\nCreate a detailed world bible for this story. Make the world feel specific and lived-in.`,
    character: `${base}\n\nDevelop these character sketches into full profiles. Ensure each character has a unique voice and clear motivations. Create relationships between them.`,
    plotter: `${base}\n\nDesign a 3-act story structure for this premise. Ensure escalating tension and a satisfying arc.`,
  }
}

// ── Phase 2: Planning ──────────────────────────────────────────────────────

export function buildPlanningContext(
  worldBible: WorldBible,
  characters: CharacterProfile[],
  spine: StorySpine,
  seed: SeedInput,
): string {
  const worldSection = `WORLD BIBLE:
Setting: ${worldBible.setting}
Time Period: ${worldBible.timePeriod}
Rules:
${worldBible.rules.map(r => `- ${r}`).join("\n")}
Locations:
${worldBible.locations.map(l => `- ${l.name}: ${l.description}`).join("\n")}
Culture: ${worldBible.culture}
History: ${worldBible.history}`

  const charSection = `CHARACTER PROFILES:
${characters.map(c => `${c.name} (${c.role}):
  Backstory: ${c.backstory}
  Traits: ${c.traits.join(", ")}
  Speech: ${c.speechPattern}
  Goals: ${c.goals}
  Fears: ${c.fears}
  Relationships: ${c.relationships.map(r => `${r.characterName} — ${r.nature}`).join("; ")}`).join("\n\n")}`

  const spineSection = `STORY SPINE:
Central Conflict: ${spine.centralConflict}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}
Acts:
${spine.acts.map(a => `  Act ${a.number} — ${a.name}: ${a.summary} [${a.emotionalArc}]`).join("\n")}`

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}

${charSection}

${spineSection}

Create a detailed chapter-by-chapter outline. Each chapter should have specific scene beats that advance the plot and develop characters.`
}

// ── Phase 3: Drafting ──────────────────────────────────────────────────────

export function buildWriterContext(novelId: string, chapterNum: number): string {
  const outline = getChapterOutline(novelId, chapterNum)
  const allChars = getCharacters(novelId)
  const worldBible = getWorldBible(novelId)
  const recentSummaries = getRecentSummaries(novelId, chapterNum, 3)
  const charStates = getCharacterStatesAtChapter(novelId, chapterNum)
  const openIssues = getOpenIssues(novelId, chapterNum)

  // Filter characters to only those in this chapter
  const chapterCharNames = outline.charactersPresent.map(n => n.toLowerCase())
  const relevantChars = allChars.filter(c => chapterCharNames.includes(c.name.toLowerCase()))

  // Find relevant world rules/locations
  const relevantLocations = worldBible.locations.filter(
    l => l.name.toLowerCase().includes(outline.setting.toLowerCase()) ||
         outline.setting.toLowerCase().includes(l.name.toLowerCase())
  )

  let ctx = `CHAPTER ${outline.chapterNumber}: "${outline.title}"
POV Character: ${outline.povCharacter}
Setting: ${outline.setting}
Purpose: ${outline.purpose}
Target: ~${outline.targetWords} words

SCENE BEATS (follow in order):
${outline.scenes.map((s, i) => `${i + 1}. ${s.description}
   Characters: ${s.characters.join(", ")}
   Emotional shift: ${s.emotionalShift}`).join("\n\n")}

CHARACTER PROFILES:
${relevantChars.map(c => `${c.name} (${c.role}):
  Speech pattern: ${c.speechPattern}
  Traits: ${c.traits.join(", ")}
  Goals: ${c.goals}
  Fears: ${c.fears}`).join("\n\n")}`

  if (charStates.length > 0) {
    ctx += `\n\nCHARACTER STATES (as of end of previous chapter):
${charStates.map(cs => `${cs.characterId}:
  Location: ${cs.location}
  Emotional state: ${cs.emotionalState}
  Knows: ${cs.knows.join("; ")}
  Doesn't know: ${cs.doesNotKnow.join("; ")}`).join("\n\n")}`
  }

  if (relevantLocations.length > 0) {
    ctx += `\n\nSETTING DETAILS:
${relevantLocations.map(l => `${l.name}: ${l.description}`).join("\n")}`
  }

  ctx += `\n\nWORLD RULES:
${worldBible.rules.map(r => `- ${r}`).join("\n")}`

  if (recentSummaries.length > 0) {
    ctx += `\n\nPREVIOUS CHAPTERS:
${recentSummaries.map(s => `Chapter ${s.chapterNumber}: ${s.summary}`).join("\n\n")}`
  }

  if (openIssues.length > 0) {
    ctx += `\n\nISSUES TO ADDRESS:
${openIssues.map(i => `- [${i.severity}] ${i.description}`).join("\n")}`
  }

  return ctx
}

// ── Continuity Context ─────────────────────────────────────────────────────

export function buildContinuityContext(
  draft: string,
  facts: Fact[],
  charStates: CharacterState[],
): string {
  let ctx = `CHAPTER DRAFT:\n${draft}\n\n`

  if (facts.length > 0) {
    ctx += `ESTABLISHED FACTS:\n${facts.map(f => `- [ch${f.establishedInChapter}] [${f.category}] ${f.fact}`).join("\n")}\n\n`
  }

  if (charStates.length > 0) {
    ctx += `CHARACTER STATES (as of previous chapter):\n${charStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")}\n\n`
  }

  ctx += `Check this chapter draft for continuity issues against the established facts and character states. Report any contradictions, impossibilities, or inconsistencies.`

  return ctx
}

// ── State Update Contexts ──────────────────────────────────────────────────

export function buildSummaryContext(draft: string): string {
  return `CHAPTER TEXT:\n${draft}\n\nSummarize this chapter for use as context in future chapters.`
}

export function buildFactExtractionContext(draft: string): string {
  return `CHAPTER TEXT:\n${draft}\n\nExtract all concrete, specific facts established in this chapter.`
}

export function buildCharacterStateContext(draft: string, characters: CharacterProfile[]): string {
  const charNames = characters.map(c => c.name).join(", ")
  return `CHAPTER TEXT:\n${draft}\n\nCharacters who may appear: ${charNames}\n\nFor each character who appeared, describe their state at the END of this chapter.`
}
