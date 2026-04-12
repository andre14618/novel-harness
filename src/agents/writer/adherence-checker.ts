/**
 * Beat adherence checker — deterministic checks + three parallel LLM calls
 * (events+attribution / setting / tangent). Character call merged into events
 * after ground-truth eval (2026-04-12) showed 6/8 catches redundant.
 * Setting and tangent are soft gates (log, don't retry) — only events triggers retry.
 * See docs/retry-surface-audit.md for the full tightening plan.
 */

import { callAgent } from "../../llm"
import { trace } from "../../trace"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { z } from "zod"

export interface AdherenceResult {
  pass: boolean
  issues: string[]
  warnings: string[]
}

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

const settingSchema = z.object({
  setting_matches: z.boolean(),
  expected_setting: z.string().optional().default(""),
  actual_setting: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

const tangentSchema = z.object({
  off_spec_fraction: z.number().optional().default(0),
  off_spec_quote: z.string().optional().default(""),
  is_tangent: z.boolean(),
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

const SETTING_SYSTEM = `You verify whether the prose CONTRADICTS the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). This beat may be one of several in a chapter — the prose often inherits setting from earlier beats and does NOT re-establish it. That is normal craft and not a mismatch.

ONLY flag setting_matches=false when the prose places the scene in a CLEARLY DIFFERENT setting than expected. Examples of real contradictions:
- Different named location (tavern vs castle, kitchen vs garden)
- Different building or room when the beat names a specific one
- Outdoors vs indoors when the beat is explicit about which
- Different time of day when the beat is explicit (dawn vs midnight)
- Different city, region, or world

If the prose simply doesn't mention setting markers — it's continuing a scene from a prior beat, focused on dialogue, character interiority, or close action — return setting_matches=true. Absence of setting markers is NOT a mismatch. Only POSITIVE evidence of a different setting counts.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose establishes, or 'inherited from prior beat' if not re-established>",
  "reasoning": "<one sentence>"
}`

const TANGENT_SYSTEM = `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action
- Brief flashes of backstory the beat itself implies
- Dialogue that develops the beat's situation, even if it briefly digresses
- Pacing variation, internal monologue, descriptive flourishes

The threshold for is_tangent=true is HIGH: more than ~60% of the prose must be doing something completely unrelated to the beat. If the beat is happening anywhere in the prose — even surrounded by atmospheric and interior detail — is_tangent=false.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Only quote a passage if you are flagging is_tangent=true.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
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
    return { pass: false, issues, warnings: [] }
  }

  // ── LLM adherence check — 3 parallel calls (events+attribution / setting / tangent) ──

  const proseTrimmed = prose.slice(0, 2000)
  const charsLine = beat.characters.join(", ")

  const baseTags = {
    novelId: tags?.novelId,
    chapter: tags?.chapter,
    beatIndex: tags?.beatIndex,
    attempt: tags?.attempt,
  }

  const results = await Promise.allSettled([
    callAgent({
      ...baseTags,
      agentName: "adherence-events" as const,
      systemPrompt: EVENTS_SYSTEM,
      userPrompt: `BEAT: ${beat.description}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`,
      schema: eventsSchema,
    }),
    callAgent({
      ...baseTags,
      agentName: "adherence-setting" as const,
      systemPrompt: SETTING_SYSTEM,
      userPrompt: `BEAT: ${beat.description}
EXPECTED SETTING: ${outline.setting}

PROSE:
---
${proseTrimmed}
---`,
      schema: settingSchema,
    }),
    callAgent({
      ...baseTags,
      agentName: "adherence-tangent" as const,
      systemPrompt: TANGENT_SYSTEM,
      userPrompt: `BEAT: ${beat.description}

PROSE:
---
${proseTrimmed}
---`,
      schema: tangentSchema,
    }),
  ])

  const [eventsRes, settingRes, tangentRes] = results
  const warnings: string[] = []

  // Events+attribution — HARD gate (triggers retry)
  if (eventsRes.status === "fulfilled") {
    const o = eventsRes.value.output
    if (!o.events_present) {
      issues.push(`Beat events not enacted on-page: ${o.reasoning || "no evidence found"}`)
    }
  } else {
    issues.push(`Adherence events check failed: ${eventsRes.reason instanceof Error ? eventsRes.reason.message : String(eventsRes.reason)}`)
  }

  // Setting — SOFT gate (log for monitoring, don't trigger retry)
  if (settingRes.status === "fulfilled") {
    const o = settingRes.value.output
    if (!o.setting_matches) {
      warnings.push(`Setting mismatch — expected "${o.expected_setting || outline.setting}", got "${o.actual_setting || "unclear"}"`)
    }
  } else {
    warnings.push(`Adherence setting check failed: ${settingRes.reason instanceof Error ? settingRes.reason.message : String(settingRes.reason)}`)
  }

  // Tangent — SOFT gate unless severe drift (>70% off-spec)
  if (tangentRes.status === "fulfilled") {
    const o = tangentRes.value.output
    if (o.is_tangent) {
      const fraction = o.off_spec_fraction ?? 0
      const msg = `Prose drifts off-spec (~${Math.round(fraction * 100)}%): ${o.reasoning || "tangent detected"}`
      if (fraction > 0.7) {
        issues.push(msg)
      } else {
        warnings.push(msg)
      }
    }
  } else {
    warnings.push(`Adherence tangent check failed: ${tangentRes.reason instanceof Error ? tangentRes.reason.message : String(tangentRes.reason)}`)
  }

  return {
    pass: issues.length === 0,
    issues,
    warnings,
  }
}
