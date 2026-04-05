/**
 * Automated diagnosis — finds the weakest benchmark dimension to improve.
 * Uses the harness service layer instead of inline SQL.
 */

import * as harness from "../harness"
import { BENCHMARKS } from "../../benchmark/registry"

export interface DiagnosisResult {
  target: string
  dimension: string
  currentScore: number
  baselineScore: number | null
  delta: number | null
  judgeReasoning: string[]
}

export async function diagnose(): Promise<DiagnosisResult | null> {
  const benchmarkTypes = Object.keys(BENCHMARKS)
  const candidates = await harness.scores.getDimensionScores(benchmarkTypes)
  if (candidates.length === 0) {
    console.log("[diagnose] No benchmark scores found")
    return null
  }

  // Filter out dimensions attempted in the last 6 hours
  const recentAttempts = await harness.cycles.getRecentAttempts(6)
  const filtered = candidates.filter(c =>
    !recentAttempts.has(`${c.target}:${c.dimension}`)
  )
  const pool = filtered.length > 0 ? filtered : candidates

  // Rank: prioritize regressions from baseline, then worst absolute score
  pool.sort((a, b) => {
    if (a.delta !== null && b.delta !== null) {
      if (a.delta < 0 && b.delta >= 0) return -1
      if (b.delta < 0 && a.delta >= 0) return 1
      if (a.delta < 0 && b.delta < 0) return a.delta - b.delta
    }
    return a.currentScore - b.currentScore
  })

  const best = pool[0]
  const reasoning = await harness.scores.getJudgeReasoning(best.target, best.dimension)

  return { ...best, judgeReasoning: reasoning }
}

export async function diagnoseFor(target: string, dimension: string): Promise<DiagnosisResult | null> {
  const benchmarkTypes = Object.keys(BENCHMARKS)
  const allScores = await harness.scores.getDimensionScores(benchmarkTypes)
  const match = allScores.find(s => s.target === target && s.dimension === dimension)
  if (!match) {
    console.log(`[diagnose] No scores found for ${target}/${dimension}`)
    return null
  }

  const reasoning = await harness.scores.getJudgeReasoning(target, dimension)
  return { ...match, judgeReasoning: reasoning }
}
