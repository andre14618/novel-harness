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

  // Variant × dimension table
  lines.push(`### Scores (lower = better)`)
  lines.push(``)
  const header = `| Variant | ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(" | ")} | Overall |`
  const sep = `|${"-".repeat(28)}|${DIMENSIONS.map(() => "-".repeat(12) + "|").join("")}${"-".repeat(10)}|`
  lines.push(header)
  lines.push(sep)

  const variantOveralls: Array<{ label: string; overall: number; telling: number }> = []

  for (const variant of variants) {
    const cols: string[] = []
    let tellingAvg = 0
    for (const dim of DIMENSIONS) {
      const counts = allScores.filter(s => s.variant === variant.label && s.dim === dim).map(s => s.count)
      const avg = mean(counts)
      const std = stddev(counts)
      if (dim === "telling") tellingAvg = avg
      cols.push(`${avg.toFixed(1)} ±${std.toFixed(1)}`)
    }
    const allCounts = allScores.filter(s => s.variant === variant.label).map(s => s.count)
    const overall = mean(allCounts)
    variantOveralls.push({ label: variant.label, overall, telling: tellingAvg })
    lines.push(`| ${variant.label} | ${cols.join(" | ")} | ${overall.toFixed(1)} |`)
  }

  // Ranking
  lines.push(``)
  lines.push(`### Ranking (by Telling)`)
  lines.push(``)
  const ranked = [...variantOveralls].sort((a, b) => a.telling - b.telling)
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    const marker = i === 0 ? "**" : ""
    lines.push(`${i + 1}. ${marker}${r.label}${marker} — Telling: ${r.telling.toFixed(1)}, Overall: ${r.overall.toFixed(1)}`)
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
