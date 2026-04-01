/**
 * Benchmark writer/judge config — resolves models from the central registry.
 *
 * Writer: set via BENCHMARK_PROVIDER or BENCHMARK_MODEL env vars.
 * Judges: set via BENCHMARK_JUDGES env var ("Gemini 3 Flash,Qwen3 32B")
 *         or defaults to Gemini 3 Flash + Qwen3 32B.
 */

import { MODELS, PROVIDERS, getApiKey, type ModelDef } from "../models/registry"

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

// Default writer per provider
const WRITER_DEFAULTS: Record<string, string> = {
  groq: "qwen/qwen3-32b",
  cerebras: "qwen-3-235b-a22b-instruct-2507",
  openrouter: "qwen/qwen3-32b",
  deepseek: "deepseek-chat",
  openai: "gpt-5.4-mini",
}

// Default judge models (label match) — used when BENCHMARK_JUDGES not set
const DEFAULT_JUDGES = ["Gemini 3 Flash", "Qwen3 32B"]

export function getWriter(): WriterConfig {
  const provider = process.env.BENCHMARK_PROVIDER ?? process.env.LLM_PROVIDER ?? "groq"
  const model = process.env.BENCHMARK_MODEL

  if (model) {
    const found = MODELS.find(m => m.id === model || m.label.toLowerCase() === model.toLowerCase())
    if (found) return toWriterConfig(found)
  }

  const defaultId = WRITER_DEFAULTS[provider]
  if (defaultId) {
    const found = MODELS.find(m => m.id === defaultId && m.provider === provider)
    if (found) return toWriterConfig(found)
  }

  throw new Error(`No writer model found for provider "${provider}". Set BENCHMARK_MODEL explicitly.`)
}

export function getJudges(): JudgeConfig[] {
  const judgeEnv = process.env.BENCHMARK_JUDGES
  const labels = judgeEnv
    ? judgeEnv.split(",").map(s => s.trim().toLowerCase())
    : DEFAULT_JUDGES.map(s => s.toLowerCase())

  const judges: JudgeConfig[] = []
  for (const label of labels) {
    const found = MODELS.find(m => {
      if (!m.label.toLowerCase().includes(label)) return false
      return !!process.env[PROVIDERS[m.provider].envKey]
    })
    if (found) judges.push(toJudgeConfig(found))
  }

  if (judges.length === 0) throw new Error("No judge models found. Set BENCHMARK_JUDGES or check API keys.")
  return judges
}
