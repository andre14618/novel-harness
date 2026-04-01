import { z } from "zod"
import { chapterDraftSchema } from "../src/types"
import { WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"
import { getTokenCost } from "../src/config/pricing"
import { readFileSync, existsSync, mkdirSync } from "node:fs"

// ── Config ────────────────────────────────────────────────────────────────

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "3")
const SEEDS_DIR = new URL("../src/seeds", import.meta.url).pathname
const RESULTS_DIR = "output/benchmarks"
const BASELINE_PATH = `${RESULTS_DIR}/baseline.json`

// ── Types ─────────────────────────────────────────────────────────────────

interface WriterConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  needsNothink?: boolean
}

interface JudgeConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  useMaxCompletionTokens?: boolean
}

interface RunResult {
  seed: string
  run: number
  words: number
  passed: boolean
  latencyMs: number
  tokensPerSec: number
  completionTokens: number
  prose: string
}

interface JudgeScore {
  judge: string
  seed: string
  run: number
  showDontTell: number
  dialogueQuality: number
  voiceConsistency: number
  beatAdherence: number
  sensoryDetail: number
  total: number
}

interface BenchmarkResult {
  timestamp: string
  writer: string
  seeds: string[]
  runsPerSeed: number
  judges: string[]
  scores: JudgeScore[]
  averages: Record<string, { mean: number; stddev: number }>
  summary: string
}

// ── Writer config ─────────────────────────────────────────────────────────

function getWriter(): WriterConfig {
  const provider = process.env.BENCHMARK_PROVIDER ?? process.env.LLM_PROVIDER ?? "groq"
  if (provider === "groq" && process.env.GROQ_API_KEY) {
    return {
      label: "Groq Qwen3 32B",
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: "qwen/qwen3-32b",
      needsNothink: true,
    }
  }
  if (provider === "cerebras" && process.env.CEREBRAS_API_KEY) {
    return {
      label: "Cerebras Qwen3 235B",
      apiUrl: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: process.env.CEREBRAS_API_KEY,
      model: "qwen-3-235b-a22b-instruct-2507",
    }
  }
  throw new Error("No writer API key found. Set GROQ_API_KEY or CEREBRAS_API_KEY")
}

// ── Judge configs ─────────────────────────────────────────────────────────

function getJudges(): JudgeConfig[] {
  const judges: JudgeConfig[] = []

  if (process.env.OPENAI_API_KEY) {
    judges.push({
      label: "GPT-5.4-mini",
      apiUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-5.4-mini",
      useMaxCompletionTokens: true,
    })
  }

  if (process.env.GROQ_API_KEY) {
    judges.push({
      label: "Kimi K2",
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: process.env.GROQ_API_KEY,
      model: "moonshotai/kimi-k2-instruct",
    })
  }

  if (process.env.OPENROUTER_API_KEY) {
    judges.push({
      label: "Gemini 3 Flash",
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: "google/gemini-3-flash-preview",
    })
  }

  return judges
}

// ── Seed loading ──────────────────────────────────────────────────────────

