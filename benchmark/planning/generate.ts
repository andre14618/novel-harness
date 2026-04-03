/**
 * Planning benchmark generator + config.
 *
 * Extracted from run.ts. Contains the planning-specific logic:
 * - Seed loading (builds planning context from seed JSON)
 * - Outline generation (calls planning-plotter agent)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { getTokenCost } from "../../src/config/pricing"
import { getTransport } from "../../src/transport"
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

  try {
    const response = await getTransport().execute({
      systemPrompt: PLANNER_PROMPT,
      userPrompt,
      model: writer.model,
      provider: writer.provider,
      temperature: 0.6,
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
      extraBody: writer.extraBody,
      callerId: "planning-plotter",
    })

    const content = response.content
    if (!content) { console.log(`FAIL [empty]`); return null }

    const promptTokens = response.usage.prompt_tokens ?? 0
    const completionTokens = response.usage.completion_tokens ?? 0
    const cost = getTokenCost(writer.provider, writer.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "writer", "planning-plotter", writer.model, writer.provider, promptTokens, completionTokens, Math.round(response.latencyMs), cost, { seed: input.name, attempt })

    return {
      output: content,
      wordCount: content.split(/\s+/).length,
      latencyMs: Math.round(response.latencyMs),
      tps: completionTokens > 0 ? Math.round(completionTokens / (response.latencyMs / 1000)) : 0,
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
  promptTargets: [
    { path: "src/agents/planning-plotter/prompt.md", agentName: "planning-plotter" },
  ],
  runCmd: "bun benchmark/planning/run.ts",
  daemonEnv: { BENCHMARK_SEEDS: "romance-drama", BENCHMARK_RUNS: "2" },
  buildAgentInput: (input) => ({
    userPrompt: input.prompt,
    temperature: 0.6,
    maxTokens: 8192,
    responseFormat: { type: "json_object" },
  }),
}
