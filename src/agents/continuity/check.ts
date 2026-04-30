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
import type { Fact, CharacterState, ChapterOutline, ContinuityIssue } from "../../types"

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
    severity: z.enum(["blocker", "warning", "nit"]).optional(),
    evidence: z.string(),
    reasoning: z.string(),
  })).default([]),
})

type StateViolation = z.infer<typeof stateCheckSchema>["violations"][number]

// ── Prompts (loaded from .md files for readability) ─────────────────────────

const FACT_CHECK_SYSTEM = await Bun.file(new URL("fact-check-system.md", import.meta.url).pathname).text()
const STATE_CHECK_SYSTEM = await Bun.file(new URL("state-check-system.md", import.meta.url).pathname).text()

// ── Main function ────────────────────────────────────────────────────────────

export interface ContinuityResult {
  issues: ContinuityIssue[]
}

export interface ContinuityOptions {
  novelId?: string
  chapter?: number
  attempt?: number
  outline?: ChapterOutline
}

export async function checkContinuity(
  draft: string,
  facts: Fact[],
  charStates: CharacterState[],
  options?: ContinuityOptions,
): Promise<ContinuityResult> {

  // Build user prompts — each call gets the draft + its own context slice
  const factUserPrompt = buildFactUserPrompt(draft, facts)
  const stateUserPrompt = buildStateUserPrompt(draft, charStates, options?.outline)

  const baseTags = {
    novelId: options?.novelId,
    chapter: options?.chapter,
    attempt: options?.attempt,
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
      issues.push(stateViolationToIssue(v))
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

export function buildStateUserPrompt(draft: string, charStates: CharacterState[], outline?: ChapterOutline): string {
  let prompt = `CHAPTER DRAFT:\n${draft}\n\n`
  if (outline) {
    prompt += `CURRENT CHAPTER PLAN (expected movements and end-state changes):\n`
    prompt += `Chapter ${outline.chapterNumber}: "${outline.title}"\n`
    prompt += `Setting: ${outline.setting}\n`
    prompt += `Characters present: ${outline.charactersPresent.join(", ")}\n`
    if (outline.scenes.length > 0) {
      prompt += `Planned beats:\n${outline.scenes.map((s, i) => `  ${i + 1}. ${s.description} [characters: ${s.characters.join(", ")}]`).join("\n")}\n`
    }
    if (outline.characterStateChanges.length > 0) {
      prompt += `Planned end-of-chapter states:\n${outline.characterStateChanges.map(cs =>
        `  ${cs.name}: location=${cs.location}, knows=${cs.knows.join("; ") || "(none)"}`
      ).join("\n")}\n`
    }
    prompt += `\n`
  }
  if (charStates.length > 0) {
    prompt += `CHARACTER STATES (as of previous chapter; starting context, not an immovable location requirement):\n${charStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")}\n`
  } else {
    prompt += `CHARACTER STATES:\n(none)\n`
  }
  return prompt
}

export function stateViolationToIssue(v: StateViolation): ContinuityIssue {
  // Previous-chapter locations are starting-state hints. A later chapter can move
  // characters off-page or through planned scene transitions, so keep location
  // concerns visible without letting them halt the run as checker blockers.
  const severity = v.type === "location" ? (v.severity === "nit" ? "nit" : "warning") : (v.severity ?? "blocker")
  return {
    severity,
    description: `${v.character} ${v.type} violation: ${v.reasoning}`,
    conflictsWith: v.evidence,
    suggestedFix: undefined,
  }
}
