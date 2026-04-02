/**
 * Extraction benchmark.
 *
 * Tests the extractor agents (summary-extractor, fact-extractor, character-state):
 * given a known prose chapter, how complete and accurate are the extractions?
 *
 * Uses real harness output as input. Judges evaluate extraction quality
 * by comparing extracted data against the source prose.
 *
 * Dimensions: Completeness, Accuracy
 *
 * Run: bun benchmark/extraction/run.ts
 *      bun benchmark/extraction/run.ts --save-baseline
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { judgeScoreSchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall, getCallSummary, markBaseline,
  getRunAverages, getOverallAvg,
} from "../db"

// Load extractor prompts
const SUMMARY_PROMPT = readFileSync(new URL("../../src/agents/summary-extractor/prompt.md", import.meta.url).pathname, "utf-8")
const FACT_PROMPT = readFileSync(new URL("../../src/agents/fact-extractor/prompt.md", import.meta.url).pathname, "utf-8")
const CHAR_STATE_PROMPT = readFileSync(new URL("../../src/agents/character-state/prompt.md", import.meta.url).pathname, "utf-8")

const RUNS_PER_SAMPLE = parseInt(process.env.BENCHMARK_RUNS ?? "2")
const MAX_SAMPLES = parseInt(process.env.BENCHMARK_SAMPLES ?? "0") // 0 = all
const AGENT_FILTER = process.env.BENCHMARK_AGENT // "fact-extractor", "summary-extractor", "character-state", or undefined for all

// Load judge rubrics
const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Sample loading (uses existing novel output) ──────────────────────────

interface ProseSample { name: string; prose: string }

function loadSamples(): ProseSample[] {
  const samples: ProseSample[] = []
  const outputDir = "output"
  if (!existsSync(outputDir)) return samples

  const novelDirs = readdirSync(outputDir)
    .filter(d => d.startsWith("novel-"))
    .sort()
    .reverse()
    .slice(0, 3)  // scan up to 3 most recent novels for chapters

  for (const dir of novelDirs) {
    const chapterFiles = readdirSync(`${outputDir}/${dir}`)
      .filter(f => f.match(/^chapter-\d+\.md$/))
      .sort()

    for (const file of chapterFiles) {
      const prose = readFileSync(`${outputDir}/${dir}/${file}`, "utf-8")
        .replace(/^# .*\n\n/, "")  // strip markdown header
      if (prose.split(/\s+/).length > 200) {
        samples.push({ name: `${dir}/${file}`, prose })
      }
    }
  }

  // Apply sample limit
  if (MAX_SAMPLES > 0 && samples.length > MAX_SAMPLES) {
    return samples.slice(0, MAX_SAMPLES)
  }
  return samples
}

// ── Extractor call ───────────────────────────────────────────────────────

async function runExtractor(
  writer: WriterConfig, systemPrompt: string, prose: string,
  runId: number, extractorName: string, sampleName: string,
): Promise<{ output: string; latencyMs: number } | null> {
  const userPrompt = writer.needsNothink ? `/nothink\n${prose}` : prose
  const start = performance.now()

  try {
    const res = await fetch(writer.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${writer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writer.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        temperature: 0.1, max_tokens: 4096,
        response_format: { type: "json_object" },
        ...writer.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) { console.log(`  FAIL [http ${res.status}] ${extractorName}`); return null }

    const data = await res.json() as any
    if (data.error) { console.log(`  FAIL [api] ${extractorName}`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) { console.log(`  FAIL [empty] ${extractorName}`); return null }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const providerName = writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq"
    const cost = getTokenCost(providerName as any, writer.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    saveLLMCall(runId, "writer", extractorName, writer.model, providerName, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed: sampleName })

    return { output: content, latencyMs: Math.round(elapsed) }
  } catch (err) {
    console.log(`  FAIL [exception] ${extractorName}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judgeDimension(
  judge: JudgeConfig, dimension: Dimension, prose: string, extractedData: string,
  runId: number, sampleName: string,
): Promise<{ score: number; reasoning: string } | null> {
  const rubric = JUDGE_RUBRICS[dimension]
  const userPrompt = `ORIGINAL PROSE:\n${prose}\n\nEXTRACTED DATA:\n${extractedData}`
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

    if (!res!.ok) { console.log(`  ! ${judge.label}/${dimension} [http ${res!.status}]`); return null }
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
    saveLLMCall(runId, "judge", null, judge.model, judgeProvider, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed: sampleName, dimension })

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = judgeScoreSchema.safeParse(parsed)
    if (!result.success) return null

    return result.data
  } catch (err) {
    console.log(`  ! ${judge.label}/${dimension} [exception]`)
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()
  const writer = getWriter()
  const judges = getJudges()
  const samples = loadSamples()

  const experimentId = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : undefined
  if (!experimentId) console.log(`  (tip: set EXPERIMENT_ID to link this run to an experiment)`)

  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }
  if (samples.length === 0) { console.error("No prose samples found in output/. Run the harness first."); process.exit(1) }

  const extractorLabel = AGENT_FILTER ?? "summary + fact + character-state"
  console.log(`\nExtraction Benchmark: ${writer.label}`)
  console.log(`Samples: ${samples.length} chapters`)
  console.log(`Runs per sample: ${RUNS_PER_SAMPLE}`)
  console.log(`Extractors: ${extractorLabel}`)
  console.log(`Judges: ${judges.map(j => j.label).join(", ")}`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log()

  const runId = createRun("extraction", samples.length.toString(), `${writer.label} / ${judges.map(j => j.label).join(",")}`, experimentId)

  for (const sample of samples) {
    for (let run = 1; run <= RUNS_PER_SAMPLE; run++) {
      console.log(`[${sample.name}] Run ${run}/${RUNS_PER_SAMPLE}...`)

      // Run extractors (all or filtered to one)
      const shouldRun = (name: string) => !AGENT_FILTER || AGENT_FILTER === name
      const [summary, facts, charState] = await Promise.all([
        shouldRun("summary-extractor") ? runExtractor(writer, SUMMARY_PROMPT, sample.prose, runId, "summary-extractor", sample.name) : null,
        shouldRun("fact-extractor") ? runExtractor(writer, FACT_PROMPT, sample.prose, runId, "fact-extractor", sample.name) : null,
        shouldRun("character-state") ? runExtractor(writer, CHAR_STATE_PROMPT, sample.prose, runId, "character-state", sample.name) : null,
      ])

      if (!summary && !facts && !charState) {
        saveGeneration(runId, sample.name, run, { passed: false })
        continue
      }

      // Combine all extraction output for judging
      const combined = [
        summary ? `SUMMARY:\n${summary.output}` : "",
        facts ? `FACTS:\n${facts.output}` : "",
        charState ? `CHARACTER STATES:\n${charState.output}` : "",
      ].filter(Boolean).join("\n\n")

      const genId = saveGeneration(runId, sample.name, run, {
        prose: combined, wordCount: combined.split(/\s+/).length,
        latencyMs: Math.max(summary?.latencyMs ?? 0, facts?.latencyMs ?? 0, charState?.latencyMs ?? 0),
        passed: true,
      })

      // Judge extraction quality
      const judgeJobs = judges.flatMap(judge =>
        DIMENSIONS.map(async (dim) => {
          const score = await judgeDimension(judge, dim, sample.prose, combined, runId, sample.name)
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
  console.log("  EXTRACTION BENCHMARK RESULTS")
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
    markBaseline(runId, "extraction")
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: data/harness.db`)
}

main()
