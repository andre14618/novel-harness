/**
 * Automated improvement loop.
 *
 * Reads baseline scores + judge reasoning for a target benchmark/dimension,
 * sends them to an LLM to propose a prompt change, applies it, re-benchmarks,
 * and records whether the change improved scores.
 *
 * Usage:
 *   bun scripts/improve-loop.ts --target extraction --dimension completeness --iterations 3
 *   bun scripts/improve-loop.ts --target planning --dimension dialogue-cues --iterations 2
 *
 * The LLM used for proposing changes is set via the "improver" role
 * in models/roles.ts (centralized model assignment).
 */

import { parseArgs } from "node:util"
import { readFileSync, writeFileSync } from "node:fs"
import { getCentralDB, createTuningExperiment, concludeExperiment } from "../data/db"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { getModelForAgent } from "../models/roles"
import { extractJSON } from "../src/llm"

const { values } = parseArgs({
  options: {
    target: { type: "string" },       // "extraction", "planning", "continuity", "prose"
    dimension: { type: "string" },     // dimension to improve
    iterations: { type: "string", default: "3" },
    "dry-run": { type: "boolean", default: false },
  },
})

if (!values.target || !values.dimension) {
  console.error("Usage: bun scripts/improve-loop.ts --target <benchmark> --dimension <dim> [--iterations 3] [--dry-run]")
  process.exit(1)
}

const TARGET = values.target!
const DIMENSION = values.dimension!
const MAX_ITERATIONS = parseInt(values.iterations!)
const DRY_RUN = values["dry-run"]!

// ── Target config: which prompts to modify, which benchmark to run ───────

interface TargetConfig {
  promptFiles: Array<{ path: string; agentName: string }>
  benchmarkCmd: string
  runType: string
}

const TARGETS: Record<string, TargetConfig> = {
  extraction: {
    promptFiles: [
      { path: "src/agents/fact-extractor/prompt.md", agentName: "fact-extractor" },
      { path: "src/agents/summary-extractor/prompt.md", agentName: "summary-extractor" },
      { path: "src/agents/character-state/prompt.md", agentName: "character-state" },
    ],
    benchmarkCmd: "BENCHMARK_RUNS=2 BENCHMARK_SAMPLES=2 bun benchmark/extraction/run.ts",
    runType: "extraction",
  },
  planning: {
    promptFiles: [
      { path: "src/agents/planning-plotter/prompt.md", agentName: "planning-plotter" },
    ],
    benchmarkCmd: "BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/planning/run.ts",
    runType: "planning",
  },
  continuity: {
    promptFiles: [
      { path: "src/agents/cross-chapter-continuity/prompt.md", agentName: "cross-chapter-continuity" },
    ],
    benchmarkCmd: "BENCHMARK_FIXTURES=location-impossibility,character-knowledge-violation BENCHMARK_RUNS=2 bun benchmark/continuity/run.ts",
    runType: "continuity",
  },
  prose: {
    promptFiles: [
      { path: "src/agents/writer/prompt.md", agentName: "writer" },
    ],
    benchmarkCmd: "BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/prose/run.ts",
    runType: "prose",
  },
}

const targetConfig = TARGETS[TARGET]
if (!targetConfig) {
  console.error(`Unknown target: ${TARGET}. Available: ${Object.keys(TARGETS).join(", ")}`)
  process.exit(1)
}

// ── LLM call to propose changes ──────────────────────────────────────────

