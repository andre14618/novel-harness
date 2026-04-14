/**
 * Display scores for a benchmark run or experiment.
 *
 * Usage:
 *   bun scripts/agent/scores.ts --run-id 487          # scores for a specific run
 *   bun scripts/agent/scores.ts --experiment-id 42    # scores for all runs in experiment
 *   bun scripts/agent/scores.ts --latest prose        # latest run of a benchmark type
 */

import { parseArgs } from "node:util"
import {
  getRunAverages, getPerSeedAverages, getBaselineAverages,
  getExperimentScores,
} from "../../src/db/ops"
import db from "../../src/db/connection"

const { values } = parseArgs({
  options: {
    "run-id": { type: "string" },
    "experiment-id": { type: "string" },
    latest: { type: "string" },
  },
})

async function showRunScores(runId: number, label?: string) {
  if (label) console.log(`\n${label}`)

  const avgs = await getRunAverages(runId)
  if (avgs.length === 0) {
    console.log(`No scores for run #${runId}`)
    return
  }

  console.log(`\nRun #${runId} — Per-dimension averages:`)
  console.log(`  ${"Dimension".padEnd(25)} ${"Avg".padStart(7)} ${"Stddev".padStart(7)}`)
  console.log("  " + "-".repeat(41))
  for (const d of avgs) {
    console.log(`  ${d.dimension.padEnd(25)} ${d.avg.toFixed(1).padStart(7)} ${(d.stddev?.toFixed(1) ?? "—").padStart(7)}`)
  }

  const perSeed = await getPerSeedAverages(runId)
  if (perSeed.length > 0) {
    const seeds = [...new Set(perSeed.map(s => s.seed))]
    const dims = [...new Set(perSeed.map(s => s.dimension))]

    console.log(`\nPer-seed breakdown:`)
    console.log(`  ${"Seed".padEnd(25)} ${dims.map(d => d.slice(0, 12).padStart(13)).join("")}`)
    console.log("  " + "-".repeat(25 + dims.length * 13))
    for (const seed of seeds) {
      const cells = dims.map(d => {
        const match = perSeed.find(s => s.seed === seed && s.dimension === d)
        return (match?.avg.toFixed(1) ?? "—").padStart(13)
      })
      console.log(`  ${seed.padEnd(25)} ${cells.join("")}`)
    }
  }
}

async function main() {
  if (values["run-id"]) {
    await showRunScores(parseInt(values["run-id"]))
  } else if (values["experiment-id"]) {
    const expId = parseInt(values["experiment-id"])
    const scores = await getExperimentScores(expId)
    if (scores.length === 0) {
      console.log(`No scores for experiment #${expId}`)
      process.exit(1)
    }

    const variants = [...new Set(scores.map(s => s.variantLabel))]
    const dims = [...new Set(scores.map(s => s.dimension))]

    console.log(`\nExperiment #${expId} — Scores by variant:`)
    console.log(`  ${"Variant".padEnd(20)} ${dims.map(d => d.slice(0, 15).padStart(16)).join("")}`)
    console.log("  " + "-".repeat(20 + dims.length * 16))
    for (const v of variants) {
      const cells = dims.map(d => {
        const match = scores.find(s => s.variantLabel === v && s.dimension === d)
        return match ? `${match.avg.toFixed(1)}`.padStart(16) : "—".padStart(16)
      })
      console.log(`  ${(v ?? "—").padEnd(20)} ${cells.join("")}`)
    }
  } else if (values.latest) {
    const rows = await db`SELECT id FROM runs WHERE run_type = ${values.latest} ORDER BY id DESC LIMIT 1`
    if (rows.length === 0) {
      console.log(`No runs found for benchmark type: ${values.latest}`)
      process.exit(1)
    }
    const runId = (rows[0] as any).id

    // Show baseline comparison
    const baseline = await getBaselineAverages(values.latest)
    await showRunScores(runId)

    if (baseline) {
      const avgs = await getRunAverages(runId)
      console.log(`\nvs Baseline:`)
      for (const d of avgs) {
        const b = baseline.find(x => x.dimension === d.dimension)
        if (b) {
          const delta = d.avg - b.avg
          const dir = delta > 0 ? "better" : delta < 0 ? "worse" : "same"
          console.log(`  ${d.dimension.padEnd(25)} ${b.avg.toFixed(1)} → ${d.avg.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}, ${dir})`)
        }
      }
    }
  } else {
    console.error("Usage: bun scripts/agent/scores.ts --run-id <id> | --experiment-id <id> | --latest <benchmark-type>")
    process.exit(1)
  }
}

await main()
process.exit(0)
