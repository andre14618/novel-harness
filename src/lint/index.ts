/**
 * Deterministic prose flagger.
 *
 * Pure TypeScript — no LLM calls. Reads detection patterns from the
 * lint_patterns table and flags issues with sentence-level annotations.
 *
 * Designed to:
 *   1. Replace LLM penalty judges for high-confidence patterns (free)
 *   2. Feed targeted rewrite instructions to a cheap model
 */

import { getCentralDB } from "../../data/db"

// ── Types ──────────────────────────────────────────────────────────────

export interface LintPattern {
  id: number
  tier: number
  category: string
  pattern: string
  flags: string
  fix_template: string
  dialogue_ok: number
  enabled: number
  rationale: string | null
  edge_cases: string | null
}

export interface LintIssue {
  patternId: number
  charOffset: number
  category: string
  match: string
  sentence: string
  fixTemplate: string
}

export interface LintResult {
  issues: LintIssue[]
  counts: Record<string, number>
  totalIssues: number
}

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

function getEnabledPatterns(tier?: number): LintPattern[] {
  const db = getCentralDB()
  if (tier !== undefined) {
    return db.query(
      "SELECT * FROM lint_patterns WHERE enabled = 1 AND tier = ? ORDER BY category, id"
    ).all(tier) as LintPattern[]
  }
  return db.query(
    "SELECT * FROM lint_patterns WHERE enabled = 1 ORDER BY tier, category, id"
  ).all() as LintPattern[]
}

// ── Main linter ────────────────────────────────────────────────────────

export function lintProse(prose: string, tier?: number): LintResult {
  const patterns = getEnabledPatterns(tier)
  const issues: LintIssue[] = []

  for (const pat of patterns) {
    const regex = new RegExp(pat.pattern, pat.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(prose)) !== null) {
      const pos = match.index

      // Skip matches inside dialogue unless pattern allows it
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

  issues.sort((a, b) => a.charOffset - b.charOffset)

  const counts: Record<string, number> = {}
  for (const issue of issues) {
    counts[issue.category] = (counts[issue.category] || 0) + 1
  }

  return { issues, counts, totalIssues: issues.length }
}

// ── DB persistence ─────────────────────────────────────────────────────

export function saveLintIssues(generationId: number, issues: LintIssue[]): void {
  const db = getCentralDB()
  const stmt = db.prepare(
    `INSERT INTO lint_issues (generation_id, pattern_id, char_offset, match, sentence)
     VALUES (?, ?, ?, ?, ?)`
  )
  for (const issue of issues) {
    stmt.run(generationId, issue.patternId, issue.charOffset, issue.match, issue.sentence)
  }
}

export function getLintIssues(generationId: number) {
  const db = getCentralDB()
  return db.query(`
    SELECT li.id, li.char_offset as charOffset, li.match, li.sentence,
           li.resolved, li.rewrite_result as rewriteResult,
           lp.id as patternId, lp.category, lp.fix_template as fixTemplate,
           lp.rationale, lp.edge_cases as edgeCases
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    WHERE li.generation_id = ?
    ORDER BY li.char_offset
  `).all(generationId)
}

export function getLintSummary(runId: number): { category: string; count: number }[] {
  const db = getCentralDB()
  return db.query(`
    SELECT lp.category, COUNT(*) as count
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    WHERE g.run_id = ?
    GROUP BY lp.category
    ORDER BY count DESC
  `).all(runId) as any[]
}

/** Lint all generations for a run and persist results. Clears previous lint data for the run. */
export function lintRun(runId: number): { generationId: number; seed: string; result: LintResult }[] {
  const db = getCentralDB()

  // Clear previous lint results for this run
  db.run(`
    DELETE FROM lint_issues WHERE generation_id IN (
      SELECT id FROM generations WHERE run_id = ?
    )
  `, runId)

  const gens = db.query(
    "SELECT id, seed, prose FROM generations WHERE run_id = ? AND prose IS NOT NULL ORDER BY seed, attempt"
  ).all(runId) as { id: number; seed: string; prose: string }[]

  const results: { generationId: number; seed: string; result: LintResult }[] = []

  for (const gen of gens) {
    const result = lintProse(gen.prose)
    saveLintIssues(gen.id, result.issues)
    results.push({ generationId: gen.id, seed: gen.seed, result })
  }

  return results
}

// ── Pattern management ─────────────────────────────────────────────────

export function listPatterns(tier?: number): LintPattern[] {
  return getEnabledPatterns(tier)
}

export function togglePattern(patternId: number, enabled: boolean): void {
  const db = getCentralDB()
  db.run("UPDATE lint_patterns SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, patternId])
}

export function getPatternStats(runId?: number) {
  const db = getCentralDB()
  const where = runId
    ? "WHERE g.run_id = ?"
    : ""
  const params = runId ? [runId] : []
  return db.query(`
    SELECT lp.id, lp.category, lp.pattern, lp.fix_template,
           COUNT(li.id) as hit_count,
           SUM(CASE WHEN li.resolved = 2 THEN 1 ELSE 0 END) as skip_count
    FROM lint_patterns lp
    LEFT JOIN lint_issues li ON li.pattern_id = lp.id
    ${runId ? "LEFT JOIN generations g ON g.id = li.generation_id" : ""}
    ${where}
    GROUP BY lp.id
    ORDER BY hit_count DESC
  `).all(...params)
}
