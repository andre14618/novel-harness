/**
 * Replay a historical prompt version and compare against current.
 *
 * Resolves prompt content from three sources:
 *   --iteration <id>  : improvement_iterations backup_content (or --use-proposed)
 *   --run <id>        : find the iteration that produced the run, or fall back to git
 *   --commit <sha>    : git show <sha>:<prompt-path>
 *
 * Then generates prose with the historical prompt, generates with the current prompt
 * (or reuses an existing run via --run-b), judges both, and runs a pairwise comparison.
 *
 * Usage:
 *   bun scripts/replay-experiment.ts --iteration 42
 *   bun scripts/replay-experiment.ts --commit abc123
 *   bun scripts/replay-experiment.ts --run 187 --run-b 200
 *   bun scripts/replay-experiment.ts --iteration 42 --seeds romance-drama --runs 2
 *   bun scripts/replay-experiment.ts --iteration 42 --dry-run
 */

import { parseArgs } from "node:util"
import { $ } from "bun"
import db from "../data/connection"
import {
  createTuningExperiment, concludeExperiment,
  createRun, saveGeneration, saveScore, savePairwiseMatchup,
} from "../data/db"
import { getWriter, getJudges, getPairwiseJudge } from "../benchmark/config"
import { loadSeeds, generateProse, judgeDimension, JUDGE_RUBRICS, mean, stddev } from "../benchmark/prose/shared"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "../benchmark/prose/judges/schema"
import { runMatchup } from "../benchmark/pairwise/judge"
import { WRITER_AGENT_PROMPT } from "../src/prompts"
import { lintRun } from "../src/lint/index"

// ── CLI ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    iteration:      { type: "string" },
    run:            { type: "string" },
    commit:         { type: "string" },
    "run-b":        { type: "string" },
    "use-proposed": { type: "boolean", default: false },
    seeds:          { type: "string" },
    runs:           { type: "string", default: "2" },
    "dry-run":      { type: "boolean", default: false },
    "skip-pairwise":{ type: "boolean", default: false },
  },
})

const sources = [values.iteration, values.run, values.commit].filter(Boolean)
if (sources.length !== 1) {
  console.error("Provide exactly one of --iteration, --run, or --commit")
  console.error("\nUsage:")
  console.error("  bun scripts/replay-experiment.ts --iteration <id>")
  console.error("  bun scripts/replay-experiment.ts --run <id>")
  console.error("  bun scripts/replay-experiment.ts --commit <sha>")
  console.error("\nOptions:")
  console.error("  --run-b <id>         Reuse an existing run as the 'current' comparison")
  console.error("  --use-proposed       Use proposed_content instead of backup_content (iteration mode)")
  console.error("  --seeds <s1,s2>      Filter seeds (comma-separated)")
  console.error("  --runs <n>           Runs per seed (default: 2)")
  console.error("  --dry-run            Show what would happen without running benchmarks")
  console.error("  --skip-pairwise      Skip the pairwise comparison step")
  process.exit(1)
}

const runsPerSeed = parseInt(values.runs!)
const seedFilter = values.seeds?.split(",").map(s => s.trim())
const dryRun = values["dry-run"]!
const skipPairwise = values["skip-pairwise"]!

// ── Resolution ──────────────────────────────────────────────────────────

interface ResolvedPrompts {
  prompts: Array<{ agentName: string; filePath: string; content: string }>
  label: string
  meta: Record<string, any>
}

async function resolveFromIteration(id: number, useProposed: boolean): Promise<ResolvedPrompts> {
  const rows = await db`
    SELECT file_path, backup_content, proposed_content, target, dimension, agent_name,
           result, baseline_score, new_score, delta, cycle_id, iteration_num
    FROM improvement_iterations WHERE id = ${id}
  `
  if (rows.length === 0) throw new Error(`Iteration ${id} not found`)
  const row = rows[0] as any

  const content = useProposed ? row.proposed_content : row.backup_content
  const contentType = useProposed ? "proposed" : "backup"
  if (!content) throw new Error(`Iteration ${id} has no ${contentType}_content. Try --${useProposed ? "without --use-proposed" : "use-proposed"} or use --commit instead.`)

  return {
    prompts: [{
      agentName: row.agent_name ?? "writer",
      filePath: row.file_path,
      content,
    }],
    label: `iter:${id}:${contentType}`,
    meta: {
      iterationId: id,
      cycleId: row.cycle_id,
      iterationNum: row.iteration_num,
      target: row.target,
      dimension: row.dimension,
      result: row.result,
      baselineScore: row.baseline_score,
      newScore: row.new_score,
      delta: row.delta,
      contentType,
    },
  }
}

