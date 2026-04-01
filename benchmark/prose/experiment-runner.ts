/**
 * Experiment runner: systematically test writer agent variants.
 *
 * Accepts an ExperimentBatch config, generates prose for each variant,
 * judges with penalty rubrics, persists everything to tuning DB.
 *
 * Usage: import { runBatch } from "./experiment-runner" in batch files.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { chapterDraftSchema } from "../../src/types"
import { getWriter, getJudges, type JudgeConfig } from "../config"
import { penaltySchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { getDB, createTuningExperiment, saveTuningResult } from "../db"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import type { ExperimentBatch, Variant, VariantScore } from "./experiments/types"

// ── Seed loading ─────────────────────────────────────────────────────────

const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

function loadSeeds(): Array<{ name: string; prompt: string }> {
  return readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .sort()
    .map(name => {
      const seed = JSON.parse(readFileSync(`${SEEDS_DIR}/${name}.json`, "utf-8"))
      return {
        name,
        prompt: `CHAPTER 1: "Opening"
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
Premise: ${seed.premise}`,
      }
    })
}

// ── Judge rubrics ────────────────────────────────────────────────────────

const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── LLM call helper ──────────────────────────────────────────────────────

interface ModelConfig {
  apiUrl: string; apiKey: string; model: string
  extraBody?: Record<string, any>; needsNothink?: boolean
}

function resolveWriter(variant: Variant): ModelConfig {
  if (variant.model) {
    const m = MODELS.find(m => m.id === variant.model!.id && m.provider === variant.model!.provider)
    if (!m) throw new Error(`Model ${variant.model.id} (${variant.model.provider}) not found`)
    const p = PROVIDERS[m.provider]
    return { apiUrl: p.apiUrl, apiKey: getApiKey(m.provider), model: m.id, extraBody: p.extraBody?.(), needsNothink: m.needsNothink }
  }
  const w = getWriter()
  return { apiUrl: w.apiUrl, apiKey: w.apiKey, model: w.model, extraBody: w.extraBody, needsNothink: w.needsNothink }
}

async function llmCall(
  config: ModelConfig, systemPrompt: string, userPrompt: string, temperature: number,
): Promise<{ content: string; tokens: number; latencyMs: number } | null> {
  const userMsg = config.needsNothink ? `/nothink\n${userPrompt}` : userPrompt
  const start = performance.now()
  try {
    const res = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        temperature,
        max_tokens: 16384,
        response_format: { type: "json_object" },
        ...config.extraBody,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    if (data.error) return null
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    return { content, tokens: data.usage?.completion_tokens ?? 0, latencyMs: Math.round(performance.now() - start) }
  } catch { return null }
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judgeProse(
  judge: JudgeConfig, dim: Dimension, prose: string,
): Promise<{ count: number; issues: Array<{ quote: string; problem: string }> } | null> {
  try {
    const tokenParam = judge.useMaxCompletionTokens ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [
            { role: "system", content: `Here is a prose passage:\n\n${prose}\n\n---\n\n${JUDGE_RUBRICS[dim]}` },
            { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
          ],
          temperature: 0.1, ...tokenParam,
          response_format: { type: "json_object" }, ...judge.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }
    if (!res!.ok) return null
    const data = await res!.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = penaltySchema.safeParse(JSON.parse(extractJSON(content)))
    if (!parsed.success) return null
    return { count: parsed.data.issues.length, issues: parsed.data.issues }
  } catch { return null }
}

// ── Stats helpers ────────────────────────────────────────────────────────

function mean(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

// ── Main runner ──────────────────────────────────────────────────────────

export async function runBatch(batch: ExperimentBatch) {
  getDB()

  const judge = getJudges()[0]
  const allSeeds = loadSeeds()
  const seeds = batch.seedFilter?.length
    ? allSeeds.filter(s => batch.seedFilter!.includes(s.name))
    : allSeeds
  const runsPerSeed = batch.runsPerSeed ?? 2

  const expId = createTuningExperiment("experiment", batch.description, {
    name: batch.name,
    variants: batch.variants.map(v => ({ label: v.label, temperature: v.temperature ?? 0.8, model: v.model })),
    judge: judge.label,
    seeds: seeds.map(s => s.name),
    runsPerSeed,
    dimensions: [...DIMENSIONS],
  })

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  ${batch.name} (Experiment #${expId})`)
  console.log(`${"=".repeat(70)}`)
  console.log(`  Variants: ${batch.variants.map(v => v.label).join(", ")}`)
  console.log(`  Judge: ${judge.label}`)
  console.log(`  Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`  Runs per seed: ${runsPerSeed}`)
  console.log(`  Total calls: ${batch.variants.length} variants x ${seeds.length} seeds x ${runsPerSeed} runs = ${batch.variants.length * seeds.length * runsPerSeed} writer + ${batch.variants.length * seeds.length * runsPerSeed * DIMENSIONS.length} judge`)
  console.log()

  const allScores: VariantScore[] = []

  for (const seed of seeds) {
    for (let run = 1; run <= runsPerSeed; run++) {
      for (const variant of batch.variants) {
        const writerConfig = resolveWriter(variant)
        const prompt = variant.contextModifier ? variant.contextModifier(seed.prompt) : seed.prompt
        const temperature = variant.temperature ?? 0.8

        console.log(`  [${variant.label}] ${seed.name} run ${run}`)

        const result = await llmCall(writerConfig, variant.systemPrompt, prompt, temperature)
        if (!result) {
          console.log(`    FAIL (call)`)
          saveTuningResult(expId, { model: variant.label, rubric: "generation", sample: seed.name, run, failed: true })
          continue
        }

        let prose: string
        try {
          const jsonStr = extractJSON(result.content)
          const parsed = JSON.parse(jsonStr)
          const zodResult = chapterDraftSchema.safeParse(parsed)
          if (!zodResult.success) { console.log(`    FAIL (zod)`); continue }
          prose = parsed.prose
        } catch {
          console.log(`    FAIL (parse)`)
          continue
        }

        const words = prose.split(/\s+/).length
        const tps = result.tokens > 0 ? Math.round(result.tokens / (result.latencyMs / 1000)) : 0
        console.log(`    ${words}w ${tps}tok/s`)

        // Judge all dimensions concurrently
        const judgeJobs = DIMENSIONS.map(async (dim) => {
          const penalty = await judgeProse(judge, dim, prose)
          if (penalty) {
            allScores.push({ variant: variant.label, seed: seed.name, run, dim, count: penalty.count })
            saveTuningResult(expId, {
              model: variant.label, rubric: dim, sample: seed.name, run,
              score: penalty.count, issues: penalty.issues,
            })
            console.log(`    ${DIMENSION_LABELS[dim]}: ${penalty.count}`)
          } else {
            saveTuningResult(expId, { model: variant.label, rubric: dim, sample: seed.name, run, failed: true })
          }
        })
        await Promise.all(judgeJobs)

        // Brief pause between variants to avoid rate limits
        await Bun.sleep(300)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  RESULTS — ${batch.name} (lower = better)`)
  console.log(`${"=".repeat(70)}`)

  // Table 1: Variant × Dimension
  const colW = 14
  console.log(`\n  ${"Variant".padEnd(28)} ${DIMENSIONS.map(d => DIMENSION_LABELS[d].padEnd(colW)).join("")}${"OVERALL".padEnd(colW)}`)
  console.log(`  ${"-".repeat(28 + (DIMENSIONS.length + 1) * colW)}`)

  const variantOveralls: Array<{ label: string; overall: number; telling: number }> = []

  for (const variant of batch.variants) {
    const cols: string[] = []
    let tellingAvg = 0
    for (const dim of DIMENSIONS) {
      const counts = allScores.filter(s => s.variant === variant.label && s.dim === dim).map(s => s.count)
      const avg = mean(counts)
      const std = stddev(counts)
      if (dim === "telling") tellingAvg = avg
      cols.push(`${avg.toFixed(1)} ±${std.toFixed(1)}`.padEnd(colW))
    }
    const allCounts = allScores.filter(s => s.variant === variant.label).map(s => s.count)
    const overall = mean(allCounts)
    cols.push(`${overall.toFixed(1)}`.padEnd(colW))
    variantOveralls.push({ label: variant.label, overall, telling: tellingAvg })

    console.log(`  ${variant.label.padEnd(28)} ${cols.join("")}`)
  }

  // Table 2: Ranking
  console.log(`\n  Ranked by Telling (primary target):`)
  const ranked = [...variantOveralls].sort((a, b) => a.telling - b.telling)
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    const marker = i === 0 ? ">>>" : "   "
    console.log(`  ${marker} ${r.label.padEnd(28)} Telling: ${r.telling.toFixed(1)}  Overall: ${r.overall.toFixed(1)}`)
  }

  // Table 3: Per-seed for best variant
  const best = ranked[0]
  console.log(`\n  Per-seed breakdown for best variant (${best.label}):`)
  for (const seed of seeds) {
    const seedScores = allScores.filter(s => s.variant === best.label && s.seed === seed.name)
    const dimStr = DIMENSIONS.map(dim => {
      const counts = seedScores.filter(s => s.dim === dim).map(s => s.count)
      return `${DIMENSION_LABELS[dim]}:${mean(counts).toFixed(1)}`
    }).join("  ")
    console.log(`    ${seed.name.padEnd(24)} ${dimStr}`)
  }

  console.log(`\n  Experiment #${expId} saved to tuning DB`)
  console.log()

  return { expId, allScores, ranked }
}
