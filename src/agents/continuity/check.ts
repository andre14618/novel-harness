/**
 * Continuity checker — decomposed into 2 parallel calls (facts + character state).
 *
 * Each call gets the chapter draft + its own slice of context (facts or character
 * states) and a focused prompt. Results are merged deterministically into
 * ContinuityIssue[]. Same pattern as the adherence-checker 4-call decomposition
 * (exp #122) — independent dimensions, parallel execution, deterministic merge.
 *
 * Replaces the single overloaded continuity call which asked one 14B model to
 * juggle fact-checking, state-checking, figurative disambiguation, and issue
 * derivation in a single generation.
 */

import { callAgent } from "../../llm"
import { z } from "zod"
import type { Fact, CharacterState, ContinuityIssue } from "../../types"

// ── Schemas ──────────────────────────────────────────────────────────────────

const factCheckSchema = z.object({
  contradictions: z.array(z.object({
    fact: z.string(),
    severity: z.enum(["blocker", "warning", "nit"]),
    evidence: z.string(),
    reasoning: z.string(),
  })).default([]),
})

const stateCheckSchema = z.object({
  violations: z.array(z.object({
    character: z.string(),
    type: z.enum(["location", "knowledge"]),
    evidence: z.string(),
    reasoning: z.string(),
  })).default([]),
})

// ── Prompts (loaded from .md files for readability) ─────────────────────────

const FACT_CHECK_SYSTEM = await Bun.file(new URL("fact-check-system.md", import.meta.url).pathname).text()
const STATE_CHECK_SYSTEM = await Bun.file(new URL("state-check-system.md", import.meta.url).pathname).text()

// ── Main function ────────────────────────────────────────────────────────────

export interface ContinuityResult {
  issues: ContinuityIssue[]
}

export async function checkContinuity(
  draft: string,
  facts: Fact[],
  charStates: CharacterState[],
  tags?: { novelId?: string; chapter?: number; attempt?: number },
): Promise<ContinuityResult> {

  // Build user prompts — each call gets the draft + its own context slice
  const factUserPrompt = buildFactUserPrompt(draft, facts)
  const stateUserPrompt = buildStateUserPrompt(draft, charStates)

  const baseTags = {
    novelId: tags?.novelId,
    chapter: tags?.chapter,
    attempt: tags?.attempt,
  }

  // ── 2 parallel calls ───────────────────────────────────────────────────
  const [factResult, stateResult] = await Promise.allSettled([
    callAgent({
      ...baseTags,
      agentName: "continuity-facts" as const,
      systemPrompt: FACT_CHECK_SYSTEM,
      userPrompt: factUserPrompt,
      schema: factCheckSchema,
    }),
    callAgent({
      ...baseTags,
      agentName: "continuity-state" as const,
      systemPrompt: STATE_CHECK_SYSTEM,
      userPrompt: stateUserPrompt,
      schema: stateCheckSchema,
    }),
  ])

  // ── Deterministic merge ────────────────────────────────────────────────
  const issues: ContinuityIssue[] = []

  if (factResult.status === "fulfilled") {
    for (const c of factResult.value.output.contradictions ?? []) {
      issues.push({
        severity: c.severity,
        description: c.reasoning,
        conflictsWith: c.fact,
        suggestedFix: undefined,
      })
    }
  } else {
    // Treat call failure as a blocker so it surfaces visibly
    issues.push({
      severity: "blocker",
      description: `Fact-check call failed: ${factResult.reason instanceof Error ? factResult.reason.message : String(factResult.reason)}`,
      conflictsWith: undefined,
      suggestedFix: undefined,
    })
  }

  if (stateResult.status === "fulfilled") {
    for (const v of stateResult.value.output.violations ?? []) {
      issues.push({
        severity: "blocker",
        description: `${v.character} ${v.type} violation: ${v.reasoning}`,
        conflictsWith: v.evidence,
        suggestedFix: undefined,
      })
    }
  } else {
    issues.push({
      severity: "blocker",
      description: `State-check call failed: ${stateResult.reason instanceof Error ? stateResult.reason.message : String(stateResult.reason)}`,
      conflictsWith: undefined,
      suggestedFix: undefined,
    })
  }

  return { issues }
}

// ── User prompt builders ─────────────────────────────────────────────────────

function buildFactUserPrompt(draft: string, facts: Fact[]): string {
  let prompt = `CHAPTER DRAFT:\n${draft}\n\n`
  if (facts.length > 0) {
    prompt += `ESTABLISHED FACTS:\n${facts.map(f => `- [ch${f.establishedInChapter}] [${f.category}] ${f.fact}`).join("\n")}\n`
  } else {
    prompt += `ESTABLISHED FACTS:\n(none)\n`
  }
  return prompt
}

function buildStateUserPrompt(draft: string, charStates: CharacterState[]): string {
  let prompt = `CHAPTER DRAFT:\n${draft}\n\n`
  if (charStates.length > 0) {
    prompt += `CHARACTER STATES (as of previous chapter):\n${charStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")}\n`
  } else {
    prompt += `CHARACTER STATES:\n(none)\n`
  }
  return prompt
}
