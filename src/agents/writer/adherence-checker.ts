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
  issues.push(...findMissingCharacterMentions(prose, beat, outline))

  // Word count check removed 2026-04-16: the metric was never load-bearing for
  // prose quality. Beat size is driven by the brief's dramatic function, not a
  // numeric target.
  //
  // Dialogue check also removed: false-positive rate too high for scenes where
  // silence is intentional. The events+attribution LLM call catches missing
  // dialogue when the beat actually requires it.

  // Trace deterministic results
  if (tags?.novelId) {
    await trace(tags.novelId, {
      eventType: "adherence-deterministic",
      chapter: tags.chapter,
      beatIndex: tags.beatIndex,
      payload: {
        charPresence: !issues.some(i => i.includes("not found in prose")),
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

export function findMissingCharacterMentions(prose: string, beat: SceneBeat, outline: ChapterOutline): string[] {
  const issues: string[] = []
  for (const charName of beat.characters) {
    if (isSameCharacterName(charName, outline.povCharacter)) continue
    if (!characterMentionedInProse(charName, prose)) {
      issues.push(`Character "${charName}" not found in prose`)
    }
  }
  return issues
}

export function characterMentionedInProse(charName: string, prose: string): boolean {
  const normalizedName = normalizeForMention(charName)
  const normalizedProse = normalizeForMention(prose)
  const parts = normalizedName.split(/\s+/).filter(Boolean)
  const first = parts[0]
  const last = parts.at(-1)

  const candidates = new Set<string>()
  if (normalizedName.length > 1) candidates.add(normalizedName)

  const possessiveOwner = first?.match(/^(.+)'s$/)?.[1]
  if (possessiveOwner && last && last !== possessiveOwner) {
    // Relationship labels like "Wren's grandmother" are satisfied by the
    // relationship noun or full phrase, not by merely mentioning Wren.
    candidates.add(last)
  } else {
    if (first && !TITLE_WORDS.has(first)) candidates.add(first)
    if (last) candidates.add(last)
  }

  for (const candidate of candidates) {
    if (candidate.includes(" ")) {
      if (normalizedProse.includes(candidate)) return true
    } else if (wordLikeInText(candidate, normalizedProse)) {
      return true
    }
  }
  return false
}

function normalizeForMention(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
}

function wordLikeInText(needle: string, haystack: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack)
}

const TITLE_WORDS = new Set([
  "captain", "commander", "doctor", "dr", "father", "general", "king", "lady", "lord", "master", "mistress",
  "prince", "princess", "queen", "sergeant", "sir",
])

function isSameCharacterName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return normalizeForMention(a) === normalizeForMention(b)
}
