import type { ChapterOutline, ValidationResult } from "./types"

function nameInDraft(name: string, draftLower: string): boolean {
  // Check full name and first name (handles "Davan Cole" matching "Davan")
  if (draftLower.includes(name.toLowerCase())) return true
  const firstName = name.split(/\s+/)[0]
  if (firstName && draftLower.includes(firstName.toLowerCase())) return true
  return false
}

export function validateChapterDraft(
  draft: string,
  outline: ChapterOutline,
  mode: "drafting" | "validation" = "drafting",
): ValidationResult {
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

  // POV character must appear (check full name and first name)
  const draftLower = draft.toLowerCase()
  if (!nameInDraft(outline.povCharacter, draftLower)) {
    blockers.push(`POV character "${outline.povCharacter}" never mentioned in draft`)
  }

  // Check other characters are mentioned
  for (const charName of outline.charactersPresent) {
    if (!nameInDraft(charName, draftLower)) {
      warnings.push(`Character "${charName}" listed but never mentioned`)
    }
  }

  // Validation-mode-only checks
  if (mode === "validation") {
    // Scene beat keyword coverage
    for (let i = 0; i < outline.scenes.length; i++) {
      const beat = outline.scenes[i]
      const keywords = beat.description
        .split(/\s+/)
        .map(w => w.toLowerCase().replace(/[^a-z]/g, ""))
        .filter(w => w.length > 4)

      if (keywords.length > 0) {
        const matched = keywords.filter(kw => draftLower.includes(kw))
        const ratio = matched.length / keywords.length

        if (matched.length === 0) {
          blockers.push(`Scene beat ${i + 1} has no keyword matches — may be missing entirely`)
        } else if (ratio < 0.4) {
          warnings.push(`Scene beat ${i + 1} has low keyword coverage (${matched.length}/${keywords.length})`)
        }
      }
    }

    // POV pronoun check — flag first-person "I" outside dialogue
    const nonDialogue = draft.replace(/"[^"]*"/g, "")
    const firstPersonCount = (nonDialogue.match(/\bI\b/g) ?? []).length
    if (firstPersonCount > 5) {
      warnings.push(`Found ${firstPersonCount} first-person "I" outside dialogue — possible POV violation`)
    }

    // Dialogue presence check
    const nonEmptyLines = draft.split("\n").filter(l => l.trim().length > 0)
    const dialogueLines = nonEmptyLines.filter(l => l.includes('"'))
    if (nonEmptyLines.length > 0) {
      const ratio = dialogueLines.length / nonEmptyLines.length
      if (dialogueLines.length === 0) {
        warnings.push("No dialogue found in chapter")
      } else if (ratio > 0.7) {
        warnings.push(`Very dialogue-heavy: ${dialogueLines.length}/${nonEmptyLines.length} lines contain dialogue`)
      }
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
  }
}
