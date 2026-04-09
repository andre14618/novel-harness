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
const cerebrasQwen235B: ModelAssignment = { provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" }
const groqKimiK2: ModelAssignment = { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" }
const deepseekV3: ModelAssignment = { provider: "deepseek", model: "deepseek-chat" }
const mimoFlash: ModelAssignment = { provider: "mimo", model: "mimo-v2-flash" }
const togetherQwen9B: ModelAssignment = { provider: "together", model: "Qwen/Qwen3.5-9B" }

export const AGENT_MODELS: Record<string, ModelAssignment> = {
  // ── Writers (creative prose, high output) ─────────────────────────────
  "writer":                    { ...cerebrasQwen235B, temperature: 0.8, maxTokens: 8000 },
  "beat-writer":               { ...cerebrasQwen235B, temperature: 0.8, maxTokens: 4000 },
  "rewriter":                  { ...cerebrasQwen235B, temperature: 0.5, maxTokens: 8000 },

  // ── Planners (structured creative output) ─────────────────────────────
  "world-builder":             { ...cerebrasQwen235B, maxTokens: 8192 },
  "character-agent":           { ...cerebrasQwen235B, maxTokens: 8192 },
  "plotter":                   { ...cerebrasQwen235B, maxTokens: 8192 },
  "planning-plotter":          { ...cerebrasQwen235B, temperature: 0.6, maxTokens: 8192 },

  // ── Beat support ──────────────────────────────────────────────────────
  // reference-resolver stays on Llama 3.1 8B Groq — set-union over implicit
  // references, fast tier is the right home, parallel-N may or may not
  // help (different output shape than adherence-checker — pending its own
  // benchmark via scripts/best-of-n-experiment.ts).
  "reference-resolver":        { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 512 },

  // adherence-checker: testing base Qwen3-14B on W&B Inference before committing
  // to a fine-tune. If base 14B agreement with 235B oracle is ≥90% on the
  // synthetic validation set, no fine-tune needed — just cheaper + faster.
  // Prior history: Llama 8B was systematically over-strict; 235B fixed calibration.
  // See docs/fine-tuning-strategy.md adherence-checker slot for full context.
  "adherence-checker":         { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", temperature: 0.1, maxTokens: 256 },
  // Sub-check aliases — same model as adherence-checker, distinct agent names for tracing
  "adherence-events":          { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", temperature: 0.1, maxTokens: 256 },
  "adherence-setting":         { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", temperature: 0.1, maxTokens: 256 },
  "adherence-tangent":         { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", temperature: 0.1, maxTokens: 256 },
  "adherence-character":       { provider: "wandb", model: "OpenPipe/Qwen3-14B-Instruct", temperature: 0.1, maxTokens: 256 },

  // ── Extractors (structured extraction from prose) ─────────────────────
  "summary-extractor":         { ...mimoFlash, temperature: 0.2, maxTokens: 8192 },
  "fact-extractor":            { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "character-state":           { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "relationship-timeline":     { ...cerebrasQwen235B, temperature: 0.2, maxTokens: 8192 },
  "graph-linker":              { ...mimoFlash, temperature: 0.2, maxTokens: 4096 },

  // ── Validators (analytical checks) ────────────────────────────────────
  // continuity: decomposed into 2 parallel calls (facts + state) via check.ts.
  // Sub-check aliases — same model, distinct agent names for tracing in llm_calls.
  // On 235B for now; decomposition enables dropping to 14B (W&B) once validated.
  "continuity-facts":          { ...cerebrasQwen235B, temperature: 0.2, maxTokens: 2048 },
  "continuity-state":          { ...cerebrasQwen235B, temperature: 0.2, maxTokens: 2048 },

  // ── Lint fixer (per-sentence creative fixes via LLM) ──────────────────
  "lint-fixer":                { ...cerebrasQwen235B, temperature: 0.2 },

  // ── Chapter plan checker (structural adherence, fine-tune target) ────
  // Was on llama-3.1-8b-instant but the model couldn't reason through the planner's
  // structural requirements and kept bouncing valid prose, spinning the drafting retry
  // loop. Now on gpt-oss-120b which serves as the distillation source for the eventual
  // LoRA fine-tune.
  "chapter-plan-checker":      { provider: "groq", model: "openai/gpt-oss-120b", temperature: 0.2, maxTokens: 4096 },

  // ── Tonal pass (per-paragraph voice rewrite, LoRA fine-tuned) ────────
  "tonal-pass":                { provider: "together", model: "Qwen/Qwen3.5-9B", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5", temperature: 0.6, maxTokens: 2048 },

  // ── Judges (novel validation) ──────────────────────────────────────────
  "judge":                     { ...deepseekV3, temperature: 0.1 },
  "pairwise-judge":            { ...deepseekV3, temperature: 0.1 },

  // ── Benchmark (can tune independently from novel pipeline) ───────────
  "benchmark-writer":          { ...deepseekV3, temperature: 0.8, maxTokens: 8000 },
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

// ── DB generation config (autoresearcher-tunable temperature/maxTokens) ──

let dbGenConfigCache: Map<string, { temperature?: number; maxTokens?: number }> | null = null

/** Load all agent generation overrides from DB into cache */
export async function loadGenerationConfig(): Promise<void> {
  try {
    const db = (await import("../data/connection")).default
    const rows = await db`SELECT agent_name, temperature, max_tokens FROM agent_generation_config`
    dbGenConfigCache = new Map()
    for (const r of rows) {
      dbGenConfigCache.set(r.agent_name, {
        temperature: r.temperature ?? undefined,
        maxTokens: r.max_tokens ?? undefined,
      })
    }
  } catch {
    dbGenConfigCache = new Map() // DB not available — empty overrides
  }
}

/** Save a generation config override (for autoresearcher) */
export async function saveGenerationConfig(agentName: string, config: { temperature?: number; maxTokens?: number }): Promise<void> {
  const db = (await import("../data/connection")).default
  await db`INSERT INTO agent_generation_config (agent_name, temperature, max_tokens, updated_at)
           VALUES (${agentName}, ${config.temperature ?? null}, ${config.maxTokens ?? null}, now())
           ON CONFLICT (agent_name) DO UPDATE SET
             temperature = COALESCE(EXCLUDED.temperature, agent_generation_config.temperature),
             max_tokens = COALESCE(EXCLUDED.max_tokens, agent_generation_config.max_tokens),
             updated_at = now()`
  dbGenConfigCache = null // invalidate
}

/** Get generation config for an agent from DB cache */
export async function getGenerationConfig(agentName: string): Promise<{ temperature?: number; maxTokens?: number } | undefined> {
  if (!dbGenConfigCache) await loadGenerationConfig()
  return dbGenConfigCache?.get(agentName)
}

/** Returns the full agent config with defaults applied, including DB + runtime overrides. */
export function getAgentConfig(agentName: string): {
  provider: ProviderName; model: string
  temperature: number; maxTokens: number; thinking: boolean
} | undefined {
  const base = AGENT_MODELS[agentName]
  if (!base) return undefined
  const dbOverride = dbGenConfigCache?.get(agentName)
  const runtimeOverride = runtimeOverrides.get(agentName)
  // Priority: runtime > DB > base > defaults
  const merged = { ...base, ...dbOverride, ...runtimeOverride } as ModelAssignment
  return {
    provider: merged.provider,
    model: merged.model,
    temperature: merged.temperature ?? DEFAULTS.temperature,
    maxTokens: merged.maxTokens ?? DEFAULTS.maxTokens,
    thinking: merged.thinking ?? DEFAULTS.thinking,
  }
}
