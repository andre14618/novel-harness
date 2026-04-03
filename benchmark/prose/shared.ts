/**
 * Shared functions for benchmark and experiment runners.
 *
 * Extracted from run.ts and experiment-runner.ts to eliminate duplication.
 * Both runners import from here for seed loading, prose generation, judging, and stats.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { chapterDraftSchema } from "../../src/types"
import { extractJSON } from "../../src/llm"
import { getTokenCost } from "../../src/config/pricing"
import { penaltySchema, DIMENSIONS, type Dimension } from "./judges/schema"
import { saveLLMCall } from "../db"
import { getTransport } from "../../src/transport"
import type { WriterConfig, JudgeConfig } from "../config"

// ── Seed loading ────────────────────────────────────────────────────────

const SEEDS_DIR = new URL("../../src/seeds", import.meta.url).pathname

export interface Seed {
  name: string
  prompt: string
}

export function loadSeeds(filter?: string[]): Seed[] {
  const seedFiles = readdirSync(SEEDS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""))
    .filter((f: string) => !filter || filter.includes(f))
    .sort()

  const seeds: Seed[] = []

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

// ── Judge rubrics ───────────────────────────────────────────────────────

export const JUDGE_RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./judges/${dim}.md`, import.meta.url).pathname
  JUDGE_RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Writer call ─────────────────────────────────────────────────────────

export interface GenerateResult {
  prose: string
  latencyMs: number
  tps: number
  tokens: number
  promptTokens: number
}

export async function generateProse(
  writer: WriterConfig, systemPrompt: string, userPrompt: string,
  runId: number, seed: string, attempt: number,
  temperature: number = 0.8,
): Promise<GenerateResult | null> {
  const finalPrompt = writer.needsNothink ? `/nothink\n${userPrompt}` : userPrompt

  try {
    const response = await getTransport().execute({
      systemPrompt,
      userPrompt: finalPrompt,
      model: writer.model,
      provider: writer.provider,
      temperature,
      maxTokens: writer.maxTokens,
      responseFormat: { type: "json_object" },
      extraBody: writer.extraBody,
      callerId: "writer",
    })

    const content = response.content
    if (!content) {
      console.log(`FAIL [empty] no content in response`)
      return null
    }

    const promptTokens = response.usage.prompt_tokens ?? 0
    const completionTokens = response.usage.completion_tokens ?? 0
    const elapsed = response.latencyMs

    const cost = getTokenCost(writer.provider, writer.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "writer", "writer", writer.model, writer.provider, promptTokens, completionTokens, Math.round(elapsed), cost, { seed, attempt })

    let jsonStr: string
    try { jsonStr = extractJSON(content) }
    catch { console.log(`FAIL [json] could not extract JSON. preview: ${content.slice(0, 120)} `); return null }

    let parsed: any
    try { parsed = JSON.parse(jsonStr) }
    catch { console.log(`FAIL [parse] invalid JSON after extraction. preview: ${jsonStr.slice(0, 120)} `); return null }

    const zodResult = chapterDraftSchema.safeParse(parsed)
    if (!zodResult.success) {
      console.log(`FAIL [zod] ${zodResult.error.issues.map(i => `${i.path}: ${i.message}`).join("; ").slice(0, 150)} `)
      return null
    }

    return {
      prose: parsed.prose,
      latencyMs: Math.round(elapsed),
      tps: completionTokens > 0 ? Math.round(completionTokens / (elapsed / 1000)) : 0,
      tokens: completionTokens,
      promptTokens,
    }
  } catch (err) {
    console.log(`FAIL [exception] ${err instanceof Error ? err.message : err} `)
    return null
  }
}

// ── Judge call (penalty-based) ──────────────────────────────────────────

export async function judgeDimension(
  judge: JudgeConfig, dimension: Dimension, prose: string, runId: number, seed: string,
  customId?: string,
): Promise<{ count: number; issues: Array<{ quote: string; problem: string }> } | null> {
  const rubric = JUDGE_RUBRICS[dimension]

  try {
    const response = await getTransport().execute({
      systemPrompt: `Here is a prose passage:\n\n${prose}\n\n---\n\n${rubric}`,
      userPrompt: "Evaluate the prose above according to the rubric. Return the JSON result.",
      model: judge.model,
      provider: judge.provider,
      temperature: 0.1,
      maxTokens: 4096,
      useMaxCompletionTokens: judge.useMaxCompletionTokens,
      responseFormat: { type: "json_object" },
      extraBody: judge.extraBody,
      callerId: "judge",
      customId,
    })

    const content = response.content
    if (!content) {
      console.log(`  ! ${judge.label}/${dimension} [empty]`)
      return null
    }

    const promptTokens = response.usage.prompt_tokens ?? 0
    const completionTokens = response.usage.completion_tokens ?? 0
    const elapsed = response.latencyMs

    const cost = getTokenCost(judge.provider, judge.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "judge", null, judge.model, judge.provider, promptTokens, completionTokens, Math.round(elapsed), cost, { seed, dimension })

    let jsonStr: string
    try { jsonStr = extractJSON(content) }
    catch { console.log(`  ! ${judge.label}/${dimension} [json] extraction failed`); return null }

    let parsed: any
    try { parsed = JSON.parse(jsonStr) }
    catch { console.log(`  ! ${judge.label}/${dimension} [parse] invalid JSON`); return null }

    const result = penaltySchema.safeParse(parsed)
    if (!result.success) {
      console.log(`  ! ${judge.label}/${dimension} [zod] ${result.error.issues.map(i => i.message).join("; ").slice(0, 120)}`)
      return null
    }

    // Negated so higher=better universally (fewer issues = less negative = better)
    return { count: -result.data.issues.length, issues: result.data.issues }
  } catch (err) {
    console.log(`  ! ${judge.label}/${dimension} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Stats helpers ───────────────────────────────────────────────────────

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

