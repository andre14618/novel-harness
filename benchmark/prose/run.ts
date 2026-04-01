import { z } from "zod"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { chapterDraftSchema } from "../../src/types"
import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { penaltySchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall, getCallSummary, markBaseline,
  getRunAverages, getBaselineAverages, getOverallAvg,
  getWeakestGenerations, getScoresForGeneration, getPerSeedAverages,
} from "../db"

// ── Config ───────────────────────────────────────────────────────────────

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "3")
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

// ── Load judge rubrics from markdown files ───────────────────────────────

const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Seed loading ─────────────────────────────────────────────────────────

function loadSeeds(): Array<{ name: string; prompt: string }> {
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seedFiles = readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .filter((f: string) => !seedFilter || seedFilter.includes(f))
    .sort()
  const seeds: Array<{ name: string; prompt: string }> = []

  for (const name of seedFiles) {
    const path = `${SEEDS_DIR}/${name}.json`
    if (!existsSync(path)) continue
    const seed = JSON.parse(readFileSync(path, "utf-8"))

    const prompt = `CHAPTER 1: "Opening"
POV Character: ${seed.characters[0].name}
Setting: The primary location
Purpose: Establish the protagonist, introduce the world, hint at the central conflict
Target: ~1000 words

SCENE BEATS (follow in order):
1. The protagonist is shown in their current situation, revealing their state through action and environment.
   Characters: ${seed.characters[0].name}
   Emotional shift: stasis -> unease

2. An interruption forces the protagonist to engage with the outside world. New information arrives.
   Characters: ${seed.characters.map((c: any) => c.name).slice(0, 2).join(", ")}
   Emotional shift: suspicion -> dread

3. The protagonist processes the new information alone. The central tension is established.
   Characters: ${seed.characters[0].name}
   Emotional shift: disbelief -> resolve

CHARACTER PROFILES:
${seed.characters.map((c: any) => `${c.name} (${c.role}): ${c.description}`).join("\n")}

Genre: ${seed.genre}
Premise: ${seed.premise}`

    seeds.push({ name, prompt })
  }

  return seeds
}

// ── Writer call ──────────────────────────────────────────────────────────

