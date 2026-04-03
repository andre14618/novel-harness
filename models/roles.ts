/**
 * Agent-to-model mapping.
 *
 * Change a model here and that agent picks it up on next run.
 * This is the single place to control which model every agent uses,
 * including call parameters (temperature, maxTokens, thinking).
 */

import type { ProviderName } from "./registry"

export interface ModelAssignment {
  provider: ProviderName
  model: string
  temperature?: number   // default: 0.7
  maxTokens?: number     // default: 4096
  thinking?: boolean     // default: false
}

const DEFAULTS = { temperature: 0.7, maxTokens: 4096, thinking: false } as const

const groqQwen32B: ModelAssignment = { provider: "groq", model: "qwen/qwen3-32b" }
const groqKimiK2: ModelAssignment = { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" }
const deepseekV3: ModelAssignment = { provider: "deepseek", model: "deepseek-chat" }

export const AGENT_MODELS: Record<string, ModelAssignment> = {
  // ── Writers (creative prose, high output) ─────────────────────────────
  "writer":                    { ...groqKimiK2, temperature: 0.8, maxTokens: 16384 },
  "rewriter":                  { ...groqKimiK2, temperature: 0.5, maxTokens: 16384 },
  "prose-polish":              { ...groqKimiK2, temperature: 0.4, maxTokens: 16384 },

  // ── Planners (structured creative output) ─────────────────────────────
  "world-builder":             { ...groqQwen32B, maxTokens: 8192 },
  "character-agent":           { ...groqQwen32B, maxTokens: 8192 },
  "plotter":                   { ...groqQwen32B, maxTokens: 8192 },
  "planning-plotter":          { ...groqQwen32B, temperature: 0.6, maxTokens: 8192 },

  // ── Retries (higher temperature to get different output on schema failures) ──
  "world-builder-retry":       { ...groqQwen32B, temperature: 0.8, maxTokens: 8192 },
  "character-agent-retry":     { ...groqQwen32B, temperature: 0.8, maxTokens: 8192 },
  "plotter-retry":             { ...groqQwen32B, temperature: 0.8, maxTokens: 8192 },
  "planning-plotter-retry":    { ...groqQwen32B, temperature: 0.8, maxTokens: 8192 },

  // ── Extractors (structured extraction from prose) ─────────────────────
  "summary-extractor":         { ...groqQwen32B, temperature: 0.2 },
  "fact-extractor":            { ...groqQwen32B, temperature: 0.1 },
  "character-state":           { ...groqQwen32B, temperature: 0.1 },

  // ── Validators (analytical checks) ────────────────────────────────────
  "continuity":                { ...groqQwen32B, temperature: 0.2 },
  "cross-chapter-continuity":  { ...groqQwen32B, temperature: 0.2 },
  "prose-quality":             { ...groqQwen32B, temperature: 0.2 },

  // ── Judges (novel validation) ────────────────────────────────────────
  "judge":                     { ...deepseekV3, temperature: 0.1 },
  "pairwise-judge":            { ...deepseekV3, temperature: 0.1 },

  // ── Benchmark (can tune independently from novel pipeline) ───────────
  "benchmark-writer":          { ...groqKimiK2, temperature: 0.8, maxTokens: 16384 },
  "benchmark-judge":           { ...deepseekV3, temperature: 0.1 },

  // ── Improvement daemon ──────────────────────────────────────────────
  "improver":                  { ...deepseekV3, maxTokens: 8192 },
}

export function getModelForAgent(agentName: string): ModelAssignment | undefined {
  return AGENT_MODELS[agentName]
}

/** Returns the full agent config with defaults applied. */
export function getAgentConfig(agentName: string): {
  provider: ProviderName; model: string
  temperature: number; maxTokens: number; thinking: boolean
} | undefined {
  const assignment = AGENT_MODELS[agentName]
  if (!assignment) return undefined
  return {
    provider: assignment.provider,
    model: assignment.model,
    temperature: assignment.temperature ?? DEFAULTS.temperature,
    maxTokens: assignment.maxTokens ?? DEFAULTS.maxTokens,
    thinking: assignment.thinking ?? DEFAULTS.thinking,
  }
}
