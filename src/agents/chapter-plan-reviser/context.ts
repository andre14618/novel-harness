import type { ChapterOutline } from "../../types"

function skeletonBlocks(outline: ChapterOutline, currentProse: string): string[] {
  const scenesJson = JSON.stringify(outline.scenes, null, 2)
  const estJson = JSON.stringify(outline.establishedFacts ?? [], null, 2)
  const csJson = JSON.stringify(outline.characterStateChanges ?? [], null, 2)
  const kcJson = JSON.stringify(outline.knowledgeChanges ?? [], null, 2)
  const wordCount = currentProse.split(/\s+/).filter(Boolean).length
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
    `CURRENT PROSE (best draft so far, ${wordCount} words vs target ${outline.targetWords}):`,
    `---`,
    currentProse.slice(0, 8000),
    `---`,
    ``,
  ]
}

/**
 * Build the user prompt for chapter-plan-reviser on the plan-check escalation
 * path — original plan + current prose + persistent unresolved issues from the
 * chapter-plan-checker. The reviser emits the smallest plan edit that
 * eliminates the issues.
 */
export function buildContext(
  outline: ChapterOutline,
  currentProse: string,
  unresolvedIssues: string[],
): string {
  return [
    ...skeletonBlocks(outline, currentProse),
    `PERSISTENT UNRESOLVED ISSUES (the checker keeps flagging these despite targeted beat rewrites):`,
    unresolvedIssues.map(i => `- ${i}`).join("\n"),
    ``,
    `Revise the scenes list to make these issues satisfiable. Make the smallest change. Preserve establishedFacts/characterStateChanges/knowledgeChanges unless the revision specifically requires changing them.`,
  ].join("\n")
}

/**
 * Build the user prompt for chapter-plan-reviser on the validation escalation
 * path — original plan + current prose + persistent validation blockers
 * (for example POV-missing) that survived the validation settle
 * loop. Adds structural guidance keyed off the blocker shape because
 * validation blockers are deterministic chapter-shape facts, not LLM-judgment
 * deviations — the system prompt's failure-mode catalog doesn't cover
 * "whole chapter is too short" so the hint has to come via context.
 */
export function buildContextForValidation(
  outline: ChapterOutline,
  currentProse: string,
  validationBlockers: string[],
): string {
  const hasWordCount = validationBlockers.some(b =>
    b.includes("too short") || b.includes("far below target"),
  )
  const hasPovMissing = validationBlockers.some(b =>
    b.startsWith("POV character") && b.includes("never mentioned"),
  )
  const hints: string[] = []
  if (hasWordCount) {
    hints.push(
      `Word-count shortfall: targeted beat expansion already ran and could not reach the target. The beat list is likely too sparse — split a high-density beat into 2 simpler beats, OR add 1-2 new beats that deepen existing material (interiority, description, or a dialogue exchange implied by the surrounding beats).`,
    )
  }
  if (hasPovMissing) {
    hints.push(
      `POV missing: ${outline.povCharacter} is cast in the plan but does not appear on the page. Per §5 of the system prompt, place ${outline.povCharacter} into at least one beat as observer or active participant, or remove them from beats where they should not appear.`,
    )
  }

  return [
    ...skeletonBlocks(outline, currentProse),
    `PERSISTENT UNRESOLVED VALIDATION BLOCKERS (deterministic checks that keep failing despite targeted beat rewrites):`,
    validationBlockers.map(b => `- ${b}`).join("\n"),
    ``,
    ...(hints.length > 0 ? [`GUIDANCE:`, hints.map(h => `- ${h}`).join("\n"), ``] : []),
    `Revise the scenes list to make these blockers satisfiable. Make the smallest change. Preserve establishedFacts/characterStateChanges/knowledgeChanges unless the revision specifically requires changing them.`,
  ].join("\n")
}
