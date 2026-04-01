/**
 * Agent-to-model mapping.
 *
 * Change a model here and that agent picks it up on next run.
 * This is the single place to control which model every agent uses.
 */

import type { ProviderName } from "./registry"

export interface ModelAssignment {
  provider: ProviderName
  model: string
}

const groqQwen32B: ModelAssignment = { provider: "groq", model: "qwen/qwen3-32b" }

export const AGENT_MODELS: Record<string, ModelAssignment> = {
  // ── Writers (creative prose, high output) ─────────────────────────────
  "writer":                    groqQwen32B,
  "rewriter":                  groqQwen32B,

  // ── Planners (structured creative output) ─────────────────────────────
  "world-builder":             groqQwen32B,
  "character-agent":           groqQwen32B,
  "plotter":                   groqQwen32B,
  "planning-plotter":          groqQwen32B,

  // ── Extractors (structured extraction from prose) ─────────────────────
  "summary-extractor":         groqQwen32B,
  "fact-extractor":            groqQwen32B,
  "character-state":           groqQwen32B,

  // ── Validators (analytical checks) ────────────────────────────────────
  "continuity":                groqQwen32B,
  "cross-chapter-continuity":  groqQwen32B,
  "prose-quality":             groqQwen32B,
}

export function getModelForAgent(agentName: string): ModelAssignment | undefined {
  return AGENT_MODELS[agentName]
}
