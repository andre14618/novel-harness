/**
 * Test whether GPT-OSS 120B can discriminate quality using the original
 * 1-10 rubrics. Also compare K2 vs Qwen3 32B prose.
 *
 * Uses fresh generations from both models on 3 seeds, judged by 120B
 * on both the old 1-10 rubrics AND the penalty rubrics.
 *
 * Persists to tuning DB.
 */

import { readFileSync, readdirSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { getDB, createTuningExperiment, saveTuningResult } from "./db"
import { z } from "zod"

const judgeScoreSchema = z.object({
  score: z.coerce.number().min(1).max(10),
  reasoning: z.string().min(1),
})

const penaltySchema = z.object({
  issues: z.array(z.object({ quote: z.string(), problem: z.string() })),
  count: z.coerce.number().min(0),
})

// ── Models ───────────────────────────────────────────────────────────────

function resolve(id: string, provider: string) {
  const m = MODELS.find(m => m.id === id && m.provider === provider)!
  const p = PROVIDERS[m.provider]
  return { label: m.label, id: m.id, apiUrl: p.apiUrl, apiKey: getApiKey(m.provider), extraBody: p.extraBody?.(), needsNothink: m.needsNothink }
}

const qwen = resolve("qwen/qwen3-32b", "groq")
const kimi = resolve("moonshotai/kimi-k2-instruct-0905", "groq")
const judge = resolve("openai/gpt-oss-120b", "groq")

// ── Rubrics ──────────────────────────────────────────────────────────────

const QUALITY_DIMS = ["show-tell", "dialogue", "sensory"] as const
const QUALITY_LABELS: Record<string, string> = { "show-tell": "Show/Tell", "dialogue": "Dialogue", "sensory": "Sensory" }
const PENALTY_DIMS = ["telling", "dead-weight", "dialogue-problems"] as const
const PENALTY_LABELS: Record<string, string> = { "telling": "Telling", "dead-weight": "Dead Weight", "dialogue-problems": "Dialogue Probs" }

const qualityRubrics: Record<string, string> = {}
for (const dim of QUALITY_DIMS) {
  qualityRubrics[dim] = readFileSync(new URL(`./prose/judges/${dim}.md`, import.meta.url).pathname, "utf-8")
}

const penaltyRubrics: Record<string, string> = {}
for (const dim of PENALTY_DIMS) {
  penaltyRubrics[dim] = readFileSync(new URL(`./prose/judges/${dim}.md`, import.meta.url).pathname, "utf-8")
}

// ── Seeds ────────────────────────────────────────────────────────────────

const SEEDS_DIR = new URL("../src/seeds", import.meta.url).pathname
const SEED_NAMES = ["dark-fantasy", "romance-drama", "sci-fi-thriller"]

function loadSeed(name: string) {
  const seed = JSON.parse(readFileSync(`${SEEDS_DIR}/${name}.json`, "utf-8"))
  return `CHAPTER 1: "Opening"
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
}

// ── Writer prompt ────────────────────────────────────────────────────────

const WRITER_PROMPT = readFileSync(new URL("../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")

// ── LLM helpers ──────────────────────────────────────────────────────────

async function generate(model: typeof qwen, prompt: string): Promise<string | null> {
  const userMsg = model.needsNothink ? `/nothink\n${prompt}` : prompt
  try {
    const res = await fetch(model.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "system", content: WRITER_PROMPT }, { role: "user", content: userMsg }],
        temperature: 0.8, max_tokens: 16384,
        response_format: { type: "json_object" }, ...model.extraBody,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    return JSON.parse(extractJSON(content)).prose
  } catch { return null }
}

async function judgeQuality(dim: string, prose: string): Promise<{ score: number; reasoning: string } | null> {
  try {
    const res = await fetch(judge.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judge.id,
        messages: [
          { role: "system", content: `Here is a prose passage:\n\n${prose}\n\n---\n\n${qualityRubrics[dim]}` },
          { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
        ],
        temperature: 0.1, max_tokens: 4096,
        response_format: { type: "json_object" }, ...judge.extraBody,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = judgeScoreSchema.safeParse(JSON.parse(extractJSON(content)))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

async function judgePenalty(dim: string, prose: string): Promise<{ count: number } | null> {
  try {
    const res = await fetch(judge.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judge.id,
        messages: [
          { role: "system", content: `Here is a prose passage:\n\n${prose}\n\n---\n\n${penaltyRubrics[dim]}` },
          { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
        ],
        temperature: 0.1, max_tokens: 4096,
        response_format: { type: "json_object" }, ...judge.extraBody,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = penaltySchema.safeParse(JSON.parse(extractJSON(content)))
    return parsed.success ? { count: parsed.data.issues.length } : null
  } catch { return null }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()

  const expId = createTuningExperiment("quality-vs-penalty", "Compare 1-10 quality scores vs penalty counts for K2 and Qwen3 32B with GPT-OSS 120B judge", {
    writers: ["Qwen3 32B", "Kimi K2"],
    judge: "GPT-OSS 120B",
    qualityDims: [...QUALITY_DIMS],
    penaltyDims: [...PENALTY_DIMS],
    seeds: SEED_NAMES,
    runs: 2,
  })

  console.log(`\nQuality vs Penalty Judge Comparison (Experiment #${expId})`)
  console.log(`Writers: Qwen3 32B, Kimi K2`)
  console.log(`Judge: GPT-OSS 120B`)
  console.log(`Seeds: ${SEED_NAMES.join(", ")}`)
  console.log(`Rubrics: 1-10 (${QUALITY_DIMS.join(", ")}) + penalty (${PENALTY_DIMS.join(", ")})\n`)

  type Score = { writer: string; seed: string; run: number; dim: string; type: "quality" | "penalty"; value: number }
  const scores: Score[] = []

  for (const seedName of SEED_NAMES) {
    const prompt = loadSeed(seedName)
    for (let run = 1; run <= 2; run++) {
      for (const [writerModel, writerLabel] of [[qwen, "Qwen3 32B"], [kimi, "Kimi K2"]] as const) {
        console.log(`  [${writerLabel}] ${seedName} run ${run}`)
        const prose = await generate(writerModel, prompt)
        if (!prose) { console.log(`    FAIL`); continue }
        const words = prose.split(/\s+/).length
        console.log(`    ${words}w`)

        // Judge quality (1-10) and penalty concurrently
        const jobs = [
          ...QUALITY_DIMS.map(async dim => {
            const r = await judgeQuality(dim, prose)
            if (r) {
              scores.push({ writer: writerLabel, seed: seedName, run, dim, type: "quality", value: r.score })
              saveTuningResult(expId, { model: writerLabel, rubric: `quality:${dim}`, sample: seedName, run, score: r.score, reasoning: r.reasoning })
              console.log(`    ${QUALITY_LABELS[dim]}: ${r.score}/10`)
            }
          }),
          ...PENALTY_DIMS.map(async dim => {
            const r = await judgePenalty(dim, prose)
            if (r) {
              scores.push({ writer: writerLabel, seed: seedName, run, dim, type: "penalty", value: r.count })
              saveTuningResult(expId, { model: writerLabel, rubric: `penalty:${dim}`, sample: seedName, run, score: r.count })
              console.log(`    ${PENALTY_LABELS[dim]}: ${r.count} issues`)
            }
          }),
        ]
        await Promise.all(jobs)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  QUALITY SCORES (1-10, higher = better)`)
  console.log(`${"=".repeat(70)}`)
  console.log(`\n  ${"Writer".padEnd(16)} ${QUALITY_DIMS.map(d => QUALITY_LABELS[d].padEnd(14)).join("")}${"AVG".padEnd(8)}`)
  console.log(`  ${"-".repeat(60)}`)
  for (const writer of ["Qwen3 32B", "Kimi K2"]) {
    const cols = QUALITY_DIMS.map(dim => {
      const vals = scores.filter(s => s.writer === writer && s.dim === dim && s.type === "quality").map(s => s.value)
      return mean(vals).toFixed(1).padEnd(14)
    })
    const all = scores.filter(s => s.writer === writer && s.type === "quality").map(s => s.value)
    console.log(`  ${writer.padEnd(16)} ${cols.join("")}${mean(all).toFixed(1)}`)
  }

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  PENALTY COUNTS (lower = better)`)
  console.log(`${"=".repeat(70)}`)
  console.log(`\n  ${"Writer".padEnd(16)} ${PENALTY_DIMS.map(d => PENALTY_LABELS[d].padEnd(14)).join("")}${"AVG".padEnd(8)}`)
  console.log(`  ${"-".repeat(60)}`)
  for (const writer of ["Qwen3 32B", "Kimi K2"]) {
    const cols = PENALTY_DIMS.map(dim => {
      const vals = scores.filter(s => s.writer === writer && s.dim === dim && s.type === "penalty").map(s => s.value)
      return mean(vals).toFixed(1).padEnd(14)
    })
    const all = scores.filter(s => s.writer === writer && s.type === "penalty").map(s => s.value)
    console.log(`  ${writer.padEnd(16)} ${cols.join("")}${mean(all).toFixed(1)}`)
  }

  console.log(`\n  Experiment #${expId} saved to tuning DB\n`)
}

main()