async function generateProse(writer: WriterConfig, prompt: string, runId: number, seed: string, attempt: number): Promise<{
  prose: string; latencyMs: number; tps: number; tokens: number; promptTokens: number
} | null> {
  const userPrompt = writer.needsNothink ? `/nothink\n${prompt}` : prompt
  const start = performance.now()

  try {
    const res = await fetch(writer.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${writer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writer.model,
        messages: [{ role: "system", content: WRITER_AGENT_PROMPT }, { role: "user", content: userPrompt }],
        temperature: 0.8, max_tokens: 16384,
        response_format: { type: "json_object" },
        ...writer.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) {
      const text = await res.text()
      console.log(`FAIL [http ${res.status}] ${text.slice(0, 150)} `)
      return null
    }

    const data = await res.json() as any
    if (data.error) {
      console.log(`FAIL [api] ${JSON.stringify(data.error).slice(0, 150)} `)
      return null
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.log(`FAIL [empty] no content in response. finish_reason: ${data.choices?.[0]?.finish_reason} `)
      return null
    }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const promptTokens = usage.prompt_tokens ?? 0
    const completionTokens = usage.completion_tokens ?? 0

    // Log to benchmark DB
    const providerName = writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq"
    const cost = getTokenCost(providerName as any, writer.model, promptTokens, completionTokens)
    saveLLMCall(runId, "writer", "writer", writer.model, providerName, promptTokens, completionTokens, Math.round(elapsed), cost, { seed, attempt })

    let jsonStr: string
    try { jsonStr = extractJSON(content) }
    catch { console.log(`FAIL [json] could not extract JSON. preview: ${content.slice(0, 120)} `); return null }

    let parsed: any
    try { parsed = JSON.parse(jsonStr) }
    catch { console.log(`FAIL [parse] invalid JSON after extraction. preview: ${jsonStr.slice(0, 120)} `); return null }

    const zodResult = chapterDraftSchema.safeParse(parsed)
    if (!zodResult.success) {
      console.log(`FAIL [zod] ${zodResult.error.issues.map(i => `${i.path}: ${i.message}`).join("; ").slice(0, 150)} `)
      return null
    }

    return {
      prose: parsed.prose,
      latencyMs: Math.round(elapsed),
      tps: completionTokens > 0 ? Math.round(completionTokens / (elapsed / 1000)) : 0,
      tokens: completionTokens,
      promptTokens,
    }
  } catch (err) {
    console.log(`FAIL [exception] ${err instanceof Error ? err.message : err} `)
    return null
  }
}

// ── Judge call (penalty-based) ──────────────────────────────────────────

async function judgeDimension(
  judge: JudgeConfig, dimension: Dimension, prose: string, runId: number, seed: string,
): Promise<{ count: number; issues: Array<{ quote: string; problem: string }> } | null> {
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
          messages: [
            { role: "system", content: `Here is a prose passage:\n\n${prose}\n\n---\n\n${rubric}` },
            { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
          ],
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

    if (!res!.ok) {
      const text = await res!.text()
      console.log(`  ! ${judge.label}/${dimension} [http ${res!.status}] ${text.slice(0, 100)}`)
      return null
    }

    const data = await res!.json() as any
    if (data.error) {
      console.log(`  ! ${judge.label}/${dimension} [api] ${JSON.stringify(data.error).slice(0, 100)}`)
      return null
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.log(`  ! ${judge.label}/${dimension} [empty]`)
      return null
    }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const elapsed = performance.now() - start
    const promptTokens = usage.prompt_tokens ?? 0
    const completionTokens = usage.completion_tokens ?? 0

    const judgeProvider = judge.apiUrl.includes("openai.com") ? "openai"
      : judge.apiUrl.includes("groq.com") ? "groq"
      : judge.apiUrl.includes("deepseek.com") ? "deepseek"
      : judge.apiUrl.includes("cerebras.ai") ? "cerebras"
      : "openrouter"
    const cost = getTokenCost(judgeProvider as any, judge.model, promptTokens, completionTokens)
    saveLLMCall(runId, "judge", null, judge.model, judgeProvider, promptTokens, completionTokens, Math.round(elapsed), cost, { seed, dimension })

    let jsonStr: string
    try { jsonStr = extractJSON(content) }
    catch { console.log(`  ! ${judge.label}/${dimension} [json] extraction failed`); return null }

    let parsed: any
    try { parsed = JSON.parse(jsonStr) }
    catch { console.log(`  ! ${judge.label}/${dimension} [parse] invalid JSON`); return null }

    const result = penaltySchema.safeParse(parsed)
    if (!result.success) {
      console.log(`  ! ${judge.label}/${dimension} [zod] ${result.error.issues.map(i => i.message).join("; ").slice(0, 120)}`)
      return null
    }

    // Trust issues array length over self-reported count
    return { count: result.data.issues.length, issues: result.data.issues }
  } catch (err) {
    console.log(`  ! ${judge.label}/${dimension} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Stats helpers ────────────────────────────────────────────────────────

function mean(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()

  const writer = getWriter()
  const judges = getJudges()
  const seeds = loadSeeds()
  const experimentId = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : undefined

  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }

  console.log(`\nBenchmark: ${writer.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS_PER_SEED}`)
  console.log(`Judge: ${judges.map(j => j.label).join(", ")}`)
  console.log(`Penalty dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log(`Judge calls per generation: ${judges.length} x ${DIMENSIONS.length} = ${judges.length * DIMENSIONS.length}`)
  if (experimentId) console.log(`Experiment: #${experimentId}`)
  console.log()

  const runId = createRun("prose", seeds.length.toString(), `${writer.label} / ${judges.map(j => j.label).join(",")}`, experimentId)

  // Track all scores in memory for reporting
  const allScores: Array<{ seed: string; run: number; dim: Dimension; count: number }> = []

  // ── Generate + judge all seeds ───────────────────────────────────────

  await Promise.all(
    seeds.map(async (seed) => {
      for (let run = 1; run <= RUNS_PER_SEED; run++) {
        console.log(`[${seed.name}] Run ${run}/${RUNS_PER_SEED}...`)

        const result = await generateProse(writer, seed.prompt, runId, seed.name, run)
        if (!result) {
          saveGeneration(runId, seed.name, run, { passed: false })
          console.log(`[${seed.name}] Run ${run}: FAIL`)
          continue
        }

        const words = result.prose.split(/\s+/).length
        const genId = saveGeneration(runId, seed.name, run, {
          prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
          tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
        })

        console.log(`[${seed.name}] Run ${run}: ${words}w ${result.tps}tok/s ${(result.latencyMs / 1000).toFixed(1)}s`)

        // Judge — all judges x all dimensions concurrently
        const judgeJobs = judges.flatMap(judge =>
          DIMENSIONS.map(async (dim) => {
            const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
            if (penalty) {
              // Store issue count as score, full issues JSON as reasoning
              saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
              allScores.push({ seed: seed.name, run, dim, count: penalty.count })
              console.log(`  [${seed.name}:${run}] ${DIMENSION_LABELS[dim]}: ${penalty.count} issues`)
            }
            return { judge: judge.label, dim, penalty }
          })
        )
        await Promise.all(judgeJobs)
      }
    })
  )

  // ── Report ─────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60))
  console.log("  BENCHMARK RESULTS (penalty — lower = better)")
  console.log("=".repeat(60))

  console.log(`\n  Writer: ${writer.label}`)
  console.log(`  Judge: ${judges.map(j => j.label).join(", ")}`)
  console.log(`  Seeds: ${seeds.length} x ${RUNS_PER_SEED} runs`)

  // Per-dimension averages
  console.log(`\n  Per-dimension averages (issues per generation):`)
  const dimStats: Array<{ dim: Dimension; avg: number; std: number }> = []
  for (const dim of DIMENSIONS) {
    const counts = allScores.filter(s => s.dim === dim).map(s => s.count)
    const avg = mean(counts)
    const std = stddev(counts)
    dimStats.push({ dim, avg, std })
    console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${avg.toFixed(1)} issues (+-${std.toFixed(1)})`)
  }
  const totalAvg = mean(allScores.map(s => s.count))
  const totalStd = stddev(allScores.map(s => s.count))
  console.log(`    ${"TOTAL".padEnd(14)} ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)})`)

  // Per-seed breakdown
  console.log(`\n  Per-seed breakdown:`)
  for (const seed of seeds) {
    const seedScores = allScores.filter(s => s.seed === seed.name)
    const dimStr = DIMENSIONS.map(dim => {
      const counts = seedScores.filter(s => s.dim === dim).map(s => s.count)
      return `${DIMENSION_LABELS[dim]}:${mean(counts).toFixed(1)}`
    }).join(" ")
    const seedAvg = mean(seedScores.map(s => s.count))
    console.log(`    ${seed.name.padEnd(24)} ${dimStr} (avg ${seedAvg.toFixed(1)})`)
  }

  // Commit-ready summary
  const dimShort = dimStats.map(d => {
    const label = d.dim === "telling" ? "T" : d.dim === "dead-weight" ? "W" : "D"
    return `${label}:${d.avg.toFixed(1)}`
  }).join(" ")
  const summary = `benchmark: ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)}) ${dimShort}`
  console.log(`\n  Commit line:\n  ${summary}\n  ${seeds.length} seeds x ${RUNS_PER_SEED} runs | penalty mode`)

  // ── Compare to baseline ────────────────────────────────────────────────

  const baselineAvgs = getBaselineAverages("prose")
  if (baselineAvgs) {
    console.log(`\n  vs Baseline:`)
    for (const dim of DIMENSIONS) {
      const current = dimStats.find(d => d.dim === dim)
      const baseline = baselineAvgs.find(d => d.dimension === dim)
      if (current && baseline) {
        const delta = Math.round((current.avg - baseline.avg) * 10) / 10
        if (Math.abs(delta) >= 0.2) {
          // For penalties: negative delta = improvement (fewer issues)
          const arrow = delta < 0 ? "" : "+"
          const quality = delta < 0 ? "(better)" : "(worse)"
          console.log(`    ${DIMENSION_LABELS[dim]}: ${arrow}${delta} issues (${baseline.avg} -> ${current.avg.toFixed(1)}) ${quality}`)
        }
      }
    }
  }

  // ── Cost & TPS summary ─────────────────────────────────────────────────

  const callSummary = getCallSummary(runId)
  if (callSummary.length > 0) {
    console.log(`\n  Cost & TPS breakdown:`)
    let totalCost = 0
    for (const c of callSummary) {
      totalCost += c.totalCost
      const tps = c.avgTps ? `${c.avgTps} tok/s` : "—"
      console.log(`    ${c.agent.padEnd(8)} ${c.model.padEnd(35)} ${`${c.calls}`.padStart(4)} calls  $${c.totalCost.toFixed(4).padStart(8)}  ${tps.padStart(12)}  ${c.totalPrompt + c.totalCompletion} tokens`)
    }
    console.log(`    ${"TOTAL".padEnd(44)} ${callSummary.reduce((s, c) => s + c.calls, 0).toString().padStart(4)} calls  $${totalCost.toFixed(4).padStart(8)}`)
  }

  // ── Save baseline if requested ─────────────────────────────────────────

  if (process.argv.includes("--save-baseline")) {
    markBaseline(runId, "prose")
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: data/harness.db`)
}

main()
