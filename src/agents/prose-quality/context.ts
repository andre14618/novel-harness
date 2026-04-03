import { getChapterOutline, getCharacters } from "../../db"

export function buildContext(prose: string, chapterNum: number, novelId?: string): string {
  let ctx = `CHAPTER ${chapterNum} DRAFT:\n${prose}\n\n`

  if (novelId) {
    try {
      const outline = getChapterOutline(novelId, chapterNum)
      const allChars = getCharacters(novelId)
      const chapterCharNames = outline.charactersPresent.map(n => n.toLowerCase())
      const relevantChars = allChars.filter(c => chapterCharNames.includes(c.name.toLowerCase()))

      const voiceEntries = relevantChars
        .filter(c => c.speechPattern)
        .map(c => `${c.name}: "${c.speechPattern}"`)

      if (voiceEntries.length > 0) {
        ctx += `CHARACTER VOICE PROFILES (flag dialogue that doesn't match):\n${voiceEntries.join("\n")}\n\n`
      }
    } catch {}
  }

  ctx += "Review this chapter for show-don't-tell violations and cliché usage. Return the most impactful issues."
  return ctx
}

export const buildProseQualityContext = buildContext