function loadSeeds(): Array<{ name: string; prompt: string }> {
  const { readdirSync } = require("node:fs")
  const seedFiles = readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .sort()
  const seeds: Array<{ name: string; prompt: string }> = []

  for (const name of seedFiles) {
    const path = `${SEEDS_DIR}/${name}.json`
    if (!existsSync(path)) continue
    const seed = JSON.parse(readFileSync(path, "utf-8"))
    const charList = seed.characters.map((c: any) => `- ${c.name} (${c.role}): ${c.description}`).join("\n")

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

// ── Writer call ───────────────────────────────────────────────────────────

async function generateProse(writer: WriterConfig, prompt: string): Promise<{ prose: string; latencyMs: number; tps: number; tokens: number; error?: string } | null> {
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

    const usage = data.usage ?? { completion_tokens: 0 }

    let jsonStr: string
    try {
      jsonStr = extractJSON(content)
    } catch {
      console.log(`FAIL [json] could not extract JSON. preview: ${content.slice(0, 120)} `)
      return null
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      console.log(`FAIL [parse] invalid JSON after extraction. preview: ${jsonStr.slice(0, 120)} `)
      return null
    }

    const zodResult = chapterDraftSchema.safeParse(parsed)
    if (!zodResult.success) {
      console.log(`FAIL [zod] ${zodResult.error.issues.map(i => `${i.path}: ${i.message}`).join("; ").slice(0, 150)} `)
      return null
    }

    return {
      prose: parsed.prose,
      latencyMs: Math.round(elapsed),
      tps: Math.round(usage.completion_tokens / (elapsed / 1000)),
      tokens: usage.completion_tokens,
    }
  } catch (err) {
    console.log(`FAIL [exception] ${err instanceof Error ? err.message : err} `)
    return null
  }
}

// ── Judge call ────────────────────────────────────────────────────────────

const judgeSchema = z.object({
  showDontTell: z.coerce.number().min(1).max(10),
  dialogueQuality: z.coerce.number().min(1).max(10),
  voiceConsistency: z.coerce.number().min(1).max(10),
  beatAdherence: z.coerce.number().min(1).max(10),
  sensoryDetail: z.coerce.number().min(1).max(10),
  reasoning: z.string().default(""),
}).passthrough()

const JUDGE_PROMPT = `You are a literary critic scoring a prose sample. Score on 5 dimensions from 1-10:

1. **Show Don't Tell** (1-3: heavy exposition, 4-6: mixed, 7-8: mostly shown, 9-10: masterful)
2. **Dialogue Quality** (1-3: stilted/absent, 4-6: functional, 7-8: distinctive voices, 9-10: unmistakable)
3. **Voice Consistency** (1-3: generic, 4-6: mostly consistent, 7-8: strong POV, 9-10: immersive)
4. **Beat Adherence** (1-3: misses beats, 4-6: hits most, 7-8: natural flow, 9-10: inevitable)
5. **Sensory Detail** (1-3: abstract, 4-6: some detail, 7-8: vivid, 9-10: you can taste the dust)

Respond with ONLY valid JSON:
{"showDontTell": N, "dialogueQuality": N, "voiceConsistency": N, "beatAdherence": N, "sensoryDetail": N, "reasoning": "1-2 sentences"}

Be harsh. Reserve 9-10 for genuinely exceptional writing.`

async function judgeProse(judge: JudgeConfig, prose: string): Promise<z.infer<typeof judgeSchema> | null> {
  const label = judge.label
  try {
    const tokenParam = judge.useMaxCompletionTokens
      ? { max_completion_tokens: 1024 }
      : { max_tokens: 1024 }

    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [{ role: "system", content: JUDGE_PROMPT }, { role: "user", content: prose }],
          temperature: 0.1,
          ...tokenParam,
          response_format: { type: "json_object" },
          ...judge.extraBody,
        }),
      })
      if (res.status === 429 || res.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    if (!res!.ok) {
      const text = await res!.text()
      console.log(`  ! ${label} [http ${res!.status}] ${text.slice(0, 100)}`)
      return null
    }

    const data = await res.json() as any
    if (data.error) {
      console.log(`  ! ${label} [api] ${JSON.stringify(data.error).slice(0, 100)}`)
      return null
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.log(`  ! ${label} [empty] no content. finish_reason: ${data.choices?.[0]?.finish_reason}`)
      return null
    }

    let jsonStr: string
    try {
      jsonStr = extractJSON(content)
    } catch {
      console.log(`  ! ${label} [json] extraction failed. preview: ${content.slice(0, 100)}`)
      return null
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      console.log(`  ! ${label} [parse] invalid JSON. preview: ${jsonStr.slice(0, 100)}`)
      return null
    }

    const result = judgeSchema.safeParse(parsed)
    if (!result.success) {
      console.log(`  ! ${label} [zod] ${result.error.issues.map(i => `${i.path}: ${i.message}`).join("; ").slice(0, 120)}`)
      console.log(`  ! ${label} [zod] keys: ${Object.keys(parsed).join(", ")}`)
      return null
    }
    return result.data
  } catch (err) {
    console.log(`  ! ${label} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Diagnostic Pass ───────────────────────────────────────────────────────

const diagnosticSchema = z.object({
  suggestions: z.array(z.object({
    category: z.enum(["prompt", "context", "config"]),
    targetDimension: z.string(),
    problem: z.string(),
    change: z.string(),
    reasoning: z.string(),
  })).min(1).max(3),
})

const DIAGNOSTIC_PROMPT = `You are a prompt engineer diagnosing why an LLM prose writer underperforms. You will see:
1. The writer's system prompt
2. The context template (how the user prompt is assembled from data)
3. Score averages across 5 dimensions
4. The 2 weakest prose samples with judge reasoning

For each suggestion, identify ONE of these change categories:
- "prompt": Reword an EXISTING rule in the system prompt. Do NOT add new rules.
- "context": Restructure what data the model sees, or change the ordering/emphasis of context sections.
- "config": Change temperature, maxTokens, or other generation parameters.

Respond with ONLY valid JSON:
{
  "suggestions": [
    {
      "category": "prompt|context|config",
      "targetDimension": "which score dimension this targets",
      "problem": "what specifically is failing in the output",
      "change": "the exact change to make — for prompt, quote the current text and the replacement; for context, describe the structural change; for config, state the parameter and new value",
      "reasoning": "why this change addresses the problem"
    }
  ]
}

Rules:
- Maximum 3 suggestions, prioritized by impact
- Never suggest adding new rules to the prompt — reword or restructure existing ones
- Be specific — "improve dialogue" is not actionable, "move speech pattern data to appear directly before scene beats" is
- Each suggestion must target a different dimension or a different root cause`

async function runDiagnostic(
  dimAvgs: Record<string, number>,
  allScores: JudgeScore[],
  allRuns: RunResult[],
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("\n  Diagnostic: skipped (no OPENAI_API_KEY)")
    return
  }

  console.log("=".repeat(60))
  console.log("  DIAGNOSTIC PASS (GPT-5.4)")
  console.log("=".repeat(60))

  // Load current writer prompt and context template
  const writerPromptPath = new URL("../src/agents/writer/prompt.md", import.meta.url).pathname
  const writerContextPath = new URL("../src/agents/writer/context.ts", import.meta.url).pathname
  const writerPrompt = readFileSync(writerPromptPath, "utf-8")
  const writerContext = readFileSync(writerContextPath, "utf-8")

  // Find 2 weakest samples by average judge score
  const runScores = new Map<string, number[]>()
  for (const s of allScores) {
    const key = `${s.seed}-${s.run}`
    if (!runScores.has(key)) runScores.set(key, [])
    runScores.get(key)!.push(s.total)
  }
  const ranked = [...runScores.entries()]
    .map(([key, scores]) => ({ key, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => a.avg - b.avg)

  const weakest = ranked.slice(0, 2)
  const weakSamples: string[] = []
  for (const w of weakest) {
    const [seed, runNum] = w.key.split("-")
    const run = allRuns.find(r => r.seed === seed && r.run === parseInt(runNum) && r.passed)
    if (run?.prose) {
      const judges = allScores.filter(s => s.seed === seed && s.run === parseInt(runNum))
      const judgeInfo = judges.map(j => `${j.judge}: ${j.total}/50 — "${j.reasoning}"`).join("\n")
      weakSamples.push(`--- ${seed} run ${runNum} (avg ${w.avg.toFixed(1)}/50) ---\nJudge feedback:\n${judgeInfo}\n\nProse excerpt (first 800 chars):\n${run.prose.slice(0, 800)}`)
    }
  }

  const dims = ["showDontTell", "dialogueQuality", "voiceConsistency", "beatAdherence", "sensoryDetail"]
  const dimLabels = ["Show/Tell", "Dialogue", "Voice", "Beats", "Sensory"]
  const scoresSummary = dims.map((d, i) => `${dimLabels[i]}: ${dimAvgs[d]}/10`).join(", ")

  const userPrompt = `WRITER SYSTEM PROMPT (src/agents/writer/prompt.md):
${writerPrompt}

CONTEXT TEMPLATE (src/agents/writer/context.ts):
${writerContext}

DIMENSION SCORES (averaged across ${allScores.length} judge calls):
${scoresSummary}

WEAKEST SAMPLES:
${weakSamples.join("\n\n")}

Diagnose the root causes of the weak dimensions and suggest up to 3 changes.`

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: DIAGNOSTIC_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.log(`  Diagnostic failed: HTTP ${res.status} ${text.slice(0, 100)}`)
      return
    }

    const data = await res.json() as any
    const content = data.choices[0].message.content
    const parsed = JSON.parse(extractJSON(content))
    const result = diagnosticSchema.safeParse(parsed)

    if (!result.success) {
      console.log(`  Diagnostic failed: Zod ${result.error.issues.map(i => i.message).join("; ")}`)
      return
    }

    for (const s of result.data.suggestions) {
      console.log(`\n  [${s.category}] → ${s.targetDimension}`)
      console.log(`  Problem: ${s.problem}`)
      console.log(`  Change: ${s.change}`)
      console.log(`  Why: ${s.reasoning}`)
    }
    console.log()

    // Save diagnostics alongside benchmark results
    await Bun.write(`${RESULTS_DIR}/diagnostic-${Date.now()}.json`, JSON.stringify(result.data, null, 2))
  } catch (err) {
    console.log(`  Diagnostic failed: ${err instanceof Error ? err.message : err}`)
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1))
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

  const writer = getWriter()
  const judges = getJudges()
  const seeds = loadSeeds()

  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }

  console.log(`\nBenchmark: ${writer.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS_PER_SEED}`)
  console.log(`Judges: ${judges.map(j => j.label).join(", ")}`)
  console.log()

  const allScores: JudgeScore[] = []
  const allRuns: RunResult[] = []

  // Run all seeds in parallel, runs within each seed sequential
  const seedResults = await Promise.all(
    seeds.map(async (seed) => {
      const seedScores: JudgeScore[] = []
      const seedRuns: RunResult[] = []

      for (let run = 1; run <= RUNS_PER_SEED; run++) {
        const result = await generateProse(writer, seed.prompt)
        if (!result) {
          seedRuns.push({ seed: seed.name, run, words: 0, passed: false, latencyMs: 0, tokensPerSec: 0, completionTokens: 0, prose: "" })
          continue
        }

        const words = result.prose.split(/\s+/).length
        seedRuns.push({ seed: seed.name, run, words, passed: true, latencyMs: result.latencyMs, tokensPerSec: result.tps, completionTokens: result.tokens, prose: result.prose })

        // Judge — all judges run concurrently
        const judgeResults = await Promise.all(
          judges.map(async (judge) => {
            const score = await judgeProse(judge, result.prose)
            return { judge: judge.label, score }
          })
        )
        for (const { judge: judgeLabel, score } of judgeResults) {
          if (score) {
            const total = score.showDontTell + score.dialogueQuality + score.voiceConsistency + score.beatAdherence + score.sensoryDetail
            seedScores.push({ judge: judgeLabel, seed: seed.name, run, ...score, total })
          }
        }
      }

      return { seed: seed.name, runs: seedRuns, scores: seedScores }
    })
  )

  // Collect results and print
  for (const { seed, runs, scores } of seedResults) {
    console.log(`=== ${seed} ===`)
    for (const run of runs) {
      if (run.passed) {
        console.log(`  Run ${run.run}: ${run.words}w ${run.tokensPerSec}tok/s ${(run.latencyMs / 1000).toFixed(1)}s`)
      } else {
        console.log(`  Run ${run.run}: FAIL`)
      }
    }
    for (const s of scores) {
      console.log(`    [run${s.run}] ${s.judge}: ${s.total}/50 (S:${s.showDontTell} D:${s.dialogueQuality} V:${s.voiceConsistency} B:${s.beatAdherence} X:${s.sensoryDetail})`)
    }
    allRuns.push(...runs)
    allScores.push(...scores)
    console.log()
  }

  // ── Compute averages per judge ────────────────────────────────────────

  const averages: Record<string, { mean: number; stddev: number }> = {}
  for (const judge of judges) {
    const totals = allScores.filter(s => s.judge === judge.label).map(s => s.total)
    averages[judge.label] = { mean: Math.round(mean(totals) * 10) / 10, stddev: Math.round(stddev(totals) * 10) / 10 }
  }

  // Overall average across all judges
  const allTotals = allScores.map(s => s.total)
  averages["ALL"] = { mean: Math.round(mean(allTotals) * 10) / 10, stddev: Math.round(stddev(allTotals) * 10) / 10 }

  // ── Per-dimension averages ────────────────────────────────────────────

  const dims = ["showDontTell", "dialogueQuality", "voiceConsistency", "beatAdherence", "sensoryDetail"] as const
  const dimLabels = ["Show/Tell", "Dialogue", "Voice", "Beats", "Sensory"]
  const dimAvgs: Record<string, number> = {}
  for (const dim of dims) {
    dimAvgs[dim] = Math.round(mean(allScores.map(s => s[dim])) * 10) / 10
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("=".repeat(60))
  console.log("  BENCHMARK RESULTS")
  console.log("=".repeat(60))

  const failedGenerations = allRuns.filter(r => !r.passed).length
  const expectedJudgeCalls = allRuns.filter(r => r.passed).length * judges.length
  const failedJudgeCalls = expectedJudgeCalls - allScores.length

  // Cost estimate — writer tokens from runs, judge tokens estimated at ~1K output each
  const writerTokens = allRuns.reduce((s, r) => ({ p: s.p + (r.completionTokens > 0 ? r.completionTokens * 0.7 : 0), c: s.c + r.completionTokens }), { p: 0, c: 0 })
  const writerCost = getTokenCost(
    writer.label.toLowerCase().includes("cerebras") ? "cerebras" : "groq",
    writer.model,
    Math.round(writerTokens.p),
    Math.round(writerTokens.c),
  )
  // Judge cost is harder to estimate without tracking — approximate
  const totalBenchmarkCost = writerCost  // judges are cheap relative to generation

  console.log(`\n  Writer: ${writer.label}`)
  console.log(`  Seeds: ${seeds.length} × ${RUNS_PER_SEED} runs = ${seeds.length * RUNS_PER_SEED} generations`)
  console.log(`  Judge calls: ${allScores.length}/${expectedJudgeCalls} succeeded`)
  console.log(`  Est. writer cost: $${writerCost.toFixed(4)}`)
  if (failedGenerations > 0) console.log(`  ⚠ ${failedGenerations} generation(s) failed`)
  if (failedJudgeCalls > 0) console.log(`  ⚠ ${failedJudgeCalls} judge call(s) failed`)

  console.log(`\n  Per-judge averages:`)
  for (const judge of judges) {
    const a = averages[judge.label]
    if (a) console.log(`    ${judge.label.padEnd(20)} ${a.mean}/50 (±${a.stddev})`)
  }
  console.log(`    ${"OVERALL".padEnd(20)} ${averages["ALL"].mean}/50 (±${averages["ALL"].stddev})`)

  console.log(`\n  Per-dimension averages (all judges):`)
  for (let i = 0; i < dims.length; i++) {
    console.log(`    ${dimLabels[i].padEnd(12)} ${dimAvgs[dims[i]]}/10`)
  }

  // Commit-ready summary line — results first, infrastructure second
  const summary = `benchmark: ${averages["ALL"].mean}/50 (±${averages["ALL"].stddev}) S:${dimAvgs.showDontTell} D:${dimAvgs.dialogueQuality} V:${dimAvgs.voiceConsistency} B:${dimAvgs.beatAdherence} X:${dimAvgs.sensoryDetail}`
  const details = `${seeds.length} seeds × ${RUNS_PER_SEED} runs | ${allScores.length} judge calls`
  console.log(`\n  Commit line:\n  ${summary}\n  ${details}`)

  // ── Compare to baseline ───────────────────────────────────────────────

  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as BenchmarkResult
    const baseAvg = baseline.averages["ALL"]
    const delta = Math.round((averages["ALL"].mean - baseAvg.mean) * 10) / 10
    const arrow = delta > 0 ? "+" : ""
    console.log(`\n  delta: ${arrow}${delta} vs baseline (${baseAvg.mean} → ${averages["ALL"].mean})`)

    // Per-dimension deltas
    for (let i = 0; i < dims.length; i++) {
      const baseDim = mean(baseline.scores.map(s => (s as any)[dims[i]]))
      const d = Math.round((dimAvgs[dims[i]] - baseDim) * 10) / 10
      if (Math.abs(d) >= 0.3) {
        const a = d > 0 ? "+" : ""
        console.log(`    ${dimLabels[i]}: ${a}${d}`)
      }
    }
  }

  // ── Save results ──────────────────────────────────────────────────────

  const benchmarkResult: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    writer: writer.label,
    seeds: seeds.map(s => s.name),
    runsPerSeed: RUNS_PER_SEED,
    judges: judges.map(j => j.label),
    scores: allScores,
    averages,
    summary,
  }

  const filename = `${RESULTS_DIR}/benchmark-${Date.now()}.json`
  await Bun.write(filename, JSON.stringify(benchmarkResult, null, 2))
  console.log(`\n  Saved: ${filename}`)

  // Save as baseline if --save-baseline flag
  if (process.argv.includes("--save-baseline")) {
    await Bun.write(BASELINE_PATH, JSON.stringify(benchmarkResult, null, 2))
    console.log(`  Saved as baseline: ${BASELINE_PATH}`)
  }

  // Diagnostic pass — skip with --skip-diagnostic
  if (!process.argv.includes("--skip-diagnostic") && allScores.length > 0) {
    await runDiagnostic(dimAvgs, allScores, allRuns)
  }
}

main()
