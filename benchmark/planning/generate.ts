/**
 * Planning benchmark generator + config.
 *
 * Extracted from run.ts. Contains the planning-specific logic:
 * - Seed loading (builds planning context from seed JSON)
 * - Outline generation (calls planning-plotter agent)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { getTokenCost } from "../../src/config/pricing"
import { saveLLMCall } from "../db"
import { judgeScoreSchema, DIMENSIONS, DIMENSION_LABELS } from "./judges/schema"
import type { BenchmarkConfig, BenchmarkInput, GenerationResult } from "../engine"
import type { WriterConfig } from "../config"

const PLANNER_PROMPT_PATH = new URL("../../src/agents/planning-plotter/prompt.md", import.meta.url).pathname
const PLANNER_PROMPT = readFileSync(PLANNER_PROMPT_PATH, "utf-8")
const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

// ── Seed loading ────────────────────────────────────────────────────────

function loadSeeds(filter?: string[]): BenchmarkInput[] {
  const seedFiles = readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .filter((f: string) => !filter || filter.includes(f))
    .sort()
  const seeds: BenchmarkInput[] = []

  for (const name of seedFiles) {
    const path = `${SEEDS_DIR}/${name}.json`
    if (!existsSync(path)) continue
    const seed = JSON.parse(readFileSync(path, "utf-8"))

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

// ── Generator ───────────────────────────────────────────────────────────

async function generateOutline(
  writer: WriterConfig, input: BenchmarkInput, runId: number, attempt: number,
): Promise<GenerationResult | null> {
  const userPrompt = writer.needsNothink ? `/nothink\n${input.prompt}` : input.prompt
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

    const providerName = writer.apiUrl.includes("cerebras.ai") ? "cerebras"
      : writer.apiUrl.includes("groq.com") ? "groq"
      : writer.apiUrl.includes("deepseek.com") ? "deepseek"
      : writer.apiUrl.includes("openai.com") ? "openai"
      : "openrouter"
    const cost = getTokenCost(providerName as any, writer.model, promptTokens, completionTokens)
    saveLLMCall(runId, "writer", "planning-plotter", writer.model, providerName, promptTokens, completionTokens, Math.round(elapsed), cost, { seed: input.name, attempt })

    return {
      output: content,
      wordCount: content.split(/\s+/).length,
      latencyMs: Math.round(elapsed),
      tps: completionTokens > 0 ? Math.round(completionTokens / (elapsed / 1000)) : 0,
      tokens: completionTokens,
      promptTokens,
    }
  } catch (err) {
    console.log(`FAIL [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Config ──────────────────────────────────────────────────────────────

export const config: BenchmarkConfig<typeof DIMENSIONS[number]> = {
  name: "planning",
  displayName: "Planning Benchmark",
  dimensions: DIMENSIONS,
  dimensionLabels: DIMENSION_LABELS,
  judgesDir: new URL("./judges", import.meta.url).pathname,
  judgeSchema: judgeScoreSchema,
  scoring: "score",
  loadInputs: loadSeeds,
  generate: generateOutline,
}
