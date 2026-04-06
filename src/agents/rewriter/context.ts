import type { ContinuityIssue } from "../../schemas/shared"
import { getApprovedDraft, getChapterOutline, getStorySpine } from "../../db"

export async function buildContext(novelId: string, chapterNum: number, issues: ContinuityIssue[]): Promise<string> {
  const draft = await getApprovedDraft(novelId, chapterNum)
  if (!draft) throw new Error(`No approved draft for chapter ${chapterNum}`)

  const outline = await getChapterOutline(novelId, chapterNum)

  let ctx = `CHAPTER ${chapterNum}: "${outline.title}"\n`
  ctx += `POV: ${outline.povCharacter}\n`
  ctx += `Target: ~${outline.targetWords} words\n`

  try {
    const spine = await getStorySpine(novelId)
    if (spine.theme) ctx += `Theme: ${spine.theme}\n`
  } catch {}

  ctx += "\nISSUES TO FIX:\n"
  ctx += issues.map((issue, i) =>
    `${i + 1}. [${issue.severity}] ${issue.description}${issue.suggestedFix ? ` — ${issue.suggestedFix}` : ""}`
  ).join("\n")

  ctx += `\n\nSCENE BEATS (maintain these):\n`
  ctx += outline.scenes.map((s, i) => `${i + 1}. ${s.description}`).join("\n")

  ctx += `\n\nORIGINAL DRAFT:\n${draft.prose}\n`

  return ctx
}

export const buildRewriterContext = buildContext
