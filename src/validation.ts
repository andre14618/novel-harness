import type { ChapterOutline, ValidationFinding, ValidationResult } from "./types"

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
  const findings: ValidationFinding[] = []
  const chapterRefs = {
    chapterNumber: outline.chapterNumber,
    ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
  }

  const addFinding = (
    severity: ValidationFinding["severity"],
    code: string,
    description: string,
    refs: Omit<ValidationFinding, "severity" | "code" | "description"> = {},
  ) => {
    findings.push({ severity, code, description, ...chapterRefs, ...refs })
    if (severity === "blocker") blockers.push(description)
    else warnings.push(description)
  }

  const wordCount = draft.split(/\s+/).filter(Boolean).length

  // Word count checks
  if (wordCount < 500) {
    addFinding("blocker", "word_count_min", `Chapter too short: ${wordCount} words (minimum 500)`, {
      metadata: { wordCount, minimumWords: 500 },
    })
  } else if (wordCount < outline.targetWords * 0.5) {
    addFinding("blocker", "word_count_far_below", `Chapter far below target: ${wordCount} words (target: ${outline.targetWords})`, {
      metadata: { wordCount, targetWords: outline.targetWords },
    })
  } else if (wordCount < outline.targetWords * 0.7) {
    addFinding("warning", "word_count_below_target", `Chapter below target: ${wordCount} words (target: ${outline.targetWords})`, {
      metadata: { wordCount, targetWords: outline.targetWords },
    })
  }

  if (wordCount > outline.targetWords * 2) {
    addFinding("warning", "word_count_very_long", `Chapter very long: ${wordCount} words (target: ${outline.targetWords})`, {
      metadata: { wordCount, targetWords: outline.targetWords },
    })
  }

  // POV character must appear (check full name and first name)
  const draftLower = draft.toLowerCase()
  if (!nameInDraft(outline.povCharacter, draftLower)) {
    addFinding("blocker", "pov_missing", `POV character "${outline.povCharacter}" never mentioned in draft`, {
      metadata: { povCharacter: outline.povCharacter },
    })
  }

  // Check other characters are mentioned
  for (const charName of outline.charactersPresent) {
    if (!nameInDraft(charName, draftLower)) {
      addFinding("warning", "character_missing", `Character "${charName}" listed but never mentioned`, {
        metadata: { characterName: charName },
      })
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
          addFinding("blocker", "beat_keyword_missing", `Scene beat ${i + 1} has no keyword matches — may be missing entirely`, {
            beatIndex: i,
            ...(beat.beatId ? { beatId: beat.beatId } : {}),
            metadata: { keywordCount: keywords.length },
          })
        } else if (ratio < 0.4) {
          addFinding("warning", "beat_keyword_low_coverage", `Scene beat ${i + 1} has low keyword coverage (${matched.length}/${keywords.length})`, {
            beatIndex: i,
            ...(beat.beatId ? { beatId: beat.beatId } : {}),
            metadata: { matchedKeywords: matched.length, keywordCount: keywords.length },
          })
        }
      }
    }

    // POV pronoun check — flag first-person "I" outside dialogue
    const nonDialogue = draft.replace(/"[^"]*"/g, "")
    const firstPersonCount = (nonDialogue.match(/\bI\b/g) ?? []).length
    if (firstPersonCount > 5) {
      addFinding("warning", "pov_first_person_possible", `Found ${firstPersonCount} first-person "I" outside dialogue — possible POV violation`, {
        metadata: { firstPersonCount },
      })
    }

    // Dialogue presence check
    const nonEmptyLines = draft.split("\n").filter(l => l.trim().length > 0)
    const dialogueLines = nonEmptyLines.filter(l => l.includes('"'))
    if (nonEmptyLines.length > 0) {
      const ratio = dialogueLines.length / nonEmptyLines.length
      if (dialogueLines.length === 0) {
        addFinding("warning", "dialogue_missing", "No dialogue found in chapter", {
          metadata: { nonEmptyLines: nonEmptyLines.length },
        })
      } else if (ratio > 0.7) {
        addFinding("warning", "dialogue_heavy", `Very dialogue-heavy: ${dialogueLines.length}/${nonEmptyLines.length} lines contain dialogue`, {
          metadata: { dialogueLines: dialogueLines.length, nonEmptyLines: nonEmptyLines.length },
        })
      }
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    findings,
  }
}
