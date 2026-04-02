/**
 * Pairwise comparison runner.
 *
 * Compares prose from two sources (runs, variants, or ad-hoc prose)
 * using position-bias-corrected matchups.
 *
 * Usage:
 *   # Compare two benchmark runs
 *   bun benchmark/pairwise/run.ts --run-a 43 --run-b 44
 *
 *   # Compare two runs, specific seeds
 *   bun benchmark/pairwise/run.ts --run-a 43 --run-b 44 --seeds romance-drama
 *
 *   # Compare with a specific judge model (default: from roles.ts)
 *   BENCHMARK_JUDGES="GPT-OSS 120B" bun benchmark/pairwise/run.ts --run-a 43 --run-b 44
 */

import { parseArgs } from "node:util"
import { getPairwiseJudge } from "../config"
import { getCentralDB, createTuningExperiment, savePairwiseMatchup, getPairwiseResults } from "../../data/db"
import { runMatchup } from "./judge"

const { values } = parseArgs({
  options: {
    "run-a": { type: "string" },
    "run-b": { type: "string" },
    seeds: { type: "string" },
  },
})

if (!values["run-a"] || !values["run-b"]) {
  console.error("Usage: bun benchmark/pairwise/run.ts --run-a <id> --run-b <id> [--seeds seed1,seed2]")
  process.exit(1)
}

const runA = parseInt(values["run-a"]!)
const runB = parseInt(values["run-b"]!)
const seedFilter = values.seeds?.split(",").map(s => s.trim())

