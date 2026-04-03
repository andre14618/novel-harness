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

import db from "../../data/connection"
import { ensureLintPatterns } from "../../data/db"

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

async function getEnabledPatterns(tier?: number): Promise<LintPattern[]> {
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

// ── Main linter ────────────────────────────────────────────────────────

export async function lintProse(prose: string, tier?: number): Promise<LintResult> {
  const patterns = await getEnabledPatterns(tier)
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

export async function saveLintIssues(generationId: number, issues: LintIssue[]): Promise<void> {
  for (const issue of issues) {
    await db`
      INSERT INTO lint_issues (generation_id, pattern_id, char_offset, match, sentence)
      VALUES (${generationId}, ${issue.patternId}, ${issue.charOffset}, ${issue.match}, ${issue.sentence})
    `
  }
}

export async function getLintIssues(generationId: number) {
  return await db`
    SELECT li.id, li.char_offset as "charOffset", li.match, li.sentence,
           li.resolved, li.rewrite_result as "rewriteResult",
           lp.id as "patternId", lp.category, lp.fix_template as "fixTemplate",
           lp.rationale, lp.edge_cases as "edgeCases"
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    WHERE li.generation_id = ${generationId}
    ORDER BY li.char_offset
  `
}

export async function getLintSummary(runId: number): Promise<{ category: string; count: number }[]> {
  return await db`
    SELECT lp.category, COUNT(*) as count
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    WHERE g.run_id = ${runId}
    GROUP BY lp.category
    ORDER BY count DESC
  ` as { category: string; count: number }[]
}

/** Lint all generations for a run and persist results. Clears previous lint data for the run. */
export async function lintRun(runId: number): Promise<{ generationId: number; seed: string; result: LintResult }[]> {
  // Clear previous lint results for this run
  await db`
    DELETE FROM lint_issues WHERE generation_id IN (
      SELECT id FROM generations WHERE run_id = ${runId}
    )
  `

  const gens = await db`
    SELECT id, seed, prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt
  ` as { id: number; seed: string; prose: string }[]

  const results: { generationId: number; seed: string; result: LintResult }[] = []

  for (const gen of gens) {
    const result = await lintProse(gen.prose)
    await saveLintIssues(gen.id, result.issues)
    results.push({ generationId: gen.id, seed: gen.seed, result })
  }

  return results
}

// ── Pattern management ─────────────────────────────────────────────────

export async function listPatterns(tier?: number): Promise<LintPattern[]> {
  return getEnabledPatterns(tier)
}

export async function togglePattern(patternId: number, enabled: boolean): Promise<void> {
  await db`UPDATE lint_patterns SET enabled = ${enabled} WHERE id = ${patternId}`
}

export async function getPatternStats(runId?: number) {
  if (runId !== undefined) {
    return await db`
      SELECT lp.id, lp.category, lp.pattern, lp.fix_template,
             COUNT(li.id) as hit_count,
             SUM(CASE WHEN li.resolved = 2 THEN 1 ELSE 0 END) as skip_count
      FROM lint_patterns lp
      LEFT JOIN lint_issues li ON li.pattern_id = lp.id
      LEFT JOIN generations g ON g.id = li.generation_id
      WHERE g.run_id = ${runId}
      GROUP BY lp.id
      ORDER BY hit_count DESC
    `
  }
  return await db`
    SELECT lp.id, lp.category, lp.pattern, lp.fix_template,
           COUNT(li.id) as hit_count,
           SUM(CASE WHEN li.resolved = 2 THEN 1 ELSE 0 END) as skip_count
    FROM lint_patterns lp
    LEFT JOIN lint_issues li ON li.pattern_id = lp.id
    GROUP BY lp.id
    ORDER BY hit_count DESC
  `
}
