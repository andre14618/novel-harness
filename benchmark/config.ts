/**
 * Benchmark writer/judge config.
 *
 * Models are set in models/roles.ts (writer, penalty-judge, pairwise-judge)
 * alongside every other agent role. Env overrides still work for one-off tests.
 */

import { MODELS, PROVIDERS, getApiKey, type ModelDef, type ProviderName } from "../models/registry"
import { AGENT_MODELS } from "../models/roles"

export interface WriterConfig {
  label: string
  provider: ProviderName
  model: string
  maxTokens: number
  extraBody?: Record<string, any>
  needsNothink?: boolean
  /** @deprecated Use provider field + transport layer instead. Kept for unmigrated benchmark runners. */
  apiUrl: string
  /** @deprecated Use provider field + transport layer instead. Kept for unmigrated benchmark runners. */
  apiKey: string
}

export interface JudgeConfig {
  label: string
  provider: ProviderName
  model: string
  extraBody?: Record<string, any>
  useMaxCompletionTokens?: boolean
  /** @deprecated Use provider field + transport layer instead. Kept for unmigrated benchmark runners. */
  apiUrl: string
  /** @deprecated Use provider field + transport layer instead. Kept for unmigrated benchmark runners. */
  apiKey: string
}

function toWriterConfig(m: ModelDef): WriterConfig {
  const providerDef = PROVIDERS[m.provider]
  return {
    label: m.label,
    provider: m.provider,
    model: m.id,
    maxTokens: Math.min(m.maxOutput ?? 16384, 16384),
    extraBody: providerDef.extraBody?.(),
    needsNothink: m.needsNothink,
    apiUrl: providerDef.apiUrl,
    apiKey: getApiKey(m.provider),
  }
}

function toJudgeConfig(m: ModelDef): JudgeConfig {
  const providerDef = PROVIDERS[m.provider]
  return {
    label: m.label,
    provider: m.provider,
    model: m.id,
    extraBody: providerDef.extraBody?.(),
    useMaxCompletionTokens: m.useMaxCompletionTokens,
    apiUrl: providerDef.apiUrl,
    apiKey: getApiKey(m.provider),
  }
}

function resolveFromRole(role: string): ModelDef | undefined {
  const assignment = AGENT_MODELS[role]
  if (!assignment) return undefined
  return MODELS.find(m => m.id === assignment.model && m.provider === assignment.provider)
}

export function getWriter(): WriterConfig {
  // Env override for one-off tests
  const envModel = process.env.BENCHMARK_MODEL
  if (envModel) {
    const found = MODELS.find(m => m.id === envModel || m.label.toLowerCase() === envModel.toLowerCase())
    if (found) return toWriterConfig(found)
  }

  // Primary: roles.ts
  const fromRole = resolveFromRole("writer")
  if (fromRole) return toWriterConfig(fromRole)

  throw new Error('No writer in roles.ts and BENCHMARK_MODEL not set.')
}

export function getJudges(): JudgeConfig[] {
  // Env override for one-off tests
  const judgeEnv = process.env.BENCHMARK_JUDGES
  if (judgeEnv) {
    const labels = judgeEnv.split(",").map(s => s.trim().toLowerCase())
    const judges: JudgeConfig[] = []
    for (const label of labels) {
      const found = MODELS.find(m => {
        if (!m.label.toLowerCase().includes(label)) return false
        return !!process.env[PROVIDERS[m.provider].envKey]
      })
      if (found) judges.push(toJudgeConfig(found))
    }
    if (judges.length === 0) throw new Error("No judge models found for BENCHMARK_JUDGES labels.")
    return judges
  }

  // Primary: roles.ts
  const fromRole = resolveFromRole("judge")
  if (fromRole) return [toJudgeConfig(fromRole)]

  throw new Error('No "judge" in roles.ts and BENCHMARK_JUDGES not set.')
}

export function getPairwiseJudge(): JudgeConfig {
  // Env override
  const judgeEnv = process.env.BENCHMARK_JUDGES
  if (judgeEnv) {
    const label = judgeEnv.split(",")[0].trim().toLowerCase()
    const found = MODELS.find(m => {
      if (!m.label.toLowerCase().includes(label)) return false
      return !!process.env[PROVIDERS[m.provider].envKey]
    })
    if (found) return toJudgeConfig(found)
  }

  // Primary: pairwise-judge role, fallback to judge
  const fromRole = resolveFromRole("pairwise-judge") ?? resolveFromRole("judge")
  if (fromRole) return toJudgeConfig(fromRole)

  throw new Error('No pairwise-judge or judge in roles.ts.')
}
