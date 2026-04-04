/**
 * Lint-driven improvement loop.
 *
 * Generates prose → lints (expanded) → fixes what it can → tracks persistent issues
 * → proposes writer prompt changes → re-generates → compares lint counts.
 * Keeps changes that reduce persistent lint issues, reverts those that don't.
 *
 * Unlike the judge-based daemon, this loop:
 *   - Uses deterministic lint counts (free, reproducible, no judge variance)
 *   - Targets the writer prompt specifically (prevent issues at generation time)
 *   - Measures "persistent" issues (those that survive the hybrid fixer)
 *
 * Usage:
 *   bun scripts/lint-improve.ts                          # default: 5 iterations, romance-drama
 *   bun scripts/lint-improve.ts --iterations 10          # more iterations
 *   bun scripts/lint-improve.ts --seeds romance-drama,sci-fi-thriller
 *   bun scripts/lint-improve.ts --dry-run                # propose but don't apply
 */

import { parseArgs } from "node:util"
import { readFileSync, writeFileSync } from "node:fs"
import { lintProse } from "../src/lint"
import { fixLintIssues } from "../src/lint/fix"
import { getModelForAgent } from "../models/roles"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { createRun, saveGeneration, saveLLMCall } from "../benchmark/db"
import { loadSeeds, generateProse } from "../benchmark/prose/shared"
import { getWriter } from "../benchmark/config"
import { getTransport } from "../src/transport"
import { extractJSON } from "../src/llm"
import { buildImprovementContext } from "../src/agents/lint-improver/context"

const HARNESS_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const WRITER_PROMPT_PATH = `${HARNESS_ROOT}/src/agents/writer/prompt.md`

const { values } = parseArgs({
  options: {
    iterations: { type: "string", default: "5" },
    seeds: { type: "string" },
    "runs-per-seed": { type: "string", default: "2" },
    "dry-run": { type: "boolean", default: false },
    discover: { type: "boolean", default: false },
  },
})

const MAX_ITERATIONS = parseInt(values.iterations!)
const DRY_RUN = values["dry-run"]!
const RUNS_PER_SEED = parseInt(values["runs-per-seed"]!)
const seedFilter = values.seeds?.split(",").map(s => s.trim())

// ── Types ─────────────────────────────────────────────────────────────────

interface LintSnapshot {
  totalIssues: number
  totalAfterFix: number   // persistent issues (survive hybrid fixer)
  categories: Record<string, number>
  persistentCategories: Record<string, number>
  instances: Record<string, string[]>  // specific flagged sentences per category
}

// ── Lint snapshot: generate prose, lint, fix, measure what persists ────────

async function takeLintSnapshot(writerPrompt: string, seeds: ReturnType<typeof loadSeeds>, runId: number): Promise<LintSnapshot> {
  // Use lint-writer (Qwen 235B, fast) if available, otherwise default writer
  const lintWriter = getModelForAgent("lint-writer")
  const defaultWriter = getWriter()
  const writer = lintWriter
    ? { ...defaultWriter, provider: lintWriter.provider, model: lintWriter.model, maxTokens: lintWriter.maxTokens ?? 8192 }
    : defaultWriter
  const allCounts: Record<string, number> = {}
  const persistentCounts: Record<string, number> = {}
  const instances: Record<string, string[]> = {}
  let totalIssues = 0
  let totalAfterFix = 0

  // Generate all seeds × runs in parallel for speed
  const jobs = seeds.flatMap(seed =>
    Array.from({ length: RUNS_PER_SEED }, (_, i) => ({ seed, run: i + 1 }))
  )

  const results = await Promise.all(jobs.map(async ({ seed, run }) => {
    const result = await generateProse(writer, writerPrompt, seed.prompt, runId, seed.name, run)
    if (!result) return null

    await saveGeneration(runId, seed.name, run, {
      prose: result.prose, wordCount: result.prose.split(/\s+/).length, passed: true,
      latencyMs: result.latencyMs, completionTokens: result.tokens,
      tokensPerSec: result.tps,
    })

    // Lint
    const lintResult = await lintProse(result.prose)

    // Fix and measure persistent issues
    const fixer = getModelForAgent("lint-fixer")
    const fixResult = await fixLintIssues(
      result.prose,
      lintResult.issues,
      fixer ? { provider: fixer.provider, model: fixer.model, temperature: fixer.temperature } : undefined,
    )
    const afterFix = await lintProse(fixResult.prose)

    console.log(`  [${seed.name}:${run}] ${lintResult.totalIssues} issues → fixed ${fixResult.deterministicFixes}d+${fixResult.llmFixes}llm → ${afterFix.totalIssues} persistent`)

    return { lintResult, afterFix, seed: seed.name }
  }))

  // Aggregate
  for (const r of results) {
    if (!r) continue
    totalIssues += r.lintResult.totalIssues
    totalAfterFix += r.afterFix.totalIssues
    for (const [cat, count] of Object.entries(r.lintResult.counts)) {
      allCounts[cat] = (allCounts[cat] || 0) + count
    }
    for (const [cat, count] of Object.entries(r.afterFix.counts)) {
      persistentCounts[cat] = (persistentCounts[cat] || 0) + count
    }
    for (const issue of r.lintResult.issues) {
      if (!instances[issue.category]) instances[issue.category] = []
      if (instances[issue.category].length < 8) {
        instances[issue.category].push(issue.sentence)
      }
    }
  }

  return { totalIssues, totalAfterFix, categories: allCounts, persistentCategories: persistentCounts, instances }
}