async function resolveFromRun(runId: number): Promise<ResolvedPrompts> {
  // Check if this run has a linked iteration
  const iterRows = await db`
    SELECT id, file_path, proposed_content, backup_content, agent_name, target, dimension
    FROM improvement_iterations WHERE run_id = ${runId}
  `
  if (iterRows.length > 0) {
    const row = iterRows[0] as any
    const content = row.proposed_content ?? row.backup_content
    if (content) {
      return {
        prompts: [{
          agentName: row.agent_name ?? "writer",
          filePath: row.file_path,
          content,
        }],
        label: `run:${runId}:iter:${row.id}`,
        meta: { runId, iterationId: row.id, target: row.target, dimension: row.dimension },
      }
    }
  }

  // Fallback: find nearest git commit to the run timestamp
  const runRows = await db`SELECT timestamp, label FROM runs WHERE id = ${runId}`
  if (runRows.length === 0) throw new Error(`Run ${runId} not found`)
  const run = runRows[0] as any
  const timestamp = new Date(run.timestamp).toISOString()

  // Find the commit that was active at the run's time
  const writerPath = "src/agents/writer/prompt.md"
  const result = await $`git log --before="${timestamp}" -1 --format=%H -- ${writerPath}`.text()
  const sha = result.trim()
  if (!sha) throw new Error(`No git commit found for ${writerPath} before ${timestamp}`)

  return resolveFromCommit(sha, `run:${runId}:git:${sha.slice(0, 8)}`)
}

async function resolveFromCommit(sha: string, labelOverride?: string): Promise<ResolvedPrompts> {
  const writerPath = "src/agents/writer/prompt.md"

  let content: string
  try {
    content = await $`git show ${sha}:${writerPath}`.text()
  } catch {
    throw new Error(`Could not extract ${writerPath} from commit ${sha}. Does the file exist at that commit?`)
  }

  // Get commit info for the label
  const commitInfo = await $`git log --format="%h %s" -1 ${sha}`.text()

  return {
    prompts: [{ agentName: "writer", filePath: writerPath, content }],
    label: labelOverride ?? `commit:${sha.slice(0, 8)}`,
    meta: { commit: sha, commitInfo: commitInfo.trim() },
  }
}

// ── Benchmark runner ────────────────────────────────────────────────────

async function runBenchmark(
  label: string, writerPrompt: string, seedFilter?: string[],
  experimentId?: number,
): Promise<{ runId: number; scores: Array<{ seed: string; run: number; dim: Dimension; count: number; wordCount: number }> }> {
  const writer = getWriter()
  const judges = getJudges()
  const seeds = loadSeeds(seedFilter)

  if (judges.length === 0) throw new Error("No judge API keys found")

  const runId = await createRun("prose", seeds.length.toString(), label, experimentId)
  const allScores: Array<{ seed: string; run: number; dim: Dimension; count: number; wordCount: number }> = []

  for (const seed of seeds) {
    for (let run = 1; run <= runsPerSeed; run++) {
      console.log(`  [${label}] [${seed.name}] Run ${run}/${runsPerSeed}...`)

      const result = await generateProse(writer, writerPrompt, seed.prompt, runId, seed.name, run)
      if (!result) {
        await saveGeneration(runId, seed.name, run, { passed: false })
        console.log(`  [${label}] [${seed.name}] Run ${run}: FAIL`)
        continue
      }

      const words = result.prose.split(/\s+/).length
      const genId = await saveGeneration(runId, seed.name, run, {
        prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
        tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
      })

      console.log(`  [${label}] [${seed.name}] Run ${run}: ${words}w ${result.tps}tok/s`)

      // Judge all dimensions concurrently
      const judgeJobs = judges.flatMap(judge =>
        DIMENSIONS.map(async (dim) => {
          const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
          if (penalty) {
            await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            allScores.push({ seed: seed.name, run, dim, count: penalty.count, wordCount: words })
          }
        })
      )
      await Promise.all(judgeJobs)
    }
  }

  // Auto-lint
  const lintResults = await lintRun(runId)
  const totalLintIssues = lintResults.reduce((s, r) => s + r.result.totalIssues, 0)
  if (totalLintIssues > 0) console.log(`  [${label}] Lint: ${totalLintIssues} deterministic issues`)

  return { runId, scores: allScores }
}

