/**
 * Atomic benchmark operations.
 *
 * Three primitives that replace full benchmark pipelines for targeted
 * improvement iterations:
 *
 *   generate() — call one agent for one seed, save to DB
 *   judge()    — score one generation on one dimension
 *   compare()  — pairwise comparison of two generations
 *
 * Full benchmark pipelines are still used for end-of-cycle validation.
 */

import { readFileSync } from "node:fs"
import { getTransport } from "../transport"
import { getTokenCost } from "../config/pricing"
import { extractJSON } from "../llm"
import { getModelForAgent, getAgentConfig } from "../../models/roles"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { getDaemonTargetFull } from "../../benchmark/registry"
import { getJudges, getPairwiseJudge } from "../../benchmark/config"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall,
} from "../../benchmark/db"
import { runMatchup } from "../../benchmark/pairwise/judge"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

// ── Types ──────────────────────────────────────────────────────────────

export interface GenerateInput {
  benchmarkType: string       // "planning", "extraction", etc.
  seedName: string            // "romance-drama"
  promptOverride?: string     // test a new prompt without writing to disk
  agentName?: string          // for multi-agent benchmarks (extraction)
  experimentId?: number
}

export interface GenerateResult {
  generationId: number
  runId: number
  output: string
  latencyMs: number
  tokens: { prompt: number; completion: number }
}

export interface JudgeInput {
  generationId: number
  dimension: string           // "dialogue-cues"
  judgeModel?: string         // override; default from roles.ts "judge"
  // Context needed to load rubric + build judge prompt
  benchmarkType: string
  seedName?: string           // for buildJudgePrompt that needs the input
}

export interface JudgeResult {
  score: number
  reasoning: string
  latencyMs: number
  tokens: { prompt: number; completion: number }
}

export interface CompareInput {
  generationIdA: number
  generationIdB: number
  dimension?: string          // optional focus dimension
}

export interface CompareResult {
  winner: "A" | "B" | "tie" | "inconsistent"
  confidence: string
  reasoning: string
}

// ── generate() ─────────────────────────────────────────────────────────

export async function generate(input: GenerateInput): Promise<GenerateResult | null> {
  const target = getDaemonTargetFull(input.benchmarkType)
  if (!target) throw new Error(`Unknown benchmark: ${input.benchmarkType}`)
  if (!target.supportsAtomic) throw new Error(`${input.benchmarkType} doesn't support atomic generation`)

  // Load the specific seed
  const inputs = target.loadInputs([input.seedName])
  if (inputs.length === 0) throw new Error(`Seed not found: ${input.seedName}`)
  const seedInput = inputs[0]

  // Determine which agent we're calling
  const agentName = input.agentName ?? target.promptFiles[0]?.agentName
  if (!agentName) throw new Error(`No agent name for ${input.benchmarkType}`)

  // Build user prompt from benchmark config
  const agentInput = target.buildAgentInput!(seedInput, agentName)
  if (!agentInput) throw new Error(`buildAgentInput returned null for ${agentName}`)

  // Get system prompt: override or read from disk
  let systemPrompt: string
  if (input.promptOverride) {
    systemPrompt = input.promptOverride
  } else {
    const promptFile = target.promptFiles.find(f => f.agentName === agentName)
    if (!promptFile) throw new Error(`No prompt file for agent ${agentName}`)
    systemPrompt = readFileSync(`${HARNESS_ROOT}/${promptFile.path}`, "utf-8")
  }

  // Get model config for this agent
  const agentConfig = getAgentConfig(agentName)
  if (!agentConfig) throw new Error(`No model config for agent ${agentName}`)

  const model = MODELS.find(m => m.id === agentConfig.model && m.provider === agentConfig.provider)
  const needsNothink = model?.needsNothink ?? false
  const userPrompt = needsNothink ? `/nothink\n${agentInput.userPrompt}` : agentInput.userPrompt

  // Init DB, create run
  getDB()
  const runId = await createRun(
    input.benchmarkType,
    input.seedName,
    `atomic/${agentName}`,
    input.experimentId,
  )

  // Call transport
  const response = await getTransport().execute({
    systemPrompt,
    userPrompt,
    model: agentConfig.model,
    provider: agentConfig.provider,
    temperature: agentInput.temperature,
    maxTokens: agentInput.maxTokens,
    responseFormat: agentInput.responseFormat,
    callerId: agentName,
  })

  const content = response.content
  if (!content) {
    console.log(`[atomic:generate] Empty response from ${agentName}`)
    await saveGeneration(runId, input.seedName, 1, { passed: false })
    return null
  }

  const promptTokens = response.usage.prompt_tokens ?? 0
  const completionTokens = response.usage.completion_tokens ?? 0
  const cost = getTokenCost(agentConfig.provider, agentConfig.model, promptTokens, completionTokens)

  await saveLLMCall(runId, "writer", agentName, agentConfig.model, agentConfig.provider, promptTokens, completionTokens, Math.round(response.latencyMs), cost, { seed: input.seedName })

  const wordCount = content.split(/\s+/).length
  const generationId = await saveGeneration(runId, input.seedName, 1, {
    prose: content,
    wordCount,
    latencyMs: Math.round(response.latencyMs),
    tokensPerSec: completionTokens > 0 ? Math.round(completionTokens / (response.latencyMs / 1000)) : undefined,
    completionTokens,
    passed: true,
  })

  console.log(`[atomic:generate] ${input.benchmarkType}/${input.seedName} → gen #${generationId} (${wordCount} words, ${Math.round(response.latencyMs)}ms)`)

  return {
    generationId,
    runId,
    output: content,
    latencyMs: Math.round(response.latencyMs),
    tokens: { prompt: promptTokens, completion: completionTokens },
  }
}

