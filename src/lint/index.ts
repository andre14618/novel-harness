/**
 * Lint system — main entry point.
 *
 * Orchestrates three detector types:
 *   1. Regex patterns (from lint_patterns DB table)
 *   2. Emotional echo (cross-sentence heuristic)
 *   3. Rhythm/paragraph heuristics (statistical windowing)
 *
 * Re-exports types and DB persistence for external consumers.
 */

import db from "../db/connection"
import { detectRegexPatterns, getEnabledPatterns } from "./detectors/regex"
import { lintEmotionalEcho } from "./detectors/emotional-echo"
import { lintRhythm, DEFAULT_RHYTHM_CONFIG, type RhythmConfig } from "./detectors/rhythm"
import type { LintIssue, LintResult, LintPattern } from "./types"

// Re-export types
export type { LintIssue, LintResult, LintPattern }

// ── Heuristic pattern IDs (synthetic rows in lint_patterns) ───────────

let heuristicIds: { emotionalEcho: number; rhythmMonotony: number; paragraphHomogeneity: number } | null = null

async function getHeuristicPatternIds() {
  if (heuristicIds) return heuristicIds

  const categories = [
    { category: "EMOTIONAL_ECHO", fixTemplate: "Physical detail already shows the emotion. Cut the label unless it adds analytical depth." },
    { category: "RHYTHM_MONOTONY", fixTemplate: "Prose rhythm is too uniform. Vary sentence length and structure." },
    { category: "PARAGRAPH_HOMOGENEITY", fixTemplate: "Paragraph structure is too uniform. Vary paragraph length and openings." },
  ]

  const ids: Record<string, number> = {}
  for (const c of categories) {
    const existing = await db`
      SELECT id FROM lint_patterns WHERE category = ${c.category} AND pattern = '-- heuristic --' LIMIT 1
    `
    if (existing.length > 0) {
      ids[c.category] = (existing[0] as any).id
    } else {
      const [row] = await db`
        INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale)
        VALUES (3, ${c.category}, '-- heuristic --', '', ${c.fixTemplate}, false, true, 'Heuristic detector, not regex-based')
        RETURNING id
      `
      ids[c.category] = (row as any).id
    }
  }

  heuristicIds = {
    emotionalEcho: ids["EMOTIONAL_ECHO"],
    rhythmMonotony: ids["RHYTHM_MONOTONY"],
    paragraphHomogeneity: ids["PARAGRAPH_HOMOGENEITY"],
  }
  return heuristicIds
}

// ── Main linter ────────────────────────────────────────────────────────

export async function lintProse(prose: string, tier?: number, rhythmConfig?: RhythmConfig): Promise<LintResult> {
  // Run all detectors
  const regexIssues = await detectRegexPatterns(prose, tier)

  const hIds = await getHeuristicPatternIds()
  const echoIssues = lintEmotionalEcho(prose, hIds.emotionalEcho)
  const rhythmIssues = lintRhythm(
    prose,
    { rhythmMonotony: hIds.rhythmMonotony, paragraphHomogeneity: hIds.paragraphHomogeneity },
    rhythmConfig ?? DEFAULT_RHYTHM_CONFIG,
  )

  // Combine and sort
  const issues = [...regexIssues, ...echoIssues, ...rhythmIssues]
    .sort((a, b) => a.charOffset - b.charOffset)

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

export async function lintRun(runId: number): Promise<{ generationId: number; seed: string; result: LintResult }[]> {
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
