/**
 * Extraction benchmark generator + config.
 *
 * Tests the extractor agents (summary-extractor, fact-extractor, character-state):
 * given a known prose chapter, how complete and accurate are the extractions?
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { getTokenCost } from "../../src/config/pricing"
import { getTransport } from "../../src/transport"
import { saveLLMCall } from "../db"
import { judgeScoreSchema, DIMENSIONS, DIMENSION_LABELS } from "./judges/schema"
import type { BenchmarkConfig, BenchmarkInput, GenerationResult } from "../engine"
import type { WriterConfig } from "../config"

// Load extractor prompts
const SUMMARY_PROMPT = readFileSync(new URL("../../src/agents/summary-extractor/prompt.md", import.meta.url).pathname, "utf-8")
const FACT_PROMPT = readFileSync(new URL("../../src/agents/fact-extractor/prompt.md", import.meta.url).pathname, "utf-8")
const CHAR_STATE_PROMPT = readFileSync(new URL("../../src/agents/character-state/prompt.md", import.meta.url).pathname, "utf-8")

const MAX_SAMPLES = parseInt(process.env.BENCHMARK_SAMPLES ?? "0")
const AGENT_FILTER = process.env.BENCHMARK_AGENT

// ── Sample loading ──────────────────────────────────────────────────────

function loadSamples(filter?: string[]): BenchmarkInput[] {
  const samples: BenchmarkInput[] = []
  const outputDir = "output"
  if (!existsSync(outputDir)) return samples

  const novelDirs = readdirSync(outputDir)
    .filter(d => d.startsWith("novel-"))
    .sort()
    .reverse()
    .slice(0, 3)

  for (const dir of novelDirs) {
    const chapterFiles = readdirSync(`${outputDir}/${dir}`)
      .filter(f => f.match(/^chapter-\d+\.md$/))
      .sort()

    for (const file of chapterFiles) {
      const prose = readFileSync(`${outputDir}/${dir}/${file}`, "utf-8")
        .replace(/^# .*\n\n/, "")
      if (prose.split(/\s+/).length > 200) {
        samples.push({ name: `${dir}/${file}`, prose })
      }
    }
  }

  if (MAX_SAMPLES > 0 && samples.length > MAX_SAMPLES) {
    return samples.slice(0, MAX_SAMPLES)
  }
  return samples
}

// ── Extractor call ──────────────────────────────────────────────────────

async function runExtractor(
  writer: WriterConfig, systemPrompt: string, prose: string,
  runId: number, extractorName: string, sampleName: string,
): Promise<{ output: string; latencyMs: number } | null> {
  const userPrompt = writer.needsNothink ? `/nothink\n${prose}` : prose

  try {
    const response = await getTransport().execute({
      systemPrompt,
      userPrompt,
      model: writer.model,
      provider: writer.provider,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
      extraBody: writer.extraBody,
      callerId: extractorName,
    })

    const content = response.content
    if (!content) { console.log(`  FAIL [empty] ${extractorName}`); return null }

    const promptTokens = response.usage.prompt_tokens ?? 0
    const completionTokens = response.usage.completion_tokens ?? 0
    const cost = getTokenCost(writer.provider, writer.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "writer", extractorName, writer.model, writer.provider, promptTokens, completionTokens, Math.round(response.latencyMs), cost, { seed: sampleName })

    return { output: content, latencyMs: Math.round(response.latencyMs) }
  } catch (err) {
    console.log(`  FAIL [exception] ${extractorName}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Generator (runs all 3 extractors) ───────────────────────────────────

async function generateExtraction(
  writer: WriterConfig, input: BenchmarkInput, runId: number, _attempt: number,
): Promise<GenerationResult | null> {
  const shouldRun = (name: string) => !AGENT_FILTER || AGENT_FILTER === name
  const [summary, facts, charState] = await Promise.all([
    shouldRun("summary-extractor") ? runExtractor(writer, SUMMARY_PROMPT, input.prose, runId, "summary-extractor", input.name) : null,
    shouldRun("fact-extractor") ? runExtractor(writer, FACT_PROMPT, input.prose, runId, "fact-extractor", input.name) : null,
    shouldRun("character-state") ? runExtractor(writer, CHAR_STATE_PROMPT, input.prose, runId, "character-state", input.name) : null,
  ])

  if (!summary && !facts && !charState) return null

  const combined = [
    summary ? `SUMMARY:\n${summary.output}` : "",
    facts ? `FACTS:\n${facts.output}` : "",
    charState ? `CHARACTER STATES:\n${charState.output}` : "",
  ].filter(Boolean).join("\n\n")

  return {
    output: combined,
    wordCount: combined.split(/\s+/).length,
    latencyMs: Math.max(summary?.latencyMs ?? 0, facts?.latencyMs ?? 0, charState?.latencyMs ?? 0),
  }
}

// ── Config ──────────────────────────────────────────────────────────────

export const config: BenchmarkConfig<typeof DIMENSIONS[number]> = {
  name: "extraction",
  displayName: "Extraction Benchmark",
  dimensions: DIMENSIONS,
  dimensionLabels: DIMENSION_LABELS,
  judgesDir: new URL("./judges", import.meta.url).pathname,
  judgeSchema: judgeScoreSchema,
  scoring: "score",
  loadInputs: loadSamples,
  generate: generateExtraction,
  buildJudgePrompt: (input, extractedData) =>
    `ORIGINAL PROSE:\n${input.prose}\n\nEXTRACTED DATA:\n${extractedData}`,
  promptTargets: [
    { path: "src/agents/fact-extractor/prompt.md", agentName: "fact-extractor" },
    { path: "src/agents/summary-extractor/prompt.md", agentName: "summary-extractor" },
    { path: "src/agents/character-state/prompt.md", agentName: "character-state" },
    { path: "src/agents/relationship-timeline/prompt.md", agentName: "relationship-timeline" },
  ],
  runCmd: "bun benchmark/extraction/run.ts",
  daemonEnv: { BENCHMARK_RUNS: "2", BENCHMARK_SAMPLES: "2" },
  buildAgentInput: (input, agentName) => {
    if (!agentName) return null
    return {
      userPrompt: input.prose,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
    }
  },
}