// ── Pairwise comparison ─────────────────────────────────────────────────

async function runPairwise(
  runA: number, labelA: string,
  runB: number, labelB: string,
  experimentId: number,
) {
  const judge = getPairwiseJudge()

  // Get generations for both runs
  const gensA = await db`
    SELECT id, seed, prose, word_count FROM generations
    WHERE run_id = ${runA} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number }>

  const gensB = await db`
    SELECT id, seed, prose, word_count FROM generations
    WHERE run_id = ${runB} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number }>

  // Group by seed
  const seedsA = new Map<string, typeof gensA>()
  for (const g of gensA) {
    if (!seedsA.has(g.seed)) seedsA.set(g.seed, [])
    seedsA.get(g.seed)!.push(g)
  }

  const seedsB = new Map<string, typeof gensB>()
  for (const g of gensB) {
    if (!seedsB.has(g.seed)) seedsB.set(g.seed, [])
    seedsB.get(g.seed)!.push(g)
  }

  const matchingSeeds = [...seedsA.keys()].filter(s => seedsB.has(s)).sort()
  if (matchingSeeds.length === 0) {
    console.log("\n  No matching seeds for pairwise comparison — skipping")
    return
  }

  // Build pairs
  const pairs: Array<{ seed: string; genA: typeof gensA[0]; genB: typeof gensB[0] }> = []
  for (const seed of matchingSeeds) {
    const as = seedsA.get(seed)!
    const bs = seedsB.get(seed)!
    const count = Math.min(as.length, bs.length)
    for (let i = 0; i < count; i++) {
      pairs.push({ seed, genA: as[i], genB: bs[i] })
    }
  }

  console.log(`\n  Pairwise Comparison`)
  console.log(`    A (historical): ${labelA}`)
  console.log(`    B (current):    ${labelB}`)
  console.log(`    Judge: ${judge.label}`)
  console.log(`    Matchups: ${pairs.length} (x2 for position bias)`)

  const results: Array<{ seed: string; canonical: string }> = []

  for (const pair of pairs) {
    console.log(`    [${pair.seed}] gen ${pair.genA.id} vs ${pair.genB.id}...`)

    const matchup = await runMatchup(judge, pair.genA.prose, pair.genB.prose)

    if (matchup.forward) {
      savePairwiseMatchup({
        experimentId, generationA: pair.genA.id, generationB: pair.genB.id,
        labelA, labelB, seed: pair.seed, judgeModel: judge.label,
        winner: matchup.forward.winner as any,
        confidence: matchup.forward.confidence as any,
        reasoning: matchup.forward.reasoning,
        position: "ab", latencyMs: 0,
      })
    }
    if (matchup.reverse) {
      savePairwiseMatchup({
        experimentId, generationA: pair.genA.id, generationB: pair.genB.id,
        labelA, labelB, seed: pair.seed, judgeModel: judge.label,
        winner: matchup.reverse.winner as any,
        confidence: matchup.reverse.confidence as any,
        reasoning: matchup.reverse.reasoning,
        position: "ba", latencyMs: 0,
      })
    }

    const canonLabel = matchup.canonical === "first" ? "A (historical) wins"
      : matchup.canonical === "second" ? "B (current) wins"
      : matchup.canonical === "tie" ? "TIE"
      : "INCONSISTENT"

    console.log(`      → ${canonLabel}`)
    if (matchup.forward?.reasoning) {
      console.log(`        "${matchup.forward.reasoning.slice(0, 120)}"`)
    }

    results.push({ seed: pair.seed, canonical: matchup.canonical })
  }

  // Summary
  const aWins = results.filter(r => r.canonical === "first").length
  const bWins = results.filter(r => r.canonical === "second").length
  const ties = results.filter(r => r.canonical === "tie").length
  const inconsistent = results.filter(r => r.canonical === "inconsistent").length
  const total = results.length

  console.log(`\n  ${"─".repeat(50)}`)
  console.log(`  Pairwise Results:`)
  console.log(`    Historical wins: ${aWins}/${total} (${(aWins / total * 100).toFixed(0)}%)`)
  console.log(`    Current wins:    ${bWins}/${total} (${(bWins / total * 100).toFixed(0)}%)`)
  console.log(`    Ties:            ${ties}/${total}`)
  if (inconsistent > 0) console.log(`    Inconsistent:    ${inconsistent}/${total} (position bias)`)

  if (matchingSeeds.length > 1) {
    console.log(`\n    Per-seed:`)
    for (const seed of matchingSeeds) {
      const sr = results.filter(r => r.seed === seed)
      const sa = sr.filter(r => r.canonical === "first").length
      const sb = sr.filter(r => r.canonical === "second").length
      const st = sr.filter(r => r.canonical === "tie").length
      console.log(`      ${seed.padEnd(24)} Historical:${sa} Current:${sb} Tie:${st}`)
    }
  }

  if (bWins > aWins) {
    console.log(`\n  Verdict: Current prompts are better`)
  } else if (aWins > bWins) {
    console.log(`\n  Verdict: Historical prompts were better — regression detected`)
  } else {
    console.log(`\n  Verdict: No clear difference`)
  }

  return { aWins, bWins, ties, inconsistent }
}

