import {
  getChapterOutline, getCharacters, getWorldBible,
  getRecentSummaries, getCharacterStatesAtChapter, getOpenIssues,
} from "../../db"

export function buildContext(novelId: string, chapterNum: number): string {
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
  Carrying: ${cs.emotionalState} (show through behavior, NEVER state directly)
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

  // Craft reminders — deterministic context augmentation from character/outline data
  const povChar = relevantChars.find(c => c.name.toLowerCase() === outline.povCharacter.toLowerCase())
  ctx += `\n\nCRAFT REMINDERS:`
  if (povChar) {
    ctx += `\n- POV character speech pattern: "${povChar.speechPattern}" — maintain this in ALL their dialogue`
  }
  ctx += `\n- Show emotion through action and body language, NEVER through narrator statements`
  ctx += `\n- Any documents/letters in the scene must be written out for the reader, not summarized`
  ctx += `\n- Every scene needs spoken dialogue — characters interact, they don't just observe`

  return ctx
}

export const buildWriterContext = buildContext