// ── Agent prompt (loaded from file) ───────────────────────────────────────

const IMPROVER_PROMPT = readFileSync(
  new URL("../src/agents/lint-improver/prompt.md", import.meta.url).pathname, "utf-8",
)

// ── Propose writer prompt change via lint-improver agent ─────────────────

async function proposePromptChange(
  currentPrompt: string,
  snapshot: LintSnapshot,
  iterationNum: number,
  previousAttempts: string[],
): Promise<{ newPrompt: string; explanation: string } | null> {
  const improver = getModelForAgent("improver")
  if (!improver) { console.error("No improver model configured"); return null }

  // Build rich context from DB, git history, and experiment lineage
  const context = await buildImprovementContext(snapshot, iterationNum, MAX_ITERATIONS, previousAttempts)

  try {
    const response = await getTransport().execute({
      systemPrompt: IMPROVER_PROMPT,
      userPrompt: `${context}\n\nPropose a targeted prompt modification to reduce the top persistent issue category. If all issues are fixable, target the highest-count category to prevent issues at generation time (cheaper than fixing).`,
      model: improver.model,
      provider: improver.provider,
      temperature: 0.7 + Math.min(iterationNum * 0.05, 0.3),
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
    })

    const json = JSON.parse(extractJSON(response.content))
    if (!json.newPrompt || !json.explanation) return null

    // Validate: not too different
    const originalLines = currentPrompt.split("\n").length
    const newLines = json.newPrompt.split("\n").length
    if (newLines > originalLines * 1.3) {
      console.log(`  Proposal rejected: too much growth (${originalLines} → ${newLines} lines)`)
      return null
    }

    return { newPrompt: json.newPrompt, explanation: json.explanation }
  } catch (err) {
    console.log(`  Proposal failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────

async function main() {
  const seeds = loadSeeds(seedFilter)
  const currentPrompt = readFileSync(WRITER_PROMPT_PATH, "utf-8")

  console.log("\n" + "=".repeat(60))
  console.log("  LINT-DRIVEN IMPROVEMENT LOOP")
  console.log("=".repeat(60))
  console.log(`  Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`  Runs/seed: ${RUNS_PER_SEED}`)
  console.log(`  Max iterations: ${MAX_ITERATIONS}`)
  console.log(`  Dry run: ${DRY_RUN}`)
  console.log()

  // Create experiment
  const experimentId = await createTuningExperiment(
    "lint-improvement",
    `Lint-driven writer prompt improvement (${seeds.map(s => s.name).join(", ")})`,
    { seeds: seeds.map(s => s.name), runsPerSeed: RUNS_PER_SEED, maxIterations: MAX_ITERATIONS, dryRun: DRY_RUN },
    { target: "writer", dimension: "lint" },
  )
  console.log(`  Experiment: #${experimentId}\n`)

  // Baseline
  console.log("── Baseline ──")
  const baselineRunId = await createRun("lint-improve", seeds.length.toString(), "baseline", experimentId)
  const baseline = await takeLintSnapshot(currentPrompt, seeds, baselineRunId)
  console.log(`  Baseline: ${baseline.totalIssues} total, ${baseline.totalAfterFix} persistent\n`)

  // Optional: discover new lint patterns before optimizing
  if (values.discover) {
    console.log("── Pattern Discovery ──")
    const { discoverAndApply } = await import("./lint-discover-lib")
    const discovered = await discoverAndApply(baselineRunId)
    if (discovered > 0) {
      console.log(`  Added ${discovered} new lint patterns. Re-running baseline...\n`)
      const rebaseRunId = await createRun("lint-improve", seeds.length.toString(), "baseline-post-discovery", experimentId)
      const newBaseline = await takeLintSnapshot(currentPrompt, seeds, rebaseRunId)
      console.log(`  Updated baseline: ${newBaseline.totalIssues} total, ${newBaseline.totalAfterFix} persistent\n`)
      Object.assign(baseline, newBaseline)
    } else {
      console.log("  No new patterns discovered.\n")
    }
  }

  let activePrompt = currentPrompt
  let currentSnapshot = baseline
  let consecutiveFailures = 0
  let keptCount = 0
  const previousAttempts: string[] = []

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`── Iteration ${iter}/${MAX_ITERATIONS} ──`)

    // Propose
    const proposal = await proposePromptChange(activePrompt, currentSnapshot, iter, previousAttempts)
    if (!proposal) {
      console.log("  No proposal generated. Stopping.")
      previousAttempts.push(`#${iter}: no proposal generated`)
      consecutiveFailures++
      if (consecutiveFailures >= 3) break
      continue
    }
    console.log(`  Proposal: ${proposal.explanation}`)

    if (DRY_RUN) {
      console.log("  [DRY RUN] Skipping application and benchmark.\n")
      previousAttempts.push(`#${iter}: ${proposal.explanation} (dry run, not tested)`)
      continue
    }

    // Apply change
    writeFileSync(WRITER_PROMPT_PATH, proposal.newPrompt)

    // Benchmark with new prompt
    const iterRunId = await createRun("lint-improve", seeds.length.toString(), `iter-${iter}`, experimentId)
    const newSnapshot = await takeLintSnapshot(proposal.newPrompt, seeds, iterRunId)

    const persistentDelta = newSnapshot.totalAfterFix - currentSnapshot.totalAfterFix
    const totalDelta = newSnapshot.totalIssues - currentSnapshot.totalIssues

    console.log(`  Result: ${currentSnapshot.totalAfterFix} → ${newSnapshot.totalAfterFix} persistent (${persistentDelta >= 0 ? "+" : ""}${persistentDelta})`)
    console.log(`          ${currentSnapshot.totalIssues} → ${newSnapshot.totalIssues} total (${totalDelta >= 0 ? "+" : ""}${totalDelta})`)

    // Keep if persistent issues decreased (or total decreased with persistent unchanged)
    const improved = persistentDelta < 0 || (persistentDelta === 0 && totalDelta < -1)

    if (improved) {
      console.log("  ✓ KEPT\n")
      activePrompt = proposal.newPrompt
      currentSnapshot = newSnapshot
      keptCount++
      consecutiveFailures = 0
      previousAttempts.push(`#${iter}: ${proposal.explanation} → KEPT (persistent ${persistentDelta})`)

      // Git commit
      try {
        const proc = Bun.spawn(["git", "add", "src/agents/writer/prompt.md"], { cwd: HARNESS_ROOT })
        await proc.exited
        const commitMsg = `[lint-improve] persistent ${currentSnapshot.totalAfterFix} (${persistentDelta}): ${proposal.explanation}\n\nexperiment: #${experimentId}, iter: ${iter}`
        const commitProc = Bun.spawn(["git", "commit", "-m", commitMsg], { cwd: HARNESS_ROOT })
        await commitProc.exited
      } catch { /* non-fatal */ }
    } else {
      console.log("  ✗ REVERTED\n")
      writeFileSync(WRITER_PROMPT_PATH, activePrompt)
      consecutiveFailures++
      previousAttempts.push(`#${iter}: ${proposal.explanation} → REVERTED (persistent ${persistentDelta >= 0 ? "+" : ""}${persistentDelta})`)

      if (consecutiveFailures >= 4) {
        console.log("  4 consecutive failures. Stopping.\n")
        break
      }
    }
  }

  // Conclude
  const conclusion = `Lint improvement: ${baseline.totalAfterFix} → ${currentSnapshot.totalAfterFix} persistent issues (${keptCount} kept, ${previousAttempts.length - keptCount} reverted). ` +
    `Top persistent: ${Object.entries(currentSnapshot.persistentCategories).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(", ")}`

  await concludeExperiment(experimentId, conclusion)

  console.log("=".repeat(60))
  console.log("  LINT IMPROVEMENT COMPLETE")
  console.log("=".repeat(60))
  console.log(`  Baseline: ${baseline.totalIssues} total, ${baseline.totalAfterFix} persistent`)
  console.log(`  Final:    ${currentSnapshot.totalIssues} total, ${currentSnapshot.totalAfterFix} persistent`)
  console.log(`  Kept: ${keptCount}/${previousAttempts.length}`)
  console.log(`  Experiment: #${experimentId}`)
}

main().catch(err => {
  console.error("Lint improvement failed:", err)
  process.exit(1)
})
