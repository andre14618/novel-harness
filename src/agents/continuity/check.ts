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

// ── Prompts ──────────────────────────────────────────────────────────────────

const FACT_CHECK_SYSTEM = `You check whether a chapter draft CONTRADICTS any established facts.

For each fact provided, determine if the draft contains a passage that directly contradicts it. Only report contradictions — do not report facts that are simply not mentioned.

Severity guide:
- "blocker" — dead character speaking/acting, character in wrong location, impossible event, world-rule violation, knowledge violation (character acts on info they haven't learned)
- "warning" — timeline mismatch, travel-time violation, slight characterization drift, emotional discontinuity without transition
- "nit" — physical description drift (hair color, height), name/title inconsistency, object continuity (puts down cup then drinks from it)

FALSE POSITIVE rules — do NOT flag these as contradictions:
- Figurative language: "the walls closed in" is not a location change, "her heart shattered" is not a physical event
- Dramatic irony: the reader knowing something the character doesn't is not a continuity error
- Character lying or being unreliable in dialogue — an unreliable narrator's claim does not contradict a fact
- Vague timeline when no concrete timeline was established
- Metaphor, simile, or hyperbole
- Facts that are simply not relevant to this chapter

Respond with ONLY valid JSON:
{
  "contradictions": [
    { "fact": "the established fact", "severity": "blocker", "evidence": "quoted passage from draft", "reasoning": "one sentence" }
  ]
}

If no facts are contradicted, return: {"contradictions": []}`

const STATE_CHECK_SYSTEM = `You check whether a chapter draft is consistent with each character's current state (location and knowledge).

For each character state provided, check:
- LOCATION: Is the character in the right place? If the draft places them somewhere that contradicts their established location, flag it.
- KNOWLEDGE: Does the character act on information they shouldn't have yet, or fail to act on information they should have? Only flag clear violations — not every piece of knowledge needs to surface in every scene.

Only report violations — do not report characters whose state is consistent or who simply aren't mentioned.

FALSE POSITIVE rules — do NOT flag these as violations:
- Character not appearing in this chapter — that's not a location violation
- Figurative language about location: "she was miles away" (meaning distracted) is not a location error
- Character lying about where they've been or what they know — that's characterization, not a continuity error
- Knowledge that a character plausibly could have learned off-page between chapters (unless the timeline makes that impossible)

Respond with ONLY valid JSON:
{
  "violations": [
    { "character": "name", "type": "location", "evidence": "quoted passage", "reasoning": "one sentence" }
  ]
}

If no violations, return: {"violations": []}`

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
