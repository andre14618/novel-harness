/**
 * A/B test: single-pass writer vs two-pass (writer + prose-polish).
 *
 * A: writer (full craft rules) → judge
 * B: writer (structure-only) → prose-polish → judge
 *
 * Same seeds, same judge, same rubrics. Persists to tuning DB.
 *
 * Usage: bun benchmark/prose/ab-test.ts
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { penaltySchema, DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createTuningExperiment, saveTuningResult,
} from "../db"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { AGENT_MODELS } from "../../models/roles"

// ── Config ───────────────────────────────────────────────────────────────

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "2")
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

// ── Load prompts ─────────────────────────────────────────────────────────

const WRITER_FULL = readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")
const WRITER_STRUCTURE = readFileSync(new URL("../../src/agents/writer/prompt-structure.md", import.meta.url).pathname, "utf-8")
const PROSE_POLISH = readFileSync(new URL("../../src/agents/prose-polish/prompt.md", import.meta.url).pathname, "utf-8")

// ── Load judge rubrics ───────────────────────────────────────────────────

const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Seed loading ─────────────────────────────────────────────────────────

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

// ── LLM call helper ──────────────────────────────────────────────────────

async function llmCall(
  apiUrl: string, apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; extraBody?: Record<string, any>; needsNothink?: boolean },
): Promise<{ content: string; promptTokens: number; completionTokens: number; latencyMs: number } | null> {
  const userMsg = opts.needsNothink ? `/nothink\n${userPrompt}` : userPrompt
  const start = performance.now()

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 16384,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...opts.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) return null

    const data = await res.json() as any
    if (data.error) return null

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const usage = data.usage ?? {}
    return {
      content,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      latencyMs: Math.round(elapsed),
    }
  } catch {
    return null
  }
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judgeProse(
  judge: JudgeConfig, dimension: Dimension, prose: string,
): Promise<{ count: number; issues: Array<{ quote: string; problem: string }> } | null> {
  const rubric = JUDGE_RUBRICS[dimension]

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

    if (!res!.ok) return null
    const data = await res!.json() as any
    if (data.error) return null

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = penaltySchema.safeParse(parsed)
    if (!result.success) return null

    return { count: result.data.issues.length, issues: result.data.issues }
  } catch {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()

  const writer = getWriter()
  const judges = getJudges()
  const seeds = loadSeeds()

  if (judges.length === 0) { console.error("No judge available"); process.exit(1) }
  const judge = judges[0]

  // Resolve prose-polish model
  const polishAssignment = AGENT_MODELS["prose-polish"]
  const polishModel = MODELS.find(m => m.id === polishAssignment.model && m.provider === polishAssignment.provider)!
  const polishProvider = PROVIDERS[polishModel.provider]

  const expId = createTuningExperiment("ab-test", "Single-pass vs two-pass (writer + prose-polish)", {
    writer: writer.label,
    judge: judge.label,
    polishModel: polishModel.label,
    seeds: seeds.map(s => s.name),
    runsPerSeed: RUNS_PER_SEED,
    dimensions: [...DIMENSIONS],
  })

  console.log(`\nA/B Test: Single-pass vs Two-pass (Experiment #${expId})`)
  console.log(`Writer: ${writer.label}`)
  console.log(`Polish: ${polishModel.label}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS_PER_SEED}`)
  console.log()

  type Score = { variant: string; seed: string; run: number; dim: Dimension; count: number }
  const allScores: Score[] = []

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS_PER_SEED; run++) {

      // ── Variant A: single-pass (full craft rules) ──────────────────

      console.log(`[A:single] ${seed.name} run ${run}...`)
      const aResult = await llmCall(
        writer.apiUrl, writer.apiKey, writer.model,
        WRITER_FULL, seed.prompt,
        { temperature: 0.8, maxTokens: 16384, jsonMode: true, extraBody: writer.extraBody, needsNothink: writer.needsNothink },
      )

      let aProse: string | null = null
      if (aResult) {
        try {
          const parsed = JSON.parse(extractJSON(aResult.content))
          aProse = parsed.prose
          const words = aProse!.split(/\s+/).length
          const tps = aResult.completionTokens > 0 ? Math.round(aResult.completionTokens / (aResult.latencyMs / 1000)) : 0
          console.log(`  A: ${words}w ${tps}tok/s`)
        } catch { console.log(`  A: FAIL (parse)`) }
      } else {
        console.log(`  A: FAIL (call)`)
      }

      // ── Variant B: two-pass (structure → polish) ───────────────────

      console.log(`[B:2-pass] ${seed.name} run ${run}...`)
      const bDraft = await llmCall(
        writer.apiUrl, writer.apiKey, writer.model,
        WRITER_STRUCTURE, seed.prompt,
        { temperature: 0.8, maxTokens: 16384, jsonMode: true, extraBody: writer.extraBody, needsNothink: writer.needsNothink },
      )

      let bProse: string | null = null
      if (bDraft) {
        try {
          const draftParsed = JSON.parse(extractJSON(bDraft.content))
          const draftProse = draftParsed.prose as string
          const draftWords = draftProse.split(/\s+/).length
          const draftTps = bDraft.completionTokens > 0 ? Math.round(bDraft.completionTokens / (bDraft.latencyMs / 1000)) : 0
          console.log(`  B draft: ${draftWords}w ${draftTps}tok/s`)

          // Polish pass
          const polishResult = await llmCall(
            polishProvider.apiUrl, getApiKey(polishModel.provider), polishModel.id,
            PROSE_POLISH, draftProse,
            { temperature: 0.4, maxTokens: 16384, jsonMode: true, extraBody: polishProvider.extraBody?.(), needsNothink: polishModel.needsNothink },
          )

          if (polishResult) {
            const polishParsed = JSON.parse(extractJSON(polishResult.content))
            bProse = polishParsed.prose
            const polishWords = bProse!.split(/\s+/).length
            const polishTps = polishResult.completionTokens > 0 ? Math.round(polishResult.completionTokens / (polishResult.latencyMs / 1000)) : 0
            console.log(`  B polish: ${polishWords}w ${polishTps}tok/s`)
          } else {
            console.log(`  B polish: FAIL — using raw draft`)
            bProse = draftProse
          }
        } catch { console.log(`  B: FAIL (parse)`) }
      } else {
        console.log(`  B: FAIL (call)`)
      }

      // ── Judge both variants ────────────────────────────────────────

      for (const [variant, prose] of [["A:single", aProse], ["B:2-pass", bProse]] as const) {
        if (!prose) continue

        const judgeJobs = DIMENSIONS.map(async (dim) => {
          const penalty = await judgeProse(judge, dim, prose)
          if (penalty) {
            allScores.push({ variant, seed: seed.name, run, dim, count: penalty.count })
            saveTuningResult(expId, {
              model: variant,
              rubric: dim,
              sample: seed.name,
              run,
              score: penalty.count,
              issues: penalty.issues,
            })
            console.log(`    ${variant} ${DIMENSION_LABELS[dim]}: ${penalty.count} issues`)
          }
        })
        await Promise.all(judgeJobs)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  A/B TEST RESULTS (lower = better)`)
  console.log(`${"=".repeat(70)}`)

  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  for (const variant of ["A:single", "B:2-pass"]) {
    console.log(`\n  ${variant}:`)
    for (const dim of DIMENSIONS) {
      const counts = allScores.filter(s => s.variant === variant && s.dim === dim).map(s => s.count)
      console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${mean(counts).toFixed(1)} issues  [${counts.join(",")}]`)
    }
    const all = allScores.filter(s => s.variant === variant).map(s => s.count)
    console.log(`    ${"OVERALL".padEnd(14)} ${mean(all).toFixed(1)} issues/dim`)
  }

  // Per-seed comparison
  console.log(`\n  Per-seed:`)
  console.log(`  ${"Seed".padEnd(24)} ${"A:single".padEnd(14)} ${"B:2-pass".padEnd(14)} Delta`)
  console.log(`  ${"-".repeat(60)}`)
  for (const seed of seeds) {
    const aAvg = mean(allScores.filter(s => s.variant === "A:single" && s.seed === seed.name).map(s => s.count))
    const bAvg = mean(allScores.filter(s => s.variant === "B:2-pass" && s.seed === seed.name).map(s => s.count))
    const delta = bAvg - aAvg
    const arrow = delta < 0 ? "better" : delta > 0 ? "worse" : "same"
    console.log(`  ${seed.name.padEnd(24)} ${aAvg.toFixed(1).padEnd(14)} ${bAvg.toFixed(1).padEnd(14)} ${delta > 0 ? "+" : ""}${delta.toFixed(1)} (${arrow})`)
  }

  console.log(`\n  Experiment #${expId} saved to tuning DB`)
  console.log()
}

main()
