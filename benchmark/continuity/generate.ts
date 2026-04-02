/**
 * Continuity benchmark generator + config.
 *
 * Tests the cross-chapter-continuity agent: given prose with planted
 * contradictions, does the checker find them?
 *
 * NOTE: Requires test fixtures in benchmark/continuity/fixtures/.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { getTokenCost } from "../../src/config/pricing"
import { saveLLMCall } from "../db"
import { detectionScoreSchema, DIMENSIONS, DIMENSION_LABELS } from "./judges/schema"
import type { BenchmarkConfig, BenchmarkInput, GenerationResult } from "../engine"
import type { WriterConfig } from "../config"

const CONTINUITY_PROMPT = readFileSync(new URL("../../src/agents/cross-chapter-continuity/prompt.md", import.meta.url).pathname, "utf-8")
const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname

// ── Fixture loading ─────────────────────────────────────────────────────

function loadFixtures(filter?: string[]): BenchmarkInput[] {
  if (!existsSync(FIXTURES_DIR)) {
    console.log(`  No fixtures directory at ${FIXTURES_DIR}`)
    console.log(`  Create fixtures to run the continuity benchmark.`)
    return []
  }

  return readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const data = JSON.parse(readFileSync(`${FIXTURES_DIR}/${f}`, "utf-8"))
      return { ...data, name: data.name } as BenchmarkInput
    })
    .filter(f => !filter || filter.includes(f.name))
}

// ── Generator (runs continuity checker) ─────────────────────────────────

function detectProvider(apiUrl: string): string {
  if (apiUrl.includes("cerebras.ai")) return "cerebras"
  if (apiUrl.includes("groq.com")) return "groq"
  if (apiUrl.includes("deepseek.com")) return "deepseek"
  if (apiUrl.includes("openai.com")) return "openai"
  return "openrouter"
}

async function runChecker(
  writer: WriterConfig, input: BenchmarkInput, runId: number, _attempt: number,
): Promise<GenerationResult | null> {
  const context = `CHAPTERS:\n${input.chapters.map((c: any) =>
    `--- Chapter ${c.number} ---\n${c.prose}`
  ).join("\n\n")}\n\nESTABLISHED FACTS:\n${input.facts.map((f: any) =>
    `[ch${f.chapter}] ${f.fact}`
  ).join("\n")}`

  const userPrompt = writer.needsNothink ? `/nothink\n${context}` : context
  const start = performance.now()

  try {
    const res = await fetch(writer.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${writer.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writer.model,
        messages: [{ role: "system", content: CONTINUITY_PROMPT }, { role: "user", content: userPrompt }],
        temperature: 0.2, max_tokens: 4096,
        response_format: { type: "json_object" },
        ...writer.extraBody,
      }),
    })

    const elapsed = performance.now() - start
    if (!res.ok) { console.log(`  FAIL [http ${res.status}]`); return null }

    const data = await res.json() as any
    if (data.error) { console.log(`  FAIL [api]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) { console.log(`  FAIL [empty]`); return null }

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const providerName = detectProvider(writer.apiUrl)
    const cost = getTokenCost(providerName as any, writer.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    saveLLMCall(runId, "writer", "cross-chapter-continuity", writer.model, providerName, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed: input.name })

    return {
      output: content,
      wordCount: content.split(/\s+/).length,
      latencyMs: Math.round(elapsed),
    }
  } catch (err) {
    console.log(`  FAIL [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Config ──────────────────────────────────────────────────────────────

export const config: BenchmarkConfig<typeof DIMENSIONS[number]> = {
  name: "continuity",
  displayName: "Continuity Benchmark",
  dimensions: DIMENSIONS,
  dimensionLabels: DIMENSION_LABELS,
  judgesDir: new URL("./judges", import.meta.url).pathname,
  judgeSchema: detectionScoreSchema,
  scoring: "score",
  loadInputs: loadFixtures,
  generate: runChecker,
  buildJudgePrompt: (input, checkerOutput) => {
    const plantedStr = input.plantedIssues.map((p: any, i: number) =>
      `${i + 1}. [ch${p.chapter}] ${p.description}`
    ).join("\n")
    const proseStr = input.chapters.map((c: any) =>
      `--- Chapter ${c.number} ---\n${c.prose.slice(0, 500)}...`
    ).join("\n\n")
    return `CHECKER OUTPUT:\n${checkerOutput}\n\nKNOWN PLANTED ISSUES:\n${plantedStr}\n\nORIGINAL PROSE (for reference):\n${proseStr}`
  },
}
