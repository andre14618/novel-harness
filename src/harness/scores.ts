/**
 * Score queries for the improvement daemon and diagnostics.
 * Replaces inline SQL in improve.ts and diagnose.ts.
 */

import db from "../../data/connection"

export interface DimensionScore {
  target: string
  dimension: string
  currentScore: number
  baselineScore: number | null
  delta: number | null
}

export interface SeedScore {
  seed: string
  avgScore: number
}

/** Get per-dimension averages for the latest run of each benchmark type */
export async function getDimensionScores(benchmarkTypes: string[]): Promise<DimensionScore[]> {
  const results: DimensionScore[] = []

  for (const runType of benchmarkTypes) {
    const latestRuns = await db`SELECT id FROM runs WHERE run_type = ${runType} ORDER BY id DESC LIMIT 1`
    if (latestRuns.length === 0) continue
    const runId = latestRuns[0].id

    const scores = await db`
      SELECT s.dimension, ROUND(AVG(s.score)::numeric, 2) as avg_score
      FROM scores s JOIN generations g ON s.generation_id = g.id
      WHERE g.run_id = ${runId} AND g.passed = true
      GROUP BY s.dimension
    `

    // Baseline scores
    const baselineRuns = await db`SELECT run_id as id FROM baselines WHERE benchmark_type = ${runType}`
    let baselineScores: Record<string, number> = {}
    if (baselineRuns.length > 0) {
      const bScores = await db`
        SELECT s.dimension, ROUND(AVG(s.score)::numeric, 2) as avg_score
        FROM scores s JOIN generations g ON s.generation_id = g.id
        WHERE g.run_id = ${baselineRuns[0].id} AND g.passed = true
        GROUP BY s.dimension
      `
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

/** Get latest scores for a specific target/dimension */
export async function getLatestScores(runType: string, dimension: string): Promise<{
  avgScore: number; runId: number
} | null> {
  const runs = await db`SELECT id FROM runs WHERE run_type = ${runType} ORDER BY id DESC LIMIT 1`
  if (runs.length === 0) return null
  const runId = runs[0].id

  const scores = await db`
    SELECT s.score FROM scores s JOIN generations g ON g.id = s.generation_id
    WHERE g.run_id = ${runId} AND s.dimension = ${dimension}
  `
  if (scores.length === 0) return null
  const avg = scores.reduce((s: number, r: any) => s + r.score, 0) / scores.length
  return { avgScore: Math.round(avg * 10) / 10, runId }
}

/** Get per-seed score breakdown for a dimension */
export async function getSeedScores(runType: string, dimension: string): Promise<SeedScore[]> {
  const runs = await db`SELECT id FROM runs WHERE run_type = ${runType} ORDER BY id DESC LIMIT 1`
  if (runs.length === 0) return []

  const rows = await db`
    SELECT g.seed, ROUND(AVG(s.score)::numeric, 1) as avg_score
    FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runs[0].id} AND g.passed = true AND s.dimension = ${dimension}
    GROUP BY g.seed ORDER BY avg_score ASC
  `
  return rows.map(r => ({ seed: r.seed, avgScore: parseFloat(r.avg_score) }))
}

/** Get all dimension averages for a run */
export async function getAllDimensionScoresForRun(runId: number): Promise<Array<{ dimension: string; avgScore: number }>> {
  const rows = await db`
    SELECT s.dimension, ROUND(AVG(s.score)::numeric, 1) as avg_score
    FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY s.dimension ORDER BY avg_score ASC
  `
  return rows.map(r => ({ dimension: r.dimension, avgScore: parseFloat(r.avg_score) }))
}

/** Get judge reasoning for weakest generations on a dimension */
export async function getJudgeReasoning(target: string, dimension: string, limit: number = 5): Promise<string[]> {
  const runs = await db`SELECT id FROM runs WHERE run_type = ${target} ORDER BY id DESC LIMIT 1`
  if (runs.length === 0) return []

  const weakest = await db`
    SELECT s.reasoning FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runs[0].id} AND s.dimension = ${dimension}
      AND g.passed = true AND s.reasoning IS NOT NULL
    ORDER BY s.score ASC LIMIT ${limit}
  `
  return weakest.map((w: any) => w.reasoning).filter(Boolean)
}

/** Get judge reasoning for weakest in a specific run */
export async function getJudgeReasoningForRun(runId: number, dimension: string, limit: number = 3): Promise<Array<{ seed: string; score: number; reasoning: string }>> {
  const rows = await db`
    SELECT s.reasoning, s.score, g.seed
    FROM scores s JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND s.dimension = ${dimension}
      AND g.passed = true AND s.reasoning IS NOT NULL
    ORDER BY s.score ASC LIMIT ${limit}
  `
  return rows.map(r => ({ seed: r.seed, score: r.score, reasoning: r.reasoning }))
}

/** Get generation IDs for a run */
export async function getGenerationsForRun(runId: number): Promise<Array<{ id: number; seed: string }>> {
  const rows = await db`SELECT id, seed FROM generations WHERE run_id = ${runId} AND passed = true`
  return rows.map(r => ({ id: r.id, seed: r.seed }))
}
