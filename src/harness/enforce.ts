/**
 * Deterministic enforcement layer.
 *
 * Structural guarantees the code enforces regardless of LLM output.
 * These are not suggestions — they are hard constraints. If the LLM
 * can't meet them, the pipeline stops with a clear error.
 *
 * Principle: code owns structure, LLM owns creativity.
 */

import type { CharacterProfile, ChapterOutline } from "../types"

// ── Planning Phase ────────────────────────────────────────────────────────

export interface PlanningEnforcement {
  valid: boolean
  chapters: ChapterOutline[]
  errors: string[]
  warnings: string[]
}

/**
 * Enforce chapter count and structural requirements on planner output.
 * Returns validated chapters or errors explaining what failed.
 */
export function enforcePlanningOutput(
  chapters: ChapterOutline[],
  targetChapters: number | null,
  characters: CharacterProfile[],
): PlanningEnforcement {
  const errors: string[] = []
  const warnings: string[] = []
  const charNames = new Set(characters.map(c => c.name.toLowerCase()))

  // Enforce chapter count
  if (targetChapters) {
    if (chapters.length < targetChapters) {
      errors.push(`Need ${targetChapters} chapters, got ${chapters.length}`)
    } else if (chapters.length > targetChapters) {
      warnings.push(`Trimming ${chapters.length} chapters to ${targetChapters}`)
      chapters = chapters.slice(0, targetChapters)
    }
  }

  // Enforce sequential numbering
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].chapterNumber = i + 1
  }

  // Enforce every chapter has a POV character that exists
  for (const ch of chapters) {
    if (!ch.povCharacter) {
      errors.push(`Chapter ${ch.chapterNumber} has no POV character`)
    } else if (!charNames.has(ch.povCharacter.toLowerCase())) {
      warnings.push(`Chapter ${ch.chapterNumber} POV "${ch.povCharacter}" not in character list`)
    }
  }

  // Enforce every chapter has at least one scene beat
  for (const ch of chapters) {
    if (!ch.scenes || ch.scenes.length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no scene beats`)
    }
  }

  // Enforce every chapter has a setting
  for (const ch of chapters) {
    if (!ch.setting || ch.setting.trim().length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no setting`)
    }
  }

  return { valid: errors.length === 0, chapters, errors, warnings }
}

// ── Extraction Phase ──────────────────────────────────────────────────────

export interface ExtractionEnforcement {
  warnings: string[]
}

/**
 * Validate extraction completeness. Logs warnings for missing data
 * but doesn't block — extraction is best-effort with visibility.
 */
export function enforceExtractionCompleteness(
  chapterNum: number,
  outlineCharacters: string[],
  extractedCharNames: string[],
  factCount: number,
  hasSummary: boolean,
): ExtractionEnforcement {
  const warnings: string[] = []

  if (!hasSummary) {
    warnings.push(`Chapter ${chapterNum}: no summary extracted`)
  }

  if (factCount === 0) {
    warnings.push(`Chapter ${chapterNum}: zero facts extracted`)
  }

  // Check that all characters in the outline got state extracted
  const extractedLower = new Set(extractedCharNames.map(n => n.toLowerCase()))
  for (const name of outlineCharacters) {
    if (!extractedLower.has(name.toLowerCase())) {
      warnings.push(`Chapter ${chapterNum}: no state extracted for "${name}"`)
    }
  }

  return { warnings }
}

/**
 * Fuzzy match a name from LLM output to known characters.
 * Returns the character or null with a warning message.
 */
export function matchCharacter(
  llmName: string,
  characters: CharacterProfile[],
): { char: CharacterProfile | null; warning: string | null } {
  // Exact match (case-insensitive)
  const exact = characters.find(c => c.name.toLowerCase() === llmName.toLowerCase())
  if (exact) return { char: exact, warning: null }

  // Partial match — LLM might return "Nadia Kovacs" when character is "Nadia"
  const partial = characters.find(c =>
    llmName.toLowerCase().includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().includes(llmName.toLowerCase())
  )
  if (partial) return { char: partial, warning: `Fuzzy matched "${llmName}" → "${partial.name}"` }

  return { char: null, warning: `No character match for "${llmName}"` }
}

// ── Draft Validation ──────────────────────────────────────────────────────

export interface DraftEnforcement {
  valid: boolean
  blockers: string[]
  warnings: string[]
}

/**
 * Hard structural requirements for a chapter draft.
 * These block the chapter from being approved.
 */
export function enforceDraftRequirements(
  prose: string,
  outline: ChapterOutline,
  characters: CharacterProfile[],
): DraftEnforcement {
  const blockers: string[] = []
  const warnings: string[] = []
  const wordCount = prose.split(/\s+/).filter(Boolean).length
  const proseLower = prose.toLowerCase()

  // Hard minimum word count
  if (wordCount < 500) {
    blockers.push(`${wordCount} words — minimum 500 required`)
  }

  // POV character must appear in the text
  if (outline.povCharacter) {
    if (!proseLower.includes(outline.povCharacter.toLowerCase())) {
      blockers.push(`POV character "${outline.povCharacter}" not found in prose`)
    }
  }

  // Must contain dialogue (at least one quoted line)
  const dialogueMatch = prose.match(/[""][^""]+[""]|'[^']+'/g)
  if (!dialogueMatch || dialogueMatch.length === 0) {
    blockers.push("No dialogue found — every chapter needs spoken dialogue")
  }

  // Target word count check (warning, not blocker)
  if (outline.targetWords && wordCount < outline.targetWords * 0.5) {
    blockers.push(`${wordCount} words is less than 50% of target ${outline.targetWords}`)
  } else if (outline.targetWords && wordCount < outline.targetWords * 0.7) {
    warnings.push(`${wordCount} words (${Math.round(wordCount / outline.targetWords * 100)}% of target ${outline.targetWords})`)
  }

  // Characters present should appear
  for (const name of outline.charactersPresent ?? []) {
    if (!proseLower.includes(name.toLowerCase())) {
      warnings.push(`Listed character "${name}" not found in prose`)
    }
  }

  return { valid: blockers.length === 0, blockers, warnings }
}
