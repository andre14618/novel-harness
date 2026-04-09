/**
 * Beat adherence checker — fast post-generation check that prose follows the beat spec.
 *
 * Two-pass: deterministic checks (instant) + four parallel LLM calls (events / setting /
 * tangent / character) running on the configured adherence-checker model. Returns
 * pass/fail with specific deviations for retry context.
 *
 * The 4-call shape replaces the single overloaded LLM call after exp #122 (2026-04-08)
 * showed it lifts 14B 79% → 91% and 235B 96% → 97% on the 160-pair synthetic eval —
 * see `docs/lessons-learned.md` "Per-API-call decomposition: orthogonal facets win".
 * The tangent slot is the load-bearing addition; the prior single call lacked it
 * entirely.
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

const characterSchema = z.object({
  character_contradiction: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

const EVENTS_SYSTEM = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

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

const CHARACTER_SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
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

  // ── LLM adherence check — 4 parallel calls (events / setting / tangent / character) ──
  //
  // Each slot has its own attention budget AND its own prompt tailored to one failure
  // mode. Aggregate verdict: FAIL if any slot fires. See exp #122 for the validation —
  // 14B 79% → 91%, 235B 96% → 97% on the 160-pair synthetic eval. Latency unchanged
  // vs the single-call shape (calls run in parallel via Promise.all).

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
    callAgent({
      ...baseTags,
      agentName: "adherence-character" as const,
      systemPrompt: CHARACTER_SYSTEM,
      userPrompt: `BEAT: ${beat.description}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`,
      schema: characterSchema,
    }),
  ])

  const [eventsRes, settingRes, tangentRes, characterRes] = results

  if (eventsRes.status === "fulfilled") {
    const o = eventsRes.value.output
    if (!o.events_present) {
      issues.push(`Beat events not enacted on-page: ${o.reasoning || "no evidence found"}`)
    }
  } else {
    issues.push(`Adherence events check failed: ${eventsRes.reason instanceof Error ? eventsRes.reason.message : String(eventsRes.reason)}`)
  }

  if (settingRes.status === "fulfilled") {
    const o = settingRes.value.output
    if (!o.setting_matches) {
      issues.push(`Setting mismatch — expected "${o.expected_setting || outline.setting}", got "${o.actual_setting || "unclear"}"`)
    }
  } else {
    issues.push(`Adherence setting check failed: ${settingRes.reason instanceof Error ? settingRes.reason.message : String(settingRes.reason)}`)
  }

  if (tangentRes.status === "fulfilled") {
    const o = tangentRes.value.output
    if (o.is_tangent) {
      issues.push(`Prose drifts off-spec (~${Math.round((o.off_spec_fraction ?? 0) * 100)}%): ${o.reasoning || "tangent detected"}`)
    }
  } else {
    issues.push(`Adherence tangent check failed: ${tangentRes.reason instanceof Error ? tangentRes.reason.message : String(tangentRes.reason)}`)
  }

  if (characterRes.status === "fulfilled") {
    const o = characterRes.value.output
    if (o.character_contradiction) {
      issues.push(`Character behaves contrary to role: ${o.reasoning || "contradiction detected"}`)
    }
  } else {
    issues.push(`Adherence character check failed: ${characterRes.reason instanceof Error ? characterRes.reason.message : String(characterRes.reason)}`)
  }

  return {
    pass: issues.length === 0,
    issues,
  }
}
