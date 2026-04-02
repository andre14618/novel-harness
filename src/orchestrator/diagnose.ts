/**
 * Automated diagnosis — finds the weakest benchmark dimension to improve.
 *
 * Extracted from .claude/commands/diagnose.md into code.
 * Queries local SQLite for scores, compares to baselines,
 * and selects the best improvement target.
 */

import { Database } from "bun:sqlite"
import db from "./db"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"
const HARNESS_DB = `${HARNESS_ROOT}/data/harness.db`

interface DiagnosisResult {
  target: string       // prose, planning, extraction, continuity
  dimension: string
  currentScore: number
  baselineScore: number | null
  delta: number | null  // negative = regression from baseline
  judgeReasoning: string[]
}

export async function diagnose(): Promise<DiagnosisResult | null> {
  let sqliteDb: Database
  try {
    sqliteDb = new Database(HARNESS_DB, { readonly: true })
  } catch {
    console.error("[diagnose] Cannot open harness DB at", HARNESS_DB)
    return null
  }

  try {
    const candidates = getDimensionScores(sqliteDb)
    if (candidates.length === 0) {
      console.log("[diagnose] No benchmark scores found")
      return null
    }

    // Filter out dimensions attempted in the last 6 hours
    const recentAttempts = await getRecentAttempts(6)
    const filtered = candidates.filter(c =>
      !recentAttempts.has(`${c.target}:${c.dimension}`)
    )

    // Fall back to all candidates if everything was recently attempted
    const pool = filtered.length > 0 ? filtered : candidates

    // Rank: prioritize regressions from baseline, then lowest absolute score
    pool.sort((a, b) => {
      // Regressions first (negative delta = worse than baseline)
      if (a.delta !== null && b.delta !== null) {
        if (a.delta < 0 && b.delta >= 0) return -1
        if (b.delta < 0 && a.delta >= 0) return 1
        if (a.delta < 0 && b.delta < 0) return a.delta - b.delta  // more negative first
      }
      // Then by absolute score (lower = more room for improvement)
      // For penalty benchmarks (prose), lower is better, so higher score = worse = prioritize
      return b.currentScore - a.currentScore
    })

    const best = pool[0]

    // Get judge reasoning for the weakest generations
    const reasoning = getJudgeReasoning(sqliteDb, best.target, best.dimension)

    return {
      ...best,
      judgeReasoning: reasoning,
    }
  } finally {
    sqliteDb.close()
  }
}

function getDimensionScores(sqliteDb: Database): Array<{
  target: string; dimension: string; currentScore: number;
  baselineScore: number | null; delta: number | null
}> {
  const results: Array<{
    target: string; dimension: string; currentScore: number;
    baselineScore: number | null; delta: number | null
  }> = []

  // Get latest run per benchmark type
  const benchmarkTypes = ["prose", "planning", "extraction", "continuity"]
  for (const runType of benchmarkTypes) {
    const latestRun = sqliteDb.query<any, [string]>(
      "SELECT id FROM runs WHERE run_type = ? ORDER BY id DESC LIMIT 1"
    ).get(runType)
    if (!latestRun) continue

    // Per-dimension averages for latest run
    const scores = sqliteDb.query<any, [number]>(`
      SELECT s.dimension, ROUND(AVG(s.score), 2) as avg_score
      FROM scores s JOIN generations g ON s.generation_id = g.id
      WHERE g.run_id = ? AND g.passed = 1
      GROUP BY s.dimension
    `).all(latestRun.id)

    // Baseline scores
    const baselineRun = sqliteDb.query<any, [string]>(
      "SELECT id FROM runs WHERE run_type = ? AND is_baseline = 1 ORDER BY id DESC LIMIT 1"
    ).get(runType)

    let baselineScores: Record<string, number> = {}
    if (baselineRun) {
      const bScores = sqliteDb.query<any, [number]>(`
        SELECT s.dimension, ROUND(AVG(s.score), 2) as avg_score
        FROM scores s JOIN generations g ON s.generation_id = g.id
        WHERE g.run_id = ? AND g.passed = 1
        GROUP BY s.dimension
      `).all(baselineRun.id)
      for (const s of bScores) baselineScores[s.dimension] = s.avg_score
    }

    for (const s of scores) {
      const baseline = baselineScores[s.dimension] ?? null
      results.push({
        target: runType,
        dimension: s.dimension,
        currentScore: s.avg_score,
        baselineScore: baseline,
        delta: baseline !== null ? s.avg_score - baseline : null,
      })
    }
  }

  return results
}

function getJudgeReasoning(sqliteDb: Database, target: string, dimension: string): string[] {
  const latestRun = sqliteDb.query<any, [string]>(
    "SELECT id FROM runs WHERE run_type = ? ORDER BY id DESC LIMIT 1"
  ).get(target)
  if (!latestRun) return []

  // Get weakest generations for this dimension
  const weakest = sqliteDb.query<any, [number, string]>(`
    SELECT g.id, s.reasoning
    FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND s.dimension = ? AND g.passed = 1 AND s.reasoning IS NOT NULL
    ORDER BY s.score DESC
    LIMIT 5
  `).all(latestRun.id, dimension)

  return weakest.map((w: any) => w.reasoning).filter(Boolean)
}

async function getRecentAttempts(hours: number): Promise<Set<string>> {
  const rows = await db`
    SELECT DISTINCT target, dimension FROM improvement_iterations
    WHERE started_at > now() - ${hours + ' hours'}::interval
  `
  return new Set((rows as any[]).map(r => `${r.target}:${r.dimension}`))
}
