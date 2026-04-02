/**
 * Guardrails for autonomous improvement.
 *
 * Validates that proposed changes are safe before applying them.
 * Rejects changes to infrastructure, code, or out-of-scope files.
 */

import { readFileSync } from "node:fs"
import { MODELS } from "../../models/registry"

// ── File scope ──────────────────────────────────────────────────────────

const ALLOWED_PATTERNS = [
  /^src\/agents\/[^/]+\/prompt\.md$/,
  /^src\/agents\/[^/]+\/config\.ts$/,
  /^models\/roles\.ts$/,
]

export function isAllowedFile(filePath: string): boolean {
  return ALLOWED_PATTERNS.some(p => p.test(filePath))
}

// ── Prompt validation ───────────────────────────────────────────────────

export function validatePrompt(
  newContent: string,
  originalContent: string,
): { valid: boolean; reason?: string } {
  if (!newContent || newContent.trim().length === 0) {
    return { valid: false, reason: "Empty prompt" }
  }
  if (newContent.trim().length < 100) {
    return { valid: false, reason: `Prompt too short (${newContent.trim().length} chars, min 100)` }
  }

  // Diff size check: reject if >50% of lines changed
  const originalLines = originalContent.split("\n")
  const newLines = newContent.split("\n")
  const maxLines = Math.max(originalLines.length, newLines.length)
  if (maxLines === 0) return { valid: true }

  let changedLines = 0
  for (let i = 0; i < maxLines; i++) {
    if ((originalLines[i] ?? "") !== (newLines[i] ?? "")) changedLines++
  }
  const changeRatio = changedLines / maxLines
  if (changeRatio > 0.5) {
    return { valid: false, reason: `Too many lines changed (${Math.round(changeRatio * 100)}%, max 50%)` }
  }

  return { valid: true }
}

// ── Config validation ───────────────────────────────────────────────────

export function validateTemperature(value: number): { valid: boolean; clamped: number } {
  const clamped = Math.max(0.1, Math.min(1.0, value))
  return { valid: value >= 0.1 && value <= 1.0, clamped }
}

export function validateMaxTokens(value: number): { valid: boolean; clamped: number } {
  const clamped = Math.max(2048, Math.min(32768, value))
  return { valid: value >= 2048 && value <= 32768, clamped }
}

export function validateModelSwap(modelId: string, provider: string): { valid: boolean; reason?: string } {
  const model = MODELS.find(m => m.id === modelId && m.provider === provider)
  if (!model) {
    return { valid: false, reason: `Model ${modelId} (${provider}) not in registry` }
  }

  // Check API key is available
  try {
    const key = process.env[model.provider === "groq" ? "GROQ_API_KEY"
      : model.provider === "cerebras" ? "CEREBRAS_API_KEY"
      : model.provider === "openai" ? "OPENAI_API_KEY"
      : model.provider === "deepseek" ? "DEEPSEEK_API_KEY"
      : model.provider === "openrouter" ? "OPENROUTER_API_KEY"
      : ""]
    if (!key) return { valid: false, reason: `No API key for provider ${model.provider}` }
  } catch {
    return { valid: false, reason: `Cannot resolve API key for ${model.provider}` }
  }

  return { valid: true }
}

// ── Full proposal validation ────────────────────────────────────────────

export interface Proposal {
  agentName: string
  filePath: string
  newContent: string
  explanation: string
}

export function validateProposal(proposal: Proposal, harnessRoot: string): { valid: boolean; reason?: string } {
  if (!isAllowedFile(proposal.filePath)) {
    return { valid: false, reason: `File not in allowed scope: ${proposal.filePath}` }
  }

  // For prompt files, validate content
  if (proposal.filePath.endsWith(".md")) {
    try {
      const original = readFileSync(`${harnessRoot}/${proposal.filePath}`, "utf-8")
      return validatePrompt(proposal.newContent, original)
    } catch {
      return { valid: false, reason: `Cannot read original file: ${proposal.filePath}` }
    }
  }

  return { valid: true }
}
