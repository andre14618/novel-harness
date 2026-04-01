/**
 * Model sophistication test: does a smarter model improve prose quality?
 *
 * A: Qwen3 32B single-pass (current baseline)
 * B: Qwen3 32B draft → Qwen3 235B polish
 * C: Qwen3 235B single-pass
 *
 * Usage: bun benchmark/prose/model-ab-test.ts
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { getJudges, type JudgeConfig } from "../config"
import { penaltySchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { getDB, createTuningExperiment, saveTuningResult } from "../db"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"

// ── Config ───────────────────────────────────────────────────────────────

const RUNS_PER_SEED = 2
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

// ── Prompts ──────────────────────────────────────────────────────────────

const WRITER_FULL = readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")
const WRITER_STRUCTURE = readFileSync(new URL("../../src/agents/writer/prompt-structure.md", import.meta.url).pathname, "utf-8")
const PROSE_POLISH = readFileSync(new URL("../../src/agents/prose-polish/prompt.md", import.meta.url).pathname, "utf-8")

// ── Judge rubrics ────────────────────────────────────────────────────────

const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  JUDGE_RUBRICS[dim] = readFileSync(new URL(`./judges/${dim}.md`, import.meta.url).pathname, "utf-8")
}

// ── Models ───────────────────────────────────────────────────────────────

function resolveModel(label: string) {
  const m = MODELS.find(m => m.label === label && !!process.env[PROVIDERS[m.provider].envKey])
  if (!m) throw new Error(`Model "${label}" not available`)
  const p = PROVIDERS[m.provider]
  return { label: m.label, id: m.id, apiUrl: p.apiUrl, apiKey: getApiKey(m.provider), extraBody: p.extraBody?.(), needsNothink: m.needsNothink }
}

const qwen32b = resolveModel("Qwen3 32B")
const qwen235b = resolveModel("Qwen3 235B")

// ── Seeds ────────────────────────────────────────────────────────────────

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

// ── LLM call ─────────────────────────────────────────────────────────────

async function call(
  model: typeof qwen32b, systemPrompt: string, userPrompt: string,
  opts?: { temperature?: number; jsonMode?: boolean },
): Promise<{ content: string; tokens: number; latencyMs: number } | null> {
  const userMsg = model.needsNothink ? `/nothink\n${userPrompt}` : userPrompt
  const start = performance.now()
  try {
    const res = await fetch(model.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        temperature: opts?.temperature ?? 0.8,
        max_tokens: 16384,
        ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...model.extraBody,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    if (data.error) return null
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const tokens = data.usage?.completion_tokens ?? 0
    return { content, tokens, latencyMs: Math.round(performance.now() - start) }
  } catch { return null }
}

function extractProse(raw: string): string | null {
  try { return JSON.parse(extractJSON(raw)).prose } catch { return null }
}

// ── Judge ─────────────────────────────────────────────────────────────────

async function judgeProse(judge: JudgeConfig, dim: Dimension, prose: string) {
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
      if (res!.status === 429 || res!.status === 503) { if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue } }
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

// ── Main ─────────────────────────────────────────────────────────────────

interface Variant {
  label: string
  generate: (seedPrompt: string) => Promise<string | null>
}

async function main() {
  getDB()
  const judge = getJudges()[0]
  const seeds = loadSeeds()

  const variants: Variant[] = [
    {
      label: "A: 32B single",
      generate: async (prompt) => {
        const r = await call(qwen32b, WRITER_FULL, prompt, { jsonMode: true })
        if (!r) return null
        const prose = extractProse(r.content)
        if (prose) {
          const w = prose.split(/\s+/).length
          const tps = r.tokens > 0 ? Math.round(r.tokens / (r.latencyMs / 1000)) : 0
          console.log(`    draft: ${w}w ${tps}tok/s`)
        }
        return prose
      },
    },
    {
      label: "B: 32B→235B polish",
      generate: async (prompt) => {
        const draft = await call(qwen32b, WRITER_STRUCTURE, prompt, { jsonMode: true })
        if (!draft) return null
        const draftProse = extractProse(draft.content)
        if (!draftProse) return null
        const w1 = draftProse.split(/\s+/).length
        const tps1 = draft.tokens > 0 ? Math.round(draft.tokens / (draft.latencyMs / 1000)) : 0
        console.log(`    draft: ${w1}w ${tps1}tok/s (32B)`)

        const polish = await call(qwen235b, PROSE_POLISH, draftProse, { temperature: 0.4, jsonMode: true })
        if (!polish) { console.log(`    polish: FAIL — using raw draft`); return draftProse }
        const polished = extractProse(polish.content)
        if (!polished) { console.log(`    polish: FAIL (parse) — using raw draft`); return draftProse }
        const w2 = polished.split(/\s+/).length
        const tps2 = polish.tokens > 0 ? Math.round(polish.tokens / (polish.latencyMs / 1000)) : 0
        console.log(`    polish: ${w2}w ${tps2}tok/s (235B)`)
        return polished
      },
    },
    {
      label: "C: 235B single",
      generate: async (prompt) => {
        const r = await call(qwen235b, WRITER_FULL, prompt, { jsonMode: true })
        if (!r) return null
        const prose = extractProse(r.content)
        if (prose) {
          const w = prose.split(/\s+/).length
          const tps = r.tokens > 0 ? Math.round(r.tokens / (r.latencyMs / 1000)) : 0
          console.log(`    draft: ${w}w ${tps}tok/s`)
        }
        return prose
      },
    },
  ]

  const expId = createTuningExperiment("model-ab", "32B single vs 32B→235B polish vs 235B single", {
    variants: variants.map(v => v.label),
    judge: judge.label, seeds: seeds.map(s => s.name), runs: RUNS_PER_SEED,
  })

  console.log(`\nModel A/B Test (Experiment #${expId})`)
  console.log(`Variants: ${variants.map(v => v.label).join(" | ")}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.length} x ${RUNS_PER_SEED} runs\n`)

  type Score = { variant: string; seed: string; run: number; dim: Dimension; count: number }
  const allScores: Score[] = []

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS_PER_SEED; run++) {
      for (const variant of variants) {
        console.log(`  [${variant.label}] ${seed.name} run ${run}`)
        const prose = await variant.generate(seed.prompt)
        if (!prose) { console.log(`    FAIL`); continue }

        const jobs = DIMENSIONS.map(async (dim) => {
          const result = await judgeProse(judge, dim, prose)
          if (result) {
            allScores.push({ variant: variant.label, seed: seed.name, run, dim, count: result.count })
            saveTuningResult(expId, {
              model: variant.label, rubric: dim, sample: seed.name, run,
              score: result.count, issues: result.issues,
            })
            console.log(`      ${DIMENSION_LABELS[dim]}: ${result.count}`)
          }
        })
        await Promise.all(jobs)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  MODEL A/B RESULTS (lower = better)`)
  console.log(`${"=".repeat(70)}`)

  for (const v of variants) {
    console.log(`\n  ${v.label}:`)
    for (const dim of DIMENSIONS) {
      const counts = allScores.filter(s => s.variant === v.label && s.dim === dim).map(s => s.count)
      console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${mean(counts).toFixed(1)} issues  [${counts.join(",")}]`)
    }
    const all = allScores.filter(s => s.variant === v.label).map(s => s.count)
    console.log(`    ${"OVERALL".padEnd(14)} ${mean(all).toFixed(1)} issues/dim`)
  }

  console.log(`\n  ${"Variant".padEnd(24)} ${"Telling".padEnd(12)} ${"Dead Wt".padEnd(12)} ${"Dialogue".padEnd(12)} Overall`)
  console.log(`  ${"-".repeat(64)}`)
  for (const v of variants) {
    const t = mean(allScores.filter(s => s.variant === v.label && s.dim === "telling").map(s => s.count))
    const w = mean(allScores.filter(s => s.variant === v.label && s.dim === "dead-weight").map(s => s.count))
    const d = mean(allScores.filter(s => s.variant === v.label && s.dim === "dialogue-problems").map(s => s.count))
    const all = mean(allScores.filter(s => s.variant === v.label).map(s => s.count))
    console.log(`  ${v.label.padEnd(24)} ${t.toFixed(1).padEnd(12)} ${w.toFixed(1).padEnd(12)} ${d.toFixed(1).padEnd(12)} ${all.toFixed(1)}`)
  }

  console.log(`\n  Experiment #${expId} saved to tuning DB\n`)
}

main()