async function main() {
  const db = getCentralDB()
  const judge = getPairwiseJudge()

  // Get run labels
  const runAInfo = db.query<any, [number]>("SELECT label FROM runs WHERE id = ?").get(runA)
  const runBInfo = db.query<any, [number]>("SELECT label FROM runs WHERE id = ?").get(runB)
  if (!runAInfo || !runBInfo) { console.error(`Run ${!runAInfo ? runA : runB} not found`); process.exit(1) }

  const labelA = `Run ${runA} (${runAInfo.label})`
  const labelB = `Run ${runB} (${runBInfo.label})`

  // Get generations for both runs, matched by seed
  const gensA = db.query<any, [number]>(
    "SELECT id, seed, prose, word_count FROM generations WHERE run_id = ? AND passed = 1 AND prose IS NOT NULL ORDER BY seed, attempt"
  ).all(runA) as Array<{ id: number; seed: string; prose: string; word_count: number }>

  const gensB = db.query<any, [number]>(
    "SELECT id, seed, prose, word_count FROM generations WHERE run_id = ? AND passed = 1 AND prose IS NOT NULL ORDER BY seed, attempt"
  ).all(runB) as Array<{ id: number; seed: string; prose: string; word_count: number }>

  // Group by seed
  const seedsA = new Map<string, typeof gensA>()
  for (const g of gensA) {
    if (seedFilter && !seedFilter.includes(g.seed)) continue
    if (!seedsA.has(g.seed)) seedsA.set(g.seed, [])
    seedsA.get(g.seed)!.push(g)
  }

  const seedsB = new Map<string, typeof gensB>()
  for (const g of gensB) {
    if (seedFilter && !seedFilter.includes(g.seed)) continue
    if (!seedsB.has(g.seed)) seedsB.set(g.seed, [])
    seedsB.get(g.seed)!.push(g)
  }

  // Find matching seeds
  const matchingSeeds = [...seedsA.keys()].filter(s => seedsB.has(s)).sort()
  if (matchingSeeds.length === 0) {
    console.error("No matching seeds between the two runs")
    process.exit(1)
  }

  // Build matchup pairs (pair by index within each seed)
  const pairs: Array<{
    seed: string; genA: typeof gensA[0]; genB: typeof gensB[0]
  }> = []

  for (const seed of matchingSeeds) {
    const as = seedsA.get(seed)!
    const bs = seedsB.get(seed)!
    const count = Math.min(as.length, bs.length)
    for (let i = 0; i < count; i++) {
      pairs.push({ seed, genA: as[i], genB: bs[i] })
    }
  }

  // Create experiment
  const expId = createTuningExperiment("pairwise", `Compare Run ${runA} vs Run ${runB}`, {
    runA, runB, labelA, labelB,
    seeds: matchingSeeds,
    pairs: pairs.length,
    judge: judge.label,
  })

  console.log(`\nPairwise Comparison (Experiment #${expId})`)
  console.log(`  A: ${labelA}`)
  console.log(`  B: ${labelB}`)
  console.log(`  Judge: ${judge.label}`)
  console.log(`  Seeds: ${matchingSeeds.join(", ")}`)
  console.log(`  Matchups: ${pairs.length} (x2 for position bias)`)
  console.log()

  // Run matchups
  const results: Array<{
    seed: string; canonical: string; forward: string; reverse: string
  }> = []

  for (const pair of pairs) {
    console.log(`  [${pair.seed}] gen ${pair.genA.id} vs ${pair.genB.id}...`)

    const matchup = await runMatchup(judge, pair.genA.prose, pair.genB.prose)

    // Save both directions
    if (matchup.forward) {
      savePairwiseMatchup({
        experimentId: expId,
        generationA: pair.genA.id, generationB: pair.genB.id,
        labelA, labelB, seed: pair.seed, judgeModel: judge.label,
        winner: matchup.forward.winner as any,
        confidence: matchup.forward.confidence as any,
        reasoning: matchup.forward.reasoning,
        position: "ab",
        latencyMs: 0,
      })
    }
    if (matchup.reverse) {
      savePairwiseMatchup({
        experimentId: expId,
        generationA: pair.genA.id, generationB: pair.genB.id,
        labelA, labelB, seed: pair.seed, judgeModel: judge.label,
        winner: matchup.reverse.winner as any,
        confidence: matchup.reverse.confidence as any,
        reasoning: matchup.reverse.reasoning,
        position: "ba",
        latencyMs: 0,
      })
    }

    const canonLabel = matchup.canonical === "first" ? "A wins"
      : matchup.canonical === "second" ? "B wins"
      : matchup.canonical === "tie" ? "TIE"
      : "INCONSISTENT"

    const fwdLabel = matchup.forward ? `fwd:${matchup.forward.winner}(${matchup.forward.confidence})` : "fwd:FAIL"
    const revLabel = matchup.reverse ? `rev:${matchup.reverse.winner}(${matchup.reverse.confidence})` : "rev:FAIL"

    console.log(`    → ${canonLabel}  [${fwdLabel} ${revLabel}]`)
    if (matchup.forward?.reasoning) {
      console.log(`      "${matchup.forward.reasoning.slice(0, 120)}"`)
    }

    results.push({
      seed: pair.seed,
      canonical: matchup.canonical,
      forward: matchup.forward?.winner ?? "FAIL",
      reverse: matchup.reverse?.winner ?? "FAIL",
    })
  }

  // ── Summary ─────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  PAIRWISE RESULTS`)
  console.log(`${"=".repeat(60)}`)
  console.log(`  A: ${labelA}`)
  console.log(`  B: ${labelB}`)
  console.log()

  const aWins = results.filter(r => r.canonical === "first").length
  const bWins = results.filter(r => r.canonical === "second").length
  const ties = results.filter(r => r.canonical === "tie").length
  const inconsistent = results.filter(r => r.canonical === "inconsistent").length
  const total = results.length

  console.log(`  A wins: ${aWins}/${total} (${(aWins / total * 100).toFixed(0)}%)`)
  console.log(`  B wins: ${bWins}/${total} (${(bWins / total * 100).toFixed(0)}%)`)
  console.log(`  Ties: ${ties}/${total}`)
  if (inconsistent > 0) console.log(`  Inconsistent: ${inconsistent}/${total} (position bias detected)`)

  // Per-seed breakdown
  if (matchingSeeds.length > 1) {
    console.log(`\n  Per-seed:`)
    for (const seed of matchingSeeds) {
      const seedResults = results.filter(r => r.seed === seed)
      const sa = seedResults.filter(r => r.canonical === "first").length
      const sb = seedResults.filter(r => r.canonical === "second").length
      const st = seedResults.filter(r => r.canonical === "tie").length
      console.log(`    ${seed.padEnd(24)} A:${sa} B:${sb} Tie:${st}`)
    }
  }

  // Verdict
  console.log()
  if (aWins > bWins && aWins > ties) {
    console.log(`  Verdict: A is better (${labelA})`)
  } else if (bWins > aWins && bWins > ties) {
    console.log(`  Verdict: B is better (${labelB})`)
  } else if (ties >= aWins && ties >= bWins) {
    console.log(`  Verdict: No clear winner — quality is comparable`)
  } else {
    console.log(`  Verdict: Too close to call (A:${aWins} B:${bWins} Tie:${ties})`)
  }

  console.log(`\n  Experiment: #${expId}`)
}

main().catch(err => {
  console.error("Pairwise comparison failed:", err.message)
  process.exit(1)
})
