/**
 * Benchmark writer/judge config.
 *
 * Models are set in models/roles.ts (benchmark-writer, benchmark-judge)
 * alongside every other agent role. Env overrides still work for one-off tests.
 */

import { MODELS, PROVIDERS, getApiKey, type ModelDef } from "../models/registry"
import { AGENT_MODELS } from "../models/roles"

export interface WriterConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  needsNothink?: boolean
}

export interface JudgeConfig {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  useMaxCompletionTokens?: boolean
}

function toWriterConfig(m: ModelDef): WriterConfig {
  const provider = PROVIDERS[m.provider]
  return {
    label: m.label,
    apiUrl: provider.apiUrl,
    apiKey: getApiKey(m.provider),
    model: m.id,
    extraBody: provider.extraBody?.(),
    needsNothink: m.needsNothink,
  }
}

function toJudgeConfig(m: ModelDef): JudgeConfig {
  const provider = PROVIDERS[m.provider]
  return {
    label: m.label,
    apiUrl: provider.apiUrl,
    apiKey: getApiKey(m.provider),
    model: m.id,
    extraBody: provider.extraBody?.(),
    useMaxCompletionTokens: m.useMaxCompletionTokens,
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
  const fromRole = resolveFromRole("benchmark-writer")
  if (fromRole) return toWriterConfig(fromRole)

  throw new Error('No benchmark-writer in roles.ts and BENCHMARK_MODEL not set.')
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
  const fromRole = resolveFromRole("benchmark-judge")
  if (fromRole) return [toJudgeConfig(fromRole)]

  throw new Error('No benchmark-judge in roles.ts and BENCHMARK_JUDGES not set.')
}
