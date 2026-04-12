/**
 * Beat adherence checker — deterministic checks + single LLM call
 * (events+attribution) on the configured adherence-checker model.
 *
 * Character call merged into events after ground-truth eval (2026-04-12)
 * showed 6/8 catches redundant. Setting and tangent removed after production
 * data showed 0 tangent fires (563 calls) and setting's 4.3% fire rate
 * catches planner-level issues unfixable by the beat writer.
 * See docs/retry-surface-audit.md.
 */

import { callAgent } from "../../llm"
import { trace } from "../../trace"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { z } from "zod"

export interface AdherenceResult {
  pass: boolean
  issues: string[]
}

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

const EVENTS_SYSTEM = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

export async function checkBeatAdherence(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  // Tags so this call lands in llm_calls with the same drill-down keys
  // as the beat-writer call it's checking. Optional for backwards compat
  // (callers outside the drafting loop pass nothing → call is logged untagged).
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
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

  // Trace deterministic results
  if (tags?.novelId) {
    await trace(tags.novelId, {
      eventType: "adherence-deterministic",
      chapter: tags.chapter,
      beatIndex: tags.beatIndex,
      payload: {
        charPresence: !issues.some(i => i.includes("not found in prose")),
        wordCountOk: !issues.some(i => i.includes("Too short") || i.includes("Too long")),
        dialogueOk: !issues.some(i => i.includes("No dialogue")),
        deterministicIssues: issues.length,
      },
    })
  }

  // If deterministic checks fail hard, skip the LLM check
  if (issues.length >= 2) {
    return { pass: false, issues }
  }

  // ── LLM adherence check — single events+attribution call ──

  const proseTrimmed = prose.slice(0, 2000)
  const charsLine = beat.characters.join(", ")

  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      attempt: tags?.attempt,
      agentName: "adherence-events" as const,
      systemPrompt: EVENTS_SYSTEM,
      userPrompt: `BEAT: ${beat.description}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`,
      schema: eventsSchema,
    })
    if (!result.output.events_present) {
      issues.push(`Beat events not enacted on-page: ${result.output.reasoning || "no evidence found"}`)
    }
  } catch (err) {
    issues.push(`Adherence events check failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    pass: issues.length === 0,
    issues,
  }
}