// ── Score reporting ─────────────────────────────────────────────────────

function reportScores(
  label: string,
  scores: Array<{ seed: string; run: number; dim: Dimension; count: number; wordCount: number }>,
) {
  const abs = (n: number) => Math.abs(n)
  const per1k = (s: { count: number; wordCount: number }) => s.wordCount > 0 ? abs(s.count) / s.wordCount * 1000 : 0

  console.log(`\n  ${label}:`)
  for (const dim of DIMENSIONS) {
    const dimScores = scores.filter(s => s.dim === dim)
    if (dimScores.length === 0) continue
    const counts = dimScores.map(s => abs(s.count))
    const norms = dimScores.map(per1k)
    console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${mean(counts).toFixed(1)} issues (+-${stddev(counts).toFixed(1)})  |  ${mean(norms).toFixed(1)}/1k`)
  }
  const totalAvg = mean(scores.map(s => abs(s.count)))
  console.log(`    ${"TOTAL".padEnd(14)} ${totalAvg.toFixed(1)} issues/dim`)
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Resolve historical prompts
  let resolved: ResolvedPrompts

  if (values.iteration) {
    resolved = await resolveFromIteration(parseInt(values.iteration), values["use-proposed"]!)
  } else if (values.run) {
    resolved = await resolveFromRun(parseInt(values.run))
  } else {
    resolved = await resolveFromCommit(values.commit!)
  }

  const historicalPrompt = resolved.prompts[0].content

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  REPLAY EXPERIMENT`)
  console.log(`${"=".repeat(60)}`)
  console.log(`  Source: ${resolved.label}`)
  console.log(`  File: ${resolved.prompts[0].filePath}`)
  console.log(`  Prompt length: ${historicalPrompt.length} chars`)
  if (resolved.meta.commitInfo) console.log(`  Commit: ${resolved.meta.commitInfo}`)
  if (resolved.meta.dimension) console.log(`  Dimension: ${resolved.meta.dimension}`)
  if (resolved.meta.result) console.log(`  Original result: ${resolved.meta.result} (delta: ${resolved.meta.delta})`)

  // Show prompt diff preview
  const currentPrompt = WRITER_AGENT_PROMPT
  const histLines = historicalPrompt.split("\n").length
  const currLines = currentPrompt.split("\n").length
  const same = historicalPrompt === currentPrompt
  console.log(`  Historical: ${histLines} lines | Current: ${currLines} lines | ${same ? "IDENTICAL" : "DIFFERENT"}`)

  if (same) {
    console.log(`\n  Warning: Historical and current prompts are identical.`)
    console.log(`  The benchmark will still run, but pairwise results will show noise only.`)
  }

  const seeds = loadSeeds(seedFilter)
  const writer = getWriter()
  const judges = getJudges()
  console.log(`\n  Writer: ${writer.label}`)
  console.log(`  Judge: ${judges.map(j => j.label).join(", ")}`)
  console.log(`  Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`  Runs per seed: ${runsPerSeed}`)
  console.log(`  Estimated generations: ${seeds.length * runsPerSeed * 2} (${seeds.length * runsPerSeed} historical + ${values["run-b"] ? "reusing run " + values["run-b"] : seeds.length * runsPerSeed + " current"})`)

  if (dryRun) {
    console.log(`\n  DRY RUN — exiting without running benchmarks`)
    process.exit(0)
  }

  // Create experiment
  const expId = await createTuningExperiment("replay", `Replay ${resolved.label} vs current`, {
    source: resolved.label,
    meta: resolved.meta,
    seeds: seeds.map(s => s.name),
    runsPerSeed,
    runB: values["run-b"] ? parseInt(values["run-b"]) : undefined,
  })
  console.log(`\n  Experiment: #${expId}`)

  // ── Run historical benchmark ──────────────────────────────────────────

  console.log(`\n  Phase 1: Generating with historical prompt...`)
  const historical = await runBenchmark(
    `replay:${resolved.label}`, historicalPrompt, seedFilter, expId,
  )
  console.log(`  Historical run: #${historical.runId}`)

  // ── Run current benchmark (or reuse) ──────────────────────────────────

  let currentRunId: number
  let currentScores: Array<{ seed: string; run: number; dim: Dimension; count: number; wordCount: number }> | null = null

  if (values["run-b"]) {
    currentRunId = parseInt(values["run-b"])
    console.log(`\n  Phase 2: Reusing existing run #${currentRunId} as current`)
  } else {
    console.log(`\n  Phase 2: Generating with current prompt...`)
    const current = await runBenchmark("current", currentPrompt, seedFilter, expId)
    currentRunId = current.runId
    currentScores = current.scores
    console.log(`  Current run: #${currentRunId}`)
  }

  // ── Score comparison ──────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  SCORE COMPARISON`)
  console.log(`${"=".repeat(60)}`)

  reportScores(`Historical (Run #${historical.runId})`, historical.scores)
  if (currentScores) {
    reportScores(`Current (Run #${currentRunId})`, currentScores)
  }

  // Delta
  if (currentScores && historical.scores.length > 0) {
    console.log(`\n  Delta (current - historical, negative = improvement):`)
    for (const dim of DIMENSIONS) {
      const histDim = historical.scores.filter(s => s.dim === dim)
      const currDim = currentScores.filter(s => s.dim === dim)
      if (histDim.length === 0 || currDim.length === 0) continue
      const histAvg = mean(histDim.map(s => Math.abs(s.count)))
      const currAvg = mean(currDim.map(s => Math.abs(s.count)))
      const delta = currAvg - histAvg
      const arrow = delta < 0 ? "↓" : delta > 0 ? "↑" : "="
      const quality = delta < 0 ? "(improved)" : delta > 0 ? "(regressed)" : "(same)"
      console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${delta > 0 ? "+" : ""}${delta.toFixed(1)} issues ${arrow} ${quality}`)
    }
  }

  // ── Pairwise comparison ───────────────────────────────────────────────

  if (!skipPairwise) {
    console.log(`\n${"=".repeat(60)}`)
    console.log(`  PAIRWISE COMPARISON`)
    console.log(`${"=".repeat(60)}`)

    const pairwiseResult = await runPairwise(
      historical.runId, `replay:${resolved.label}`,
      currentRunId, "current",
      expId,
    )

    // Conclude experiment
    const verdict = pairwiseResult
      ? pairwiseResult.bWins > pairwiseResult.aWins ? "Current is better"
        : pairwiseResult.aWins > pairwiseResult.bWins ? "Historical was better (regression)"
        : "No clear difference"
      : "Pairwise inconclusive"

    await concludeExperiment(expId, verdict)
  } else {
    await concludeExperiment(expId, "Pairwise skipped")
  }

  console.log(`\n  Experiment: #${expId}`)
  console.log(`  Historical run: #${historical.runId}`)
  console.log(`  Current run: #${currentRunId}`)
  console.log(`  DB: Postgres`)
}

main().catch(err => {
  console.error("\nReplay experiment failed:", err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