// ── judge() ────────────────────────────────────────────────────────────

export async function judge(input: JudgeInput): Promise<JudgeResult | null> {
  const target = getDaemonTargetFull(input.benchmarkType)
  if (!target) throw new Error(`Unknown benchmark: ${input.benchmarkType}`)

  // Load generation from DB
  const db = (await import("../../data/connection")).default
  const gens = await db`SELECT id, prose, run_id, seed FROM generations WHERE id = ${input.generationId}` as any[]
  if (gens.length === 0) throw new Error(`Generation #${input.generationId} not found`)
  const gen = gens[0]

  // Check dimension is valid
  if (!target.dimensions.includes(input.dimension)) {
    throw new Error(`Unknown dimension ${input.dimension} for ${input.benchmarkType}`)
  }

  // Load rubric
  const rubricPath = `${target.judgesDir}/${input.dimension}.md`
  const rubric = readFileSync(rubricPath, "utf-8")

  // Build the content to judge — either just the output or a custom judge prompt
  let judgeContent: string
  if (target.buildJudgePrompt && input.seedName) {
    const inputs = target.loadInputs([input.seedName])
    judgeContent = inputs.length > 0
      ? target.buildJudgePrompt(inputs[0], gen.prose)
      : gen.prose
  } else {
    judgeContent = gen.prose
  }

  // Get judge config
  const judges = getJudges()
  const judgeConfig = judges[0]

  // Score extractor
  const defaultExtractor = target.scoring === "penalty"
    ? (parsed: any) => parsed.issues?.length ?? parsed.count ?? 0
    : (parsed: any) => parsed.score
  const extractScore = target.scoreExtractor ?? defaultExtractor

  // Call judge via transport (same approach as engine.ts judgeOneDimension)
  const start = performance.now()
  const response = await getTransport().execute({
    systemPrompt: judgeContent,
    userPrompt: rubric,
    model: judgeConfig.model,
    provider: judgeConfig.provider,
    temperature: 0.1,
    maxTokens: 4096,
    useMaxCompletionTokens: judgeConfig.useMaxCompletionTokens,
    responseFormat: { type: "json_object" },
    extraBody: judgeConfig.extraBody,
    callerId: "judge",
  })

  const latencyMs = Math.round(performance.now() - start)
  const content = response.content
  if (!content) {
    console.log(`[atomic:judge] Empty response for gen #${input.generationId}/${input.dimension}`)
    return null
  }

  const promptTokens = response.usage.prompt_tokens ?? 0
  const completionTokens = response.usage.completion_tokens ?? 0
  const cost = getTokenCost(judgeConfig.provider, judgeConfig.model, promptTokens, completionTokens)
  await saveLLMCall(gen.run_id, "judge", null, judgeConfig.model, judgeConfig.provider, promptTokens, completionTokens, latencyMs, cost, { seed: gen.seed, dimension: input.dimension })

  // Parse + validate
  const jsonStr = extractJSON(content)
  const parsed = JSON.parse(jsonStr)
  const result = target.judgeSchema.safeParse(parsed)
  if (!result.success) {
    console.log(`[atomic:judge] Zod validation failed for gen #${input.generationId}/${input.dimension}`)
    return null
  }

  const score = extractScore(result.data, input.dimension)
  const reasoning = result.data.reasoning ?? ""

  // Save to DB
  await saveScore(input.generationId, judgeConfig.label, input.dimension, score, reasoning)
  console.log(`[atomic:judge] gen #${input.generationId}/${input.dimension}: ${score}${target.scoring === "score" ? "/10" : " issues"}`)

  return {
    score,
    reasoning,
    latencyMs,
    tokens: { prompt: promptTokens, completion: completionTokens },
  }
}

// ── compare() ──────────────────────────────────────────────────────────

export async function compare(input: CompareInput): Promise<CompareResult | null> {
  const db = (await import("../../data/connection")).default

  // Load both generations
  const gens = await db`SELECT id, prose FROM generations WHERE id IN (${input.generationIdA}, ${input.generationIdB})` as any[]
  if (gens.length < 2) throw new Error(`Need 2 generations, found ${gens.length}`)

  const genA = gens.find((g: any) => g.id === input.generationIdA)
  const genB = gens.find((g: any) => g.id === input.generationIdB)
  if (!genA || !genB) throw new Error("Generation not found")

  const judgeConfig = getPairwiseJudge()
  const result = await runMatchup(judgeConfig, genA.prose, genB.prose)

  const winnerMap = { first: "A", second: "B", tie: "tie", inconsistent: "inconsistent" } as const

  console.log(`[atomic:compare] gen #${input.generationIdA} vs #${input.generationIdB}: ${result.canonical}`)

  return {
    winner: winnerMap[result.canonical],
    confidence: result.forward?.confidence ?? result.reverse?.confidence ?? "tie",
    reasoning: result.forward?.reasoning ?? result.reverse?.reasoning ?? "",
  }
}
