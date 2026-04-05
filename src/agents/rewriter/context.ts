import type { ContinuityIssue } from "../../schemas/shared"
import {
  getApprovedDraft, getChapterOutline, getFactsUpToChapter,
  getCharacterStatesAtChapter, getStorySpine,
} from "../../db"

export async function buildContext(novelId: string, chapterNum: number, issues: ContinuityIssue[]): Promise<string> {
  const draft = await getApprovedDraft(novelId, chapterNum)
  if (!draft) throw new Error(`No approved draft for chapter ${chapterNum}`)

  const outline = await getChapterOutline(novelId, chapterNum)
  const facts = await getFactsUpToChapter(novelId, chapterNum)
  const charStates = await getCharacterStatesAtChapter(novelId, chapterNum)

  let ctx = `CHAPTER ${chapterNum}: "${outline.title}"\n`
  ctx += `POV: ${outline.povCharacter}\n`
  ctx += `Target: ~${outline.targetWords} words\n`

  try {
    const spine = await getStorySpine(novelId)
    if (spine.theme) ctx += `Theme: ${spine.theme} — preserve and reinforce thematic resonance in rewrites\n`
  } catch {}

  ctx += "\n"

  ctx += "ISSUES TO FIX:\n"
  ctx += issues.map((issue, i) =>
    `${i + 1}. [${issue.severity}] ${issue.description}${issue.suggestedFix ? ` — Suggested fix: ${issue.suggestedFix}` : ""}`
  ).join("\n")

  ctx += `\n\nSCENE BEATS (maintain these):\n`
  ctx += outline.scenes.map((s, i) => `${i + 1}. ${s.description}`).join("\n")

  ctx += `\n\nORIGINAL DRAFT:\n${draft.prose}\n\n`

  if (facts.length > 0) {
    ctx += "ESTABLISHED FACTS (must not contradict):\n"
    ctx += facts.map(f => `- [ch${f.establishedInChapter}] ${f.fact}`).join("\n")
    ctx += "\n\n"
  }

  if (charStates.length > 0) {
    ctx += "CHARACTER STATES (entering this chapter):\n"
    ctx += charStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")
    ctx += "\n"
  }

  return ctx
}

export const buildRewriterContext = buildContext