async function proposeChange(
  currentPrompts: Array<{ agentName: string; content: string }>,
  dimension: string,
  baselineScore: number,
  judgeReasoning: string[],
): Promise<{ agentName: string; newPrompt: string; explanation: string } | null> {
  const assignment = getModelForAgent("improver")
  if (!assignment) throw new Error(`No model assigned for "improver" role in models/roles.ts`)
  const model = MODELS.find(m => m.id === assignment.model && m.provider === assignment.provider)
  if (!model) throw new Error(`Model ${assignment.model} (${assignment.provider}) not found in registry`)

  const provider = PROVIDERS[model.provider]
  const apiKey = getApiKey(model.provider)

  const promptSection = currentPrompts.map(p =>
    `### ${p.agentName}\n\`\`\`\n${p.content}\n\`\`\``
  ).join("\n\n")

  const reasoningSection = judgeReasoning.slice(0, 5).map((r, i) =>
    `${i + 1}. ${r.slice(0, 400)}`
  ).join("\n\n")

  const systemPrompt = `You are an expert at improving LLM agent prompts. You will be given:
1. The current prompt(s) for one or more agents
2. The benchmark dimension being measured and its current score
3. Judge reasoning explaining WHY the score is low

Your job: propose a SPECIFIC change to ONE of the agent prompts that will improve the score on this dimension. The change should be targeted — don't rewrite the whole prompt, just add or modify the section that addresses the weakness the judge identified.

Respond with ONLY valid JSON:
{
  "agentName": "which agent's prompt to change",
  "newPrompt": "the complete new prompt (not a diff — the full replacement)",
  "explanation": "1-2 sentences on what you changed and why"
}`

  const userPrompt = `## Current Prompts

${promptSection}

## Target Dimension: ${dimension}
## Current Score: ${baselineScore}/10

## Judge Reasoning (why the score is low):

${reasoningSection}

Propose a targeted prompt change to improve the ${dimension} score. Focus on the specific weaknesses the judge identified.`

  const needsNothink = model.needsNothink
  const finalUserPrompt = needsNothink ? `/nothink\n${userPrompt}` : userPrompt

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        ...provider.extraBody?.(),
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.log(`  ! Improver LLM error: ${res.status} ${text.slice(0, 200)}`)
      return null
    }

    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)

    if (!parsed.agentName || !parsed.newPrompt || !parsed.explanation) {
      console.log("  ! Improver returned incomplete JSON")
      return null
    }

    return parsed
  } catch (err) {
    console.log(`  ! Improver error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Get scores + reasoning from DB ───────────────────────────────────────

function getLatestScores(runType: string, dimension: string): {
  avgScore: number; reasoning: string[]; runId: number
} | null {
  const db = getCentralDB()

  // Find the most recent run of this type
  const run = db.query<any, [string]>(
    "SELECT id FROM runs WHERE run_type = ? ORDER BY id DESC LIMIT 1"
  ).get(runType)
  if (!run) return null

  const scores = db.query<any, [number, string]>(`
    SELECT s.score, s.reasoning
    FROM scores s
    JOIN generations g ON g.id = s.generation_id
    WHERE g.run_id = ? AND s.dimension = ?
    ORDER BY s.score ASC
  `).all(run.id, dimension) as Array<{ score: number; reasoning: string }>

  if (scores.length === 0) return null

  const avg = scores.reduce((s, r) => s + r.score, 0) / scores.length
  return {
    avgScore: Math.round(avg * 10) / 10,
    reasoning: scores.map(s => s.reasoning).filter(Boolean),
    runId: run.id,
  }
}

// ── Run benchmark ────────────────────────────────────────────────────────

async function runBenchmark(cmd: string): Promise<number | null> {
  console.log(`  Running: ${cmd}`)
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env },
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  // Print last few lines of output
  const lines = stdout.split("\n").filter(l => l.trim())
  for (const line of lines.slice(-15)) {
    console.log(`    ${line}`)
  }

  if (exitCode !== 0) {
    console.log(`  ! Benchmark failed (exit ${exitCode})`)
    if (stderr) console.log(`    ${stderr.slice(0, 200)}`)
    return null
  }

  // Extract run ID from output
  const runIdMatch = stdout.match(/Run ID: (\d+)/)
  return runIdMatch ? parseInt(runIdMatch[1]) : null
}

// ── Main loop ────────────────────────────────────────────────────────────

async function main() {
  getCentralDB()

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  IMPROVEMENT LOOP`)
  console.log(`${"=".repeat(60)}`)
  console.log(`  Target: ${TARGET} / ${DIMENSION}`)
  console.log(`  Max iterations: ${MAX_ITERATIONS}`)
  const improverAssignment = getModelForAgent("improver")
  console.log(`  Improver: ${improverAssignment?.model ?? "unassigned"} (${improverAssignment?.provider ?? "?"})`)
  console.log(`  Dry run: ${DRY_RUN}`)
  console.log()

  // Get baseline
  const baseline = getLatestScores(targetConfig.runType, DIMENSION)
  if (!baseline) {
    console.error(`No baseline scores found for ${TARGET}/${DIMENSION}. Run the benchmark first.`)
    process.exit(1)
  }

  console.log(`  Baseline: ${baseline.avgScore}/10 (run ${baseline.runId})`)
  console.log()

  let currentScore = baseline.avgScore
  let totalImproved = 0

  // Create experiment
  const expId = await createTuningExperiment("improvement-loop", `K2-driven loop: ${TARGET}/${DIMENSION}`, {
    target: TARGET,
    dimension: DIMENSION,
    baselineScore: baseline.avgScore,
    baselineRunId: baseline.runId,
    maxIterations: MAX_ITERATIONS,
    improverModel: improverAssignment?.model ?? "unassigned",
  })

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`\n── Iteration ${iter}/${MAX_ITERATIONS} (current: ${currentScore}/10) ──`)

    // Read current prompts
    const currentPrompts = targetConfig.promptFiles.map(f => ({
      agentName: f.agentName,
      content: readFileSync(f.path, "utf-8"),
    }))

    // Get latest reasoning
    const latest = getLatestScores(targetConfig.runType, DIMENSION)
    const reasoning = latest?.reasoning ?? baseline.reasoning

    // Ask K2 to propose a change
    console.log(`  Asking improver for a change...`)
    const proposal = await proposeChange(currentPrompts, DIMENSION, currentScore, reasoning)

    if (!proposal) {
      console.log(`  No valid proposal. Stopping.`)
      break
    }

    console.log(`  Proposal: ${proposal.explanation}`)
    console.log(`  Target agent: ${proposal.agentName}`)

    // Find the file to modify
    const targetFile = targetConfig.promptFiles.find(f => f.agentName === proposal.agentName)
    if (!targetFile) {
      console.log(`  ! Agent "${proposal.agentName}" not in target file list. Skipping.`)
      continue
    }

    // Save backup
    const originalContent = readFileSync(targetFile.path, "utf-8")
    const backupPath = `${targetFile.path}.backup-iter${iter}`
    writeFileSync(backupPath, originalContent)

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would write new prompt to ${targetFile.path}`)
      console.log(`  [DRY RUN] New prompt preview: ${proposal.newPrompt.slice(0, 200)}...`)
      continue
    }

    // Apply change
    writeFileSync(targetFile.path, proposal.newPrompt)
    console.log(`  Applied change to ${targetFile.path}`)

    // Run benchmark (linked to experiment)
    const newRunId = await runBenchmark(`EXPERIMENT_ID=${expId} ${targetConfig.benchmarkCmd}`)
    if (!newRunId) {
      console.log(`  Benchmark failed. Reverting.`)
      writeFileSync(targetFile.path, originalContent)
      continue
    }

    // Check new score
    const newScores = getLatestScores(targetConfig.runType, DIMENSION)
    if (!newScores) {
      console.log(`  No scores found for new run. Reverting.`)
      writeFileSync(targetFile.path, originalContent)
      continue
    }

    const delta = Math.round((newScores.avgScore - currentScore) * 10) / 10
    const improved = delta > 0

    console.log(`\n  Result: ${currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)

    if (improved) {
      console.log(`  IMPROVED. Keeping change.`)
      currentScore = newScores.avgScore
      totalImproved++

      // Auto-commit the improvement
      const prevScore = (currentScore - delta).toFixed(1)
      const commitMsg = [
        `[agent:${proposal.agentName}] ${DIMENSION} ${prevScore} → ${currentScore.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta})`,
        ``,
        proposal.explanation,
        ``,
        `${TARGET}/${DIMENSION}: ${currentScore.toFixed(1)}/10 | iteration ${iter}/${MAX_ITERATIONS}`,
        `experiment: #${expId}`,
        `improver: ${improverAssignment?.model ?? "kimi-k2"}`,
      ].join("\n")

      await Bun.spawn(["git", "add", targetFile.path], { stdout: "pipe", stderr: "pipe" }).exited
      await Bun.spawn(["git", "commit", "-m", commitMsg], { stdout: "pipe", stderr: "pipe" }).exited
      console.log(`  Committed: ${targetFile.path}`)

      // Clean up backup
      try { require("fs").unlinkSync(backupPath) } catch {}
    } else {
      console.log(`  No improvement. Reverting.`)
      writeFileSync(targetFile.path, originalContent)

      // Commit the revert so the attempt is in history
      const revertMsg = [
        `[agent:${proposal.agentName}] revert: ${DIMENSION} ${currentScore.toFixed(1)} → ${newScores.avgScore.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta})`,
        ``,
        `Reverted: ${proposal.explanation}`,
        ``,
        `${TARGET}/${DIMENSION}: no improvement | iteration ${iter}/${MAX_ITERATIONS}`,
        `experiment: #${expId}`,
      ].join("\n")

      await Bun.spawn(["git", "add", targetFile.path], { stdout: "pipe", stderr: "pipe" }).exited
      await Bun.spawn(["git", "commit", "-m", revertMsg], { stdout: "pipe", stderr: "pipe" }).exited
      console.log(`  Committed revert: ${targetFile.path}`)

      try { require("fs").unlinkSync(backupPath) } catch {}
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────

  const finalDelta = Math.round((currentScore - baseline.avgScore) * 10) / 10
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  LOOP COMPLETE`)
  console.log(`${"=".repeat(60)}`)
  console.log(`  Target: ${TARGET} / ${DIMENSION}`)
  console.log(`  Baseline: ${baseline.avgScore}/10 → Final: ${currentScore}/10 (${finalDelta >= 0 ? "+" : ""}${finalDelta})`)
  console.log(`  Improvements kept: ${totalImproved}/${MAX_ITERATIONS}`)
  console.log(`  Experiment: #${expId}`)

  await concludeExperiment(expId,
    `Loop complete. ${baseline.avgScore} → ${currentScore} (${finalDelta >= 0 ? "+" : ""}${finalDelta}). ` +
    `${totalImproved}/${MAX_ITERATIONS} iterations improved. ` +
    `Improver: ${improverAssignment?.model ?? "kimi-k2"}.`
  )
}

main().catch(err => {
  console.error("Loop failed:", err.message)
  process.exit(1)
})
