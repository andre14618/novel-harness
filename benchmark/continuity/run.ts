/**
 * Continuity benchmark.
 *
 * Tests the continuity and cross-chapter-continuity agents:
 * given prose with planted contradictions, does the checker find them?
 *
 * Uses test fixtures with known issues. Judges evaluate detection rate
 * and fix quality.
 *
 * Dimensions: Issue Detection, Fix Quality
 *
 * Run: bun benchmark/continuity/run.ts
 *      bun benchmark/continuity/run.ts --save-baseline
 *
 * NOTE: Requires test fixtures in benchmark/continuity/fixtures/.
 *       See fixture format below. Create fixtures before running.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { detectionScoreSchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall, getCallSummary, markBaseline,
  getRunAverages, getOverallAvg,
} from "../db"

// Load continuity agent prompt
const CONTINUITY_PROMPT = readFileSync(new URL("../../src/agents/cross-chapter-continuity/prompt.md", import.meta.url).pathname, "utf-8")

const RUNS_PER_FIXTURE = parseInt(process.env.BENCHMARK_RUNS ?? "2")
const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname

// Load judge rubrics
const JUDGE_RUBRICS: Record<string, string> = {}
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Fixture format ───────────────────────────────────────────────────────
//
// Each fixture is a JSON file in benchmark/continuity/fixtures/:
//
// {
//   "name": "timeline-contradiction",
//   "description": "Chapter 2 says morning but ch1 ended at night with no time skip",
//   "chapters": [
//     { "number": 1, "prose": "..." },
//     { "number": 2, "prose": "..." }
//   ],
//   "facts": [
//     { "fact": "Scene ends at midnight", "chapter": 1 },
//     { "fact": "No time skip between chapters", "chapter": 1 }
//   ],
//   "plantedIssues": [
//     { "description": "Chapter 2 opens with 'morning sun' but chapter 1 ended at midnight with no time skip", "chapter": 2 }
//   ]
// }

interface Fixture {
  name: string
  description: string
  chapters: Array<{ number: number; prose: string }>
  facts: Array<{ fact: string; chapter: number }>
  plantedIssues: Array<{ description: string; chapter: number }>
}

function loadFixtures(filter?: string[]): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) {
    console.log(`  No fixtures directory at ${FIXTURES_DIR}`)
    console.log(`  Create fixtures to run the continuity benchmark.`)
    return []
  }

  return readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(`${FIXTURES_DIR}/${f}`, "utf-8")) as Fixture)
    .filter(f => !filter || filter.includes(f.name))
}

// ── Continuity checker call ──────────────────────────────────────────────

async function runChecker(
  writer: WriterConfig, fixture: Fixture, runId: number,
): Promise<{ output: string; latencyMs: number } | null> {
  const context = `CHAPTERS:\n${fixture.chapters.map(c =>
    `--- Chapter ${c.number} ---\n${c.prose}`
  ).join("\n\n")}\n\nESTABLISHED FACTS:\n${fixture.facts.map(f =>
    `[ch${f.chapter}] ${f.fact}`
  ).join("\n")}`

  const userPrompt = writer.needsNothink ? `/nothink\n${context}` : context
  const start = performance.now()

  try {
    const res = await fetch(writer.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${writer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writer.model,
        messages: [{ role: "system", content: CONTINUITY_PROMPT }, { role: "user", content: userPrompt }],
        temperature: 0.2, max_tokens: 4096,
        response_format: { type: "json_object" },
        ...writer.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) { console.log(`  FAIL [http ${res.status}]`); return null }

    const data = await res.json() as any
    if (data.error) { console.log(`  FAIL [api]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) { console.log(`  FAIL [empty]`); return null }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const providerName = writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq"
    const cost = getTokenCost(providerName as any, writer.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    saveLLMCall(runId, "writer", "cross-chapter-continuity", writer.model, providerName, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed: fixture.name })

    return { output: content, latencyMs: Math.round(elapsed) }
  } catch (err) {
    console.log(`  FAIL [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judgeDimension(
  judge: JudgeConfig, dimension: Dimension, fixture: Fixture, checkerOutput: string,
  runId: number,
): Promise<{ score: number; reasoning: string } | null> {
  const rubric = JUDGE_RUBRICS[dimension]

  const userPrompt = `CHECKER OUTPUT:\n${checkerOutput}\n\nKNOWN PLANTED ISSUES:\n${fixture.plantedIssues.map((p, i) =>
    `${i + 1}. [ch${p.chapter}] ${p.description}`
  ).join("\n")}\n\nORIGINAL PROSE (for reference):\n${fixture.chapters.map(c =>
    `--- Chapter ${c.number} ---\n${c.prose.slice(0, 500)}...`
  ).join("\n\n")}`

  const start = performance.now()

  try {
    const tokenParam = judge.useMaxCompletionTokens
      ? { max_completion_tokens: 4096 }
      : { max_tokens: 4096 }

    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [{ role: "system", content: rubric }, { role: "user", content: userPrompt }],
          temperature: 0.1,
          ...tokenParam,
          response_format: { type: "json_object" },
          ...judge.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    if (!res!.ok) return null
    const data = await res!.json() as any
    if (data.error) return null

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const elapsed = performance.now() - start
    const judgeProvider = judge.apiUrl.includes("openai.com") ? "openai"
      : judge.apiUrl.includes("groq.com") ? "groq"
      : judge.apiUrl.includes("deepseek.com") ? "deepseek"
      : judge.apiUrl.includes("cerebras.ai") ? "cerebras"
      : "openrouter"
    const cost = getTokenCost(judgeProvider as any, judge.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    saveLLMCall(runId, "judge", null, judge.model, judgeProvider, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed: fixture.name, dimension })

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    // Use detection schema for detection dim, basic score for fix-quality
    const schema = dimension === "detection" ? detectionScoreSchema : detectionScoreSchema
    const result = schema.safeParse(parsed)
    if (!result.success) return null

    return result.data
  } catch (err) {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()
  const writer = getWriter()
  const judges = getJudges()
  const fixtureFilter = process.env.BENCHMARK_FIXTURES?.split(",").map(s => s.trim())
  const fixtures = loadFixtures(fixtureFilter)

  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }
  if (fixtures.length === 0) {
    console.log("\nContinuity Benchmark: no fixtures found")
    console.log(`Create JSON fixtures in benchmark/continuity/fixtures/`)
    console.log("See benchmark/continuity/run.ts for fixture format.")
    process.exit(0)
  }

  console.log(`\nContinuity Benchmark: ${writer.label}`)
  console.log(`Fixtures: ${fixtures.map(f => f.name).join(", ")}`)
  console.log(`Planted issues: ${fixtures.reduce((s, f) => s + f.plantedIssues.length, 0)} total`)
  console.log(`Runs per fixture: ${RUNS_PER_FIXTURE}`)
  console.log(`Judges: ${judges.map(j => j.label).join(", ")}`)
  console.log()

  const runId = createRun("continuity", fixtures.length.toString(), `${writer.label} / ${judges.map(j => j.label).join(",")}`)

  for (const fixture of fixtures) {
    for (let run = 1; run <= RUNS_PER_FIXTURE; run++) {
      console.log(`[${fixture.name}] Run ${run}/${RUNS_PER_FIXTURE} (${fixture.plantedIssues.length} planted issues)...`)

      const result = await runChecker(writer, fixture, runId)
      if (!result) {
        saveGeneration(runId, fixture.name, run, { passed: false })
        continue
      }

      const genId = saveGeneration(runId, fixture.name, run, {
        prose: result.output, wordCount: result.output.split(/\s+/).length,
        latencyMs: result.latencyMs, passed: true,
      })

      const judgeJobs = judges.flatMap(judge =>
        DIMENSIONS.map(async (dim) => {
          const score = await judgeDimension(judge, dim, fixture, result.output, runId)
          if (score) {
            saveScore(genId, judge.label, dim, score.score, score.reasoning)
            console.log(`  ${judge.label}/${DIMENSION_LABELS[dim]}: ${score.score}/10`)
          }
        })
      )
      await Promise.all(judgeJobs)
    }
  }

  // ── Report ───────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60))
  console.log("  CONTINUITY BENCHMARK RESULTS")
  console.log("=".repeat(60))

  const dimAvgs = getRunAverages(runId)
  const overall = getOverallAvg(runId)

  console.log(`\n  Per-dimension averages:`)
  for (const dim of DIMENSIONS) {
    const avg = dimAvgs.find(d => d.dimension === dim)
    if (avg) console.log(`    ${DIMENSION_LABELS[dim].padEnd(18)} ${avg.avg}/10 (+-${avg.stddev})`)
  }
  console.log(`    ${"OVERALL".padEnd(18)} ${overall.mean}/20 (+-${overall.stddev})`)

  const callSummary = getCallSummary(runId)
  if (callSummary.length > 0) {
    console.log(`\n  Cost & TPS:`)
    let totalCost = 0
    for (const c of callSummary) {
      totalCost += c.totalCost
      const tps = c.avgTps ? `${c.avgTps} tok/s` : "—"
      console.log(`    ${c.agent.padEnd(8)} ${c.model.padEnd(35)} ${`${c.calls}`.padStart(4)} calls  $${c.totalCost.toFixed(4).padStart(8)}  ${tps}`)
    }
    console.log(`    ${"TOTAL".padEnd(44)} $${totalCost.toFixed(4).padStart(8)}`)
  }

  if (process.argv.includes("--save-baseline")) {
    markBaseline(runId, "continuity")
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: data/harness.db`)
}

main()
