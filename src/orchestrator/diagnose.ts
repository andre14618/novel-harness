/**
 * Automated diagnosis — finds the weakest benchmark dimension to improve.
 *
 * Extracted from .claude/commands/diagnose.md into code.
 * Queries Postgres harness tables for scores, compares to baselines,
 * and selects the best improvement target.
 */

import harnessDb from "../../data/connection"
import orchDb from "./db"
import { BENCHMARKS } from "../../benchmark/registry"

interface DiagnosisResult {
  target: string       // prose, planning, extraction, continuity
  dimension: string
  currentScore: number
  baselineScore: number | null
  delta: number | null  // negative = regression from baseline
  judgeReasoning: string[]
}

export async function diagnose(): Promise<DiagnosisResult | null> {
  const candidates = await getDimensionScores()
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

  // Rank: prioritize regressions from baseline, then worst absolute score.
  // All scores are higher=better (penalty scores are negated at extraction).
  pool.sort((a, b) => {
    // Regressions first (negative delta = worse than baseline)
    if (a.delta !== null && b.delta !== null) {
      if (a.delta < 0 && b.delta >= 0) return -1
      if (b.delta < 0 && a.delta >= 0) return 1
      if (a.delta < 0 && b.delta < 0) return a.delta - b.delta  // more negative first
    }
    // Lowest score = worst = highest priority
    return a.currentScore - b.currentScore
  })

  const best = pool[0]

  // Get judge reasoning for the weakest generations
  const reasoning = await getJudgeReasoning(best.target, best.dimension)

  return {
    ...best,
    judgeReasoning: reasoning,
  }
}

async function getDimensionScores(): Promise<Array<{
  target: string; dimension: string; currentScore: number;
  baselineScore: number | null; delta: number | null
}>> {
  const results: Array<{
    target: string; dimension: string; currentScore: number;
    baselineScore: number | null; delta: number | null
  }> = []

  // Get latest run per benchmark type (derived from registry, not hardcoded)
  const benchmarkTypes = Object.keys(BENCHMARKS)
  for (const runType of benchmarkTypes) {
    const latestRuns = await harnessDb`
      SELECT id FROM runs WHERE run_type = ${runType} ORDER BY id DESC LIMIT 1
    ` as any[]
    if (latestRuns.length === 0) continue
    const latestRun = latestRuns[0]

    // Per-dimension averages for latest run
    const scores = await harnessDb`
      SELECT s.dimension, ROUND(AVG(s.score)::numeric, 2) as avg_score
      FROM scores s JOIN generations g ON s.generation_id = g.id
      WHERE g.run_id = ${latestRun.id} AND g.passed = true
      GROUP BY s.dimension
    ` as any[]

    // Baseline scores (baselines table tracks run_id per benchmark_type)
    const baselineRuns = await harnessDb`
      SELECT run_id as id FROM baselines WHERE benchmark_type = ${runType}
    ` as any[]

    let baselineScores: Record<string, number> = {}
    if (baselineRuns.length > 0) {
      const bScores = await harnessDb`
        SELECT s.dimension, ROUND(AVG(s.score)::numeric, 2) as avg_score
        FROM scores s JOIN generations g ON s.generation_id = g.id
        WHERE g.run_id = ${baselineRuns[0].id} AND g.passed = true
        GROUP BY s.dimension
      ` as any[]
      for (const s of bScores) baselineScores[s.dimension] = parseFloat(s.avg_score)
    }

    for (const s of scores) {
      const avgScore = parseFloat(s.avg_score)
      const baseline = baselineScores[s.dimension] ?? null
      results.push({
        target: runType,
        dimension: s.dimension,
        currentScore: avgScore,
        baselineScore: baseline,
        delta: baseline !== null ? avgScore - baseline : null,
      })
    }
  }

  return results
}

export async function getJudgeReasoning(target: string, dimension: string): Promise<string[]> {
  const latestRuns = await harnessDb`
    SELECT id FROM runs WHERE run_type = ${target} ORDER BY id DESC LIMIT 1
  ` as any[]
  if (latestRuns.length === 0) return []

  // Get weakest generations — all scores are higher=better, so ASC = worst first
  const weakest = await harnessDb`
    SELECT g.id, s.reasoning
    FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${latestRuns[0].id} AND s.dimension = ${dimension} AND g.passed = true AND s.reasoning IS NOT NULL
    ORDER BY s.score ASC
    LIMIT 5
  ` as any[]

  return weakest.map((w: any) => w.reasoning).filter(Boolean)
}

/**
 * Diagnose a specific target/dimension (skip auto-selection).
 * Used when the user has already chosen what to improve.
 */
export async function diagnoseFor(target: string, dimension: string): Promise<DiagnosisResult | null> {
  const allScores = await getDimensionScores()
  const match = allScores.find(s => s.target === target && s.dimension === dimension)
  if (!match) {
    console.log(`[diagnose] No scores found for ${target}/${dimension}`)
    return null
  }

  const reasoning = await getJudgeReasoning(target, dimension)
  return { ...match, judgeReasoning: reasoning }
}

async function getRecentAttempts(hours: number): Promise<Set<string>> {
  const rows = await orchDb`
    SELECT DISTINCT target, dimension FROM improvement_iterations
    WHERE started_at > now() - ${hours + ' hours'}::interval
  `
  return new Set((rows as any[]).map(r => `${r.target}:${r.dimension}`))
}
