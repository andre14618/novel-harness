/**
 * Regex-based lint pattern detector.
 *
 * Reads patterns from the lint_patterns DB table and matches them
 * against prose text. Dialogue-aware (skips matches inside quotes
 * unless the pattern allows it).
 */

import db from "../../../data/connection"
import { ensureLintPatterns } from "../../../data/db"
import type { LintIssue, LintPattern } from "../types"

// ── Dialogue awareness ─────────────────────────────────────────────────

function isInDialogue(text: string, position: number): boolean {
  let inQuote = false
  for (let i = 0; i < position && i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === '\u201C' || ch === '\u201D') {
      if (ch === '\u201C') inQuote = true
      else if (ch === '\u201D') inQuote = false
      else inQuote = !inQuote
    }
  }
  return inQuote
}

// ── Sentence extraction ────────────────────────────────────────────────

function getSentenceAt(text: string, position: number): string {
  let start = position
  while (start > 0 && text[start - 1] !== '.' && text[start - 1] !== '!' && text[start - 1] !== '?' && text[start - 1] !== '\n') {
    start--
  }
  let end = position
  while (end < text.length && text[end] !== '.' && text[end] !== '!' && text[end] !== '?' && text[end] !== '\n') {
    end++
  }
  if (end < text.length) end++
  return text.slice(start, end).trim()
}

// ── Pattern loading ────────────────────────────────────────────────────

export async function getEnabledPatterns(tier?: number): Promise<LintPattern[]> {
  await ensureLintPatterns()
  if (tier !== undefined) {
    return await db`
      SELECT * FROM lint_patterns WHERE enabled = true AND tier = ${tier} ORDER BY category, id
    ` as LintPattern[]
  }
  return await db`
    SELECT * FROM lint_patterns WHERE enabled = true ORDER BY tier, category, id
  ` as LintPattern[]
}

// ── Main regex detector ────────────────────────────────────────────────

export async function detectRegexPatterns(prose: string, tier?: number): Promise<LintIssue[]> {
  const patterns = await getEnabledPatterns(tier)
  const issues: LintIssue[] = []

  for (const pat of patterns) {
    if (pat.pattern === "-- heuristic --") continue
    const regex = new RegExp(pat.pattern, pat.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(prose)) !== null) {
      const pos = match.index
      if (!pat.dialogue_ok && isInDialogue(prose, pos)) continue

      issues.push({
        patternId: pat.id,
        charOffset: pos,
        category: pat.category,
        match: match[0],
        sentence: getSentenceAt(prose, pos),
        fixTemplate: pat.fix_template,
      })
    }
  }

  return issues
}
