/**
 * Hybrid lint fixer — orchestrates three fix passes:
 *
 *   1. Deterministic (free, instant): remove/replace words
 *   2. LLM per-sentence: context-aware rewrites for creative patterns
 *   3. LLM per-window: rhythm restructuring for monotonous passages
 */

import type { LintIssue, FixResult } from "./types"
import { applyDeterministicFixes } from "./fixers/deterministic"
import { applyPerSentenceFixes } from "./fixers/per-sentence"

export type { FixResult }

export async function fixLintIssues(
  prose: string,
  issues: LintIssue[],
  llmConfig?: { provider: string; model: string; temperature?: number },
): Promise<FixResult> {
  const totalStart = Date.now()
  let costUsd = 0
  let llmCalls = 0

  // Pass 1: deterministic fixes
  const det = applyDeterministicFixes(prose, issues)
  let result = det.prose

  // Pass 2: LLM per-sentence for remaining non-rhythm issues
  let llmFixes = 0
  let unfixed = 0
  const sentenceIssues = det.remaining.filter(i =>
    i.category !== "RHYTHM_MONOTONY" && i.category !== "PARAGRAPH_HOMOGENEITY"
  )
  const rhythmIssues = det.remaining.filter(i =>
    i.category === "RHYTHM_MONOTONY" || i.category === "PARAGRAPH_HOMOGENEITY"
  )

  if (sentenceIssues.length > 0 && llmConfig) {
    const sentenceResult = await applyPerSentenceFixes(result, sentenceIssues, llmConfig)
    result = sentenceResult.prose
    llmFixes += sentenceResult.fixed
    unfixed += sentenceResult.unfixed
    llmCalls += sentenceResult.llmCalls
    costUsd += sentenceResult.costUsd
  } else {
    unfixed += sentenceIssues.length
  }

  // Pass 3: rhythm rewriting — iterate until no more windows improve
  if (llmConfig && rhythmIssues.length > 0) {
    const { fixRhythm } = await import("./fixers/rhythm")
    const MAX_RHYTHM_PASSES = 3
    for (let pass = 0; pass < MAX_RHYTHM_PASSES; pass++) {
      const rhythmResult = await fixRhythm(result, {
        provider: llmConfig.provider,
        model: llmConfig.model,
        temperature: llmConfig.temperature ?? 0.4,
      }, { maxFixes: 3 })

      result = rhythmResult.prose
      llmFixes += rhythmResult.windowsFixed
      llmCalls += rhythmResult.llmCalls
      costUsd += rhythmResult.costUsd

      if (rhythmResult.windowsFixed === 0) {
        unfixed += rhythmResult.windowsSkipped
        break
      }
    }
  } else {
    unfixed += rhythmIssues.length
  }

  return {
    prose: result,
    deterministicFixes: det.fixed,
    llmFixes,
    llmCalls,
    unfixed,
    totalIssues: issues.length,
    costUsd,
    latencyMs: Date.now() - totalStart,
  }
}
