/**
 * Auto-generate experiment summaries from results.
 *
 * Produces a markdown summary with variant × dimension table, ranking,
 * per-seed breakdown, lint stats, and cost. Persists to tuning_experiments.summary.
 */

import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  saveExperimentSummary, getExperimentLintSummary, getExperimentCost,
} from "../../data/db"
import { mean, stddev } from "./shared"
import type { Variant, VariantScore } from "./experiments/types"
import type { Seed } from "./shared"

export function generateExperimentSummary(
  expId: number,
  allScores: VariantScore[],
  variants: Variant[],
  seeds: Seed[],
  judgeLabel: string,
): string {
  const lines: string[] = []

  lines.push(`## Experiment #${expId} Results`)
  lines.push(``)
  lines.push(`Judge: ${judgeLabel}`)
  lines.push(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  lines.push(``)

  // Variant × dimension table (raw)
  const per1k = (s: VariantScore) => s.wordCount > 0 ? s.count / s.wordCount * 1000 : 0

  lines.push(`### Raw Scores (lower = better)`)
  lines.push(``)
  const header = `| Variant | ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(" | ")} | Overall | Avg Words |`
  const sep = `|${"-".repeat(28)}|${DIMENSIONS.map(() => "-".repeat(12) + "|").join("")}${"-".repeat(10)}|${"-".repeat(12)}|`
  lines.push(header)
  lines.push(sep)

  const variantOveralls: Array<{ label: string; overall: number; telling: number; normTelling: number; normOverall: number }> = []

  for (const variant of variants) {
    const cols: string[] = []
    let tellingAvg = 0, normTellingAvg = 0
    for (const dim of DIMENSIONS) {
      const dimScores = allScores.filter(s => s.variant === variant.label && s.dim === dim)
      const avg = mean(dimScores.map(s => s.count))
      const std = stddev(dimScores.map(s => s.count))
      if (dim === "telling") { tellingAvg = avg; normTellingAvg = mean(dimScores.map(per1k)) }
      cols.push(`${avg.toFixed(1)} ±${std.toFixed(1)}`)
    }
    const varScores = allScores.filter(s => s.variant === variant.label)
    const overall = mean(varScores.map(s => s.count))
    const normOverall = mean(varScores.map(per1k))
    const avgWords = mean(varScores.map(s => s.wordCount))
    variantOveralls.push({ label: variant.label, overall, telling: tellingAvg, normTelling: normTellingAvg, normOverall })
    lines.push(`| ${variant.label} | ${cols.join(" | ")} | ${overall.toFixed(1)} | ${avgWords.toFixed(0)} |`)
  }

  // Normalized table
  lines.push(``)
  lines.push(`### Normalized (issues per 1k words)`)
  lines.push(``)
  const normHeader = `| Variant | ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(" | ")} | Overall |`
  const normSep = `|${"-".repeat(28)}|${DIMENSIONS.map(() => "-".repeat(12) + "|").join("")}${"-".repeat(10)}|`
  lines.push(normHeader)
  lines.push(normSep)

  for (const variant of variants) {
    const cols: string[] = []
    for (const dim of DIMENSIONS) {
      const dimScores = allScores.filter(s => s.variant === variant.label && s.dim === dim)
      cols.push(`${mean(dimScores.map(per1k)).toFixed(1)} ±${stddev(dimScores.map(per1k)).toFixed(1)}`)
    }
    const varScores = allScores.filter(s => s.variant === variant.label)
    lines.push(`| ${variant.label} | ${cols.join(" | ")} | ${mean(varScores.map(per1k)).toFixed(1)} |`)
  }

  // Ranking
  lines.push(``)
  lines.push(`### Ranking (by Telling, normalized)`)
  lines.push(``)
  const ranked = [...variantOveralls].sort((a, b) => a.normTelling - b.normTelling)
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    const marker = i === 0 ? "**" : ""
    lines.push(`${i + 1}. ${marker}${r.label}${marker} — Telling: ${r.telling.toFixed(1)} (${r.normTelling.toFixed(1)}/1k), Overall: ${r.overall.toFixed(1)} (${r.normOverall.toFixed(1)}/1k)`)
  }

  // Lint summary
  const lintStats = getExperimentLintSummary(expId)
  if (lintStats.length > 0) {
    lines.push(``)
    lines.push(`### Lint Issues (deterministic)`)
    lines.push(``)
    const byVariant = new Map<string, number>()
    for (const s of lintStats) {
      byVariant.set(s.variantLabel, (byVariant.get(s.variantLabel) || 0) + s.count)
    }
    for (const [v, count] of byVariant) {
      lines.push(`- ${v}: ${count} issues`)
    }
  }

  // Cost
  const costStats = getExperimentCost(expId)
  if (costStats.length > 0) {
    lines.push(``)
    lines.push(`### Cost`)
    lines.push(``)
    let total = 0
    for (const c of costStats) {
      total += c.totalCost
      lines.push(`- ${c.variantLabel}: $${c.totalCost.toFixed(4)} (${c.totalCalls} calls)`)
    }
    lines.push(`- **Total**: $${total.toFixed(4)}`)
  }

  const summaryMd = lines.join("\n")
  saveExperimentSummary(expId, summaryMd)
  return summaryMd
}
