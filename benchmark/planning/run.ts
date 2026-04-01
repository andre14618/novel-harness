/**
 * Planning benchmark.
 *
 * Tests the planning-plotter agent: given a seed (world + characters + story spine),
 * how good are the chapter outlines it produces?
 *
 * Dimensions: Beat Specificity, Dialogue Cues, Emotional Arc
 *
 * Run: bun benchmark/planning/run.ts
 *      bun benchmark/planning/run.ts --save-baseline
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { judgeScoreSchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall, getCallSummary, markBaseline,
  getRunAverages, getBaselineAverages, getOverallAvg, getPerSeedAverages,
} from "../db"

// Uses the planning-plotter agent's prompt
const PLANNER_PROMPT_PATH = new URL("../../src/agents/planning-plotter/prompt.md", import.meta.url).pathname
const PLANNER_PROMPT = readFileSync(PLANNER_PROMPT_PATH, "utf-8")

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "3")
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

// Load judge rubrics
const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Seed loading (builds planning context from seed data) ────────────────

function loadSeeds(): Array<{ name: string; prompt: string }> {
  const seedFiles = readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .sort()
  const seeds: Array<{ name: string; prompt: string }> = []

  for (const name of seedFiles) {
    const path = `${SEEDS_DIR}/${name}.json`
    if (!existsSync(path)) continue
    const seed = JSON.parse(readFileSync(path, "utf-8"))

    // Simulate the context the planning-plotter would receive
    const prompt = `STORY CONTEXT:
Genre: ${seed.genre}
Premise: ${seed.premise}
Tone: ${seed.tone ?? "not specified"}

CHARACTERS:
${seed.characters.map((c: any) => `- ${c.name} (${c.role}): ${c.description}`).join("\n")}

STORY SPINE:
Act 1: Establish ${seed.characters[0].name} in their world. Introduce the central conflict.
Act 2: Escalate. The truth emerges. Alliances shift.
Act 3: Confrontation and resolution.

Generate detailed chapter outlines for 3 chapters (one per act). Each chapter needs specific scene beats with physical actions, dialogue moments, and emotional shifts.`

    seeds.push({ name, prompt })
  }
  return seeds
}

// ── Planner call ─────────────────────────────────────────────────────────

async function generateOutline(writer: WriterConfig, prompt: string, runId: number, seed: string, attempt: number): Promise<{
  outline: string; latencyMs: number; tps: number; tokens: number
} | null> {
  const userPrompt = writer.needsNothink ? `/nothink\n${prompt}` : prompt
  const start = performance.now()

  try {
    const res = await fetch(writer.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${writer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writer.model,
        messages: [{ role: "system", content: PLANNER_PROMPT }, { role: "user", content: userPrompt }],
        temperature: 0.6, max_tokens: 8192,
        response_format: { type: "json_object" },
        ...writer.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) { console.log(`FAIL [http ${res.status}]`); return null }

    const data = await res.json() as any
    if (data.error) { console.log(`FAIL [api]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) { console.log(`FAIL [empty]`); return null }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const promptTokens = usage.prompt_tokens ?? 0
    const completionTokens = usage.completion_tokens ?? 0

    const providerName = writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq"
    const cost = getTokenCost(providerName as any, writer.model, promptTokens, completionTokens)
    saveLLMCall(runId, "writer", writer.model, providerName, promptTokens, completionTokens, Math.round(elapsed), cost, { seed, attempt })

    return {
      outline: content,
      latencyMs: Math.round(elapsed),
      tps: completionTokens > 0 ? Math.round(completionTokens / (elapsed / 1000)) : 0,
      tokens: completionTokens,
    }
  } catch (err) {
    console.log(`FAIL [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judgeDimension(
  judge: JudgeConfig, dimension: Dimension, outline: string, runId: number, seed: string,
): Promise<{ score: number; reasoning: string } | null> {
  const rubric = JUDGE_RUBRICS[dimension]
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
          messages: [{ role: "system", content: rubric }, { role: "user", content: outline }],
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

    if (!res!.ok) { console.log(`  ! ${judge.label}/${dimension} [http ${res!.status}]`); return null }
    const data = await res!.json() as any
    if (data.error) { console.log(`  ! ${judge.label}/${dimension} [api error]`); return null }

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
    saveLLMCall(runId, "judge", judge.model, judgeProvider, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed, dimension })

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = judgeScoreSchema.safeParse(parsed)
    if (!result.success) { console.log(`  ! ${judge.label}/${dimension} [zod]`); return null }

    return result.data
  } catch (err) {
    console.log(`  ! ${judge.label}/${dimension} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

async function main() {
  getDB()
  const writer = getWriter()
  const judges = getJudges()
  const seeds = loadSeeds()

  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }

  console.log(`\nPlanning Benchmark: ${writer.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS_PER_SEED}`)
  console.log(`Judges: ${judges.map(j => j.label).join(", ")}`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log()

  const providerName = writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq"
  const runId = createRun("planning", providerName, writer.model, seeds.length, RUNS_PER_SEED)

  await Promise.all(
    seeds.map(async (seed) => {
      for (let run = 1; run <= RUNS_PER_SEED; run++) {
        console.log(`[${seed.name}] Run ${run}/${RUNS_PER_SEED}...`)
        const result = await generateOutline(writer, seed.prompt, runId, seed.name, run)
        if (!result) {
          saveGeneration(runId, seed.name, run, { passed: false })
          continue
        }

        const genId = saveGeneration(runId, seed.name, run, {
          prose: result.outline, wordCount: result.outline.split(/\s+/).length,
          latencyMs: result.latencyMs, tokensPerSec: result.tps,
          completionTokens: result.tokens, passed: true,
        })

        console.log(`[${seed.name}] Run ${run}: ${result.tps}tok/s ${(result.latencyMs / 1000).toFixed(1)}s`)

        const judgeJobs = judges.flatMap(judge =>
          DIMENSIONS.map(async (dim) => {
            const score = await judgeDimension(judge, dim, result.outline, runId, seed.name)
            if (score) {
              saveScore(genId, judge.label, dim, score.score, score.reasoning)
              console.log(`  [${seed.name}:${run}] ${judge.label}/${DIMENSION_LABELS[dim]}: ${score.score}/10`)
            }
          })
        )
        await Promise.all(judgeJobs)
      }
    })
  )

  // ── Report ───────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60))
  console.log("  PLANNING BENCHMARK RESULTS")
  console.log("=".repeat(60))

  const dimAvgs = getRunAverages(runId)
  const overall = getOverallAvg(runId)

  console.log(`\n  Per-dimension averages:`)
  for (const dim of DIMENSIONS) {
    const avg = dimAvgs.find(d => d.dimension === dim)
    if (avg) console.log(`    ${DIMENSION_LABELS[dim].padEnd(18)} ${avg.avg}/10 (+-${avg.stddev})`)
  }
  console.log(`    ${"OVERALL".padEnd(18)} ${overall.mean}/30 (+-${overall.stddev})`)

  const callSummary = getCallSummary(runId)
  if (callSummary.length > 0) {
    console.log(`\n  Cost & TPS:`)
    let totalCost = 0
    for (const c of callSummary) {
      totalCost += c.totalCost
      const tps = c.avgTps ? `${c.avgTps} tok/s` : "—"
      console.log(`    ${c.callType.padEnd(8)} ${c.model.padEnd(35)} ${`${c.calls}`.padStart(4)} calls  $${c.totalCost.toFixed(4).padStart(8)}  ${tps}`)
    }
    console.log(`    ${"TOTAL".padEnd(44)} $${totalCost.toFixed(4).padStart(8)}`)
  }

  if (process.argv.includes("--save-baseline")) {
    markBaseline(runId)
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: benchmark/results/benchmark.db`)
}

main()
