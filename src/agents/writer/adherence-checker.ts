/**
 * Beat adherence checker — fast post-generation check that prose follows the beat spec.
 *
 * Two-pass: deterministic checks (instant) + Llama 8B LLM check (~50ms).
 * Returns pass/fail with specific deviations for retry context.
 */

import { callAgent } from "../../llm"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { z } from "zod"

export interface AdherenceResult {
  pass: boolean
  issues: string[]
}

const adherenceSchema = z.object({
  pass: z.boolean(),
  deviations: z.array(z.string()),
})

export async function checkBeatAdherence(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
): Promise<AdherenceResult> {
  const issues: string[] = []

  // ── Deterministic checks (instant) ──────────────────────────────────

  // Character presence: every named character in beat should appear in prose
  const proseLower = prose.toLowerCase()
  for (const charName of beat.characters) {
    const nameLower = charName.toLowerCase()
    // Check for first name or full name
    const firstName = nameLower.split(" ")[0]
    if (!proseLower.includes(firstName)) {
      issues.push(`Character "${charName}" not found in prose`)
    }
  }

  // Word count: should be within 40-200% of target
  const wordCount = prose.split(/\s+/).filter(Boolean).length
  const targetWords = Math.round(outline.targetWords / Math.max(outline.scenes.length, 1))
  if (wordCount < targetWords * 0.4) {
    issues.push(`Too short: ${wordCount}w vs ${targetWords}w target (${Math.round(wordCount / targetWords * 100)}%)`)
  }
  if (wordCount > targetWords * 2.5) {
    issues.push(`Too long: ${wordCount}w vs ${targetWords}w target (${Math.round(wordCount / targetWords * 100)}%)`)
  }

  // Dialogue check: 2+ characters should have dialogue
  if (beat.characters.length >= 2) {
    const hasDialogue = /['"][^'"]{5,}['"]/.test(prose) || /[''"][^''""]{5,}[''"]/.test(prose)
    if (!hasDialogue) {
      issues.push("No dialogue found but beat has 2+ characters")
    }
  }

  // If deterministic checks fail hard, skip the LLM check
  if (issues.length >= 2) {
    return { pass: false, issues }
  }

  // ── LLM adherence check (~50ms on Groq) ─────────────────────────────

  try {
    const result = await callAgent({
      agentName: "adherence-checker",
      systemPrompt: "You check if prose follows a scene beat specification. Be strict but fair.",
      userPrompt: `Beat: "${beat.description}"
Setting: "${outline.setting}"
Characters expected: ${beat.characters.join(", ")}

Prose:
---
${prose.slice(0, 2000)}
---

Did the prose execute the beat? Check:
1. Do the described events happen in the prose?
2. Is it set in the right place?
3. Do characters behave consistently with their roles?

Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }
Return pass:true with empty deviations if the beat is executed well.`,
      schema: adherenceSchema,
    })

    if (!result.output.pass) {
      issues.push(...result.output.deviations)
    }
  } catch {
    // LLM check failed — don't block on it
  }

  return {
    pass: issues.length === 0,
    issues,
  }
}
