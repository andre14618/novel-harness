import type { ChapterOutline } from "../../types"

/**
 * Build the user prompt for chapter-plan-reviser — original plan + current
 * prose + persistent unresolved issues. The reviser uses these to emit the
 * smallest plan edit that eliminates the issues.
 */
export function buildContext(
  outline: ChapterOutline,
  currentProse: string,
  unresolvedIssues: string[],
): string {
  const scenesJson = JSON.stringify(outline.scenes, null, 2)
  const estJson = JSON.stringify(outline.establishedFacts ?? [], null, 2)
  const csJson = JSON.stringify(outline.characterStateChanges ?? [], null, 2)
  const kcJson = JSON.stringify(outline.knowledgeChanges ?? [], null, 2)

  return [
    `CHAPTER: ${outline.chapterNumber} — "${outline.title}"`,
    `POV: ${outline.povCharacter}`,
    `SETTING: ${outline.setting}`,
    `PURPOSE: ${outline.purpose}`,
    `TARGET WORDS: ${outline.targetWords}`,
    ``,
    `ORIGINAL BEATS (scenes):`,
    scenesJson,
    ``,
    `ORIGINAL establishedFacts:`,
    estJson,
    ``,
    `ORIGINAL characterStateChanges:`,
    csJson,
    ``,
    `ORIGINAL knowledgeChanges:`,
    kcJson,
    ``,
    `CURRENT PROSE (best draft so far, ${currentProse.split(/\s+/).filter(Boolean).length} words):`,
    `---`,
    currentProse.slice(0, 8000),
    `---`,
    ``,
    `PERSISTENT UNRESOLVED ISSUES (the checker keeps flagging these despite targeted beat rewrites):`,
    unresolvedIssues.map(i => `- ${i}`).join("\n"),
    ``,
    `Revise the scenes list to make these issues satisfiable. Make the smallest change. Preserve establishedFacts/characterStateChanges/knowledgeChanges unless the revision specifically requires changing them.`,
  ].join("\n")
}
