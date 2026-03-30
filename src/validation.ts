import type { ChapterOutline, ValidationResult } from "./types"

export function validateChapterDraft(draft: string, outline: ChapterOutline): ValidationResult {
  const blockers: string[] = []
  const warnings: string[] = []

  const wordCount = draft.split(/\s+/).filter(Boolean).length

  // Word count checks
  if (wordCount < 500) {
    blockers.push(`Chapter too short: ${wordCount} words (minimum 500)`)
  } else if (wordCount < outline.targetWords * 0.5) {
    blockers.push(`Chapter far below target: ${wordCount} words (target: ${outline.targetWords})`)
  } else if (wordCount < outline.targetWords * 0.7) {
    warnings.push(`Chapter below target: ${wordCount} words (target: ${outline.targetWords})`)
  }

  if (wordCount > outline.targetWords * 2) {
    warnings.push(`Chapter very long: ${wordCount} words (target: ${outline.targetWords})`)
  }

  // POV character must appear
  const draftLower = draft.toLowerCase()
  if (!draftLower.includes(outline.povCharacter.toLowerCase())) {
    blockers.push(`POV character "${outline.povCharacter}" never mentioned in draft`)
  }

  // Check other characters are mentioned
  for (const charName of outline.charactersPresent) {
    if (!draftLower.includes(charName.toLowerCase())) {
      warnings.push(`Character "${charName}" listed but never mentioned`)
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
  }
}
