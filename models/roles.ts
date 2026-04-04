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

// ── Runtime overrides (set via web UI, cleared on restart) ──────────────

const runtimeOverrides = new Map<string, Partial<ModelAssignment>>()

export function setAgentOverride(agentName: string, override: Partial<ModelAssignment>): void {
  runtimeOverrides.set(agentName, override)
}

export function clearAgentOverride(agentName: string): void {
  runtimeOverrides.delete(agentName)
}

export function getAgentOverrides(): Record<string, Partial<ModelAssignment>> {
  return Object.fromEntries(runtimeOverrides)
}

/**
 * Persist current overrides into AGENT_MODELS source and clear the override map.
 * Rewrites this file (models/roles.ts) with the merged config.
 */
export async function persistOverrides(): Promise<{ changed: string[] }> {
  const overrides = [...runtimeOverrides.entries()]
  if (overrides.length === 0) return { changed: [] }

  const filePath = new URL(import.meta.url).pathname
  const src = await Bun.file(filePath).text()

  let result = src
  const changed: string[] = []

  for (const [agentName, override] of overrides) {
    const base = AGENT_MODELS[agentName]
    if (!base) continue

    const merged = { ...base, ...override }

    // Build the new value string
    const parts: string[] = [
      `provider: "${merged.provider}"`,
      `model: "${merged.model}"`,
    ]
    if (merged.temperature !== undefined) parts.push(`temperature: ${merged.temperature}`)
    if (merged.maxTokens !== undefined) parts.push(`maxTokens: ${merged.maxTokens}`)
    if (merged.thinking) parts.push(`thinking: true`)

    const newValue = `{ ${parts.join(", ")} }`

    // Match the line:  "agentName":  { ... },
    const pattern = new RegExp(
      `("${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*)\\{[^}]+\\}`,
    )

    if (pattern.test(result)) {
      result = result.replace(pattern, `$1${newValue}`)
      changed.push(agentName)

      // Also update the runtime AGENT_MODELS object
      AGENT_MODELS[agentName] = merged
    }
  }

  if (changed.length > 0) {
    await Bun.write(filePath, result)
    // Clear overrides since they're now in the source
    for (const name of changed) {
      runtimeOverrides.delete(name)
    }
  }

  return { changed }
}

export function getModelForAgent(agentName: string): ModelAssignment | undefined {
  const base = AGENT_MODELS[agentName]
  const override = runtimeOverrides.get(agentName)
  if (!base && !override) return undefined
  return override ? { ...base, ...override } as ModelAssignment : base
}

/** Returns the full agent config with defaults applied, including runtime overrides. */
export function getAgentConfig(agentName: string): {
  provider: ProviderName; model: string
  temperature: number; maxTokens: number; thinking: boolean
} | undefined {
  const base = AGENT_MODELS[agentName]
  if (!base) return undefined
  const override = runtimeOverrides.get(agentName)
  const merged = override ? { ...base, ...override } : base
  return {
    provider: merged.provider,
    model: merged.model,
    temperature: merged.temperature ?? DEFAULTS.temperature,
    maxTokens: merged.maxTokens ?? DEFAULTS.maxTokens,
    thinking: merged.thinking ?? DEFAULTS.thinking,
  }
}
