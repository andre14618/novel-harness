/**
 * Scene adherence checker — deterministic checks + bounded LLM calls
 * on the configured adherence-checker model.
 *
 * Two-stage LLM design (2026-05-01, exp #317):
 *   Stage 1 — binary `events_present` call (existing). Always runs.
 *   Stage 2 — per-event enumeration (new). Fires ONLY when stage 1
 *             returns `events_present=false`. Produces quote-backed
 *             missing-event detail so the writer's targeted-rewrite
 *             prompt names each absent action instead of a single
 *             approximate sentence.
 * Pass-path latency / cost is unchanged — stage 2 is gated.
 *
 * Character call merged into events after ground-truth eval (2026-04-12)
 * showed 6/8 catches redundant. Setting and tangent removed after production
 * data showed 0 tangent fires (563 calls) and setting's 4.3% fire rate
 * catches planner-level issues unfixable by the scene writer.
 * See docs/retry-surface-audit.md.
 */

import { callAgent } from "../../llm"
import { trace } from "../../trace"
import { log } from "../../logger"
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

const missingEventsSchema = z.object({
  obligated_events: z.array(z.object({
    event: z.string(),
    enacted: z.boolean(),
    evidence_quote: z.string().optional().default(""),
  })).min(1),
  reasoning: z.string().optional().default(""),
})

// v3 — 2026-05-02, exp #345 (L25): Added causal-ordering rule. A/B on 14-row L18 panel +
// 17-row labeled panel: reversed-order recall 67%→100% (fail-02 mage drain/binding caught),
// substituted-actor recall 67%→100% (bonus), two-of-three held at 67% (no regression),
// labeled panel 100%/100%, embellishment TN=100%. Positive framing only per
// feedback_priming_suppression_ab. See docs/adherence-events-v3-causal-ordering-2026-05-01.md.
// Remaining FN: two-of-three-fail-02 (candle-lighting) — model self-consistency failure,
// requires per-event extraction redesign (deferred).
const EVENTS_SYSTEM = `You verify whether the prose ENACTS the scene entry on-page.

Read the scene entry carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the scene entry's specific actions must occur.
- If the scene entry specifies multiple actions, ALL must appear in the prose. A partially enacted scene entry is not fully enacted.
- Each action must be performed by the character the scene entry assigns it to. If the scene entry says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the scene entry specifies them. Do not distinguish between major and minor events — if the scene entry names it, it must appear.
- When the scene entry sequences events with "then", "after", "before", "next", or implicit causal logic (where X is a prerequisite for Y to occur), verify that the prose enacts them in the same order. If a prerequisite action occurs after its consequence in the prose, return events_present=false even when all events are present.
- If ANY action from the scene entry is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const MISSING_EVENTS_SYSTEM = `You enumerate which obligated events from a scene entry are missing from the prose.

Step 1: Read the scene entry and identify EVERY discrete event it specifies — there are usually 1 to 4 distinct events per scene entry. An event is a single action, decision, discovery, or state-change-on-page. Compound clauses joined by "and" / ";" / commas usually contain multiple events.

Step 2: For EACH identified event, scan the prose for an on-page enactment.
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- The action must be performed by the character the scene entry assigns it to. If the scene entry says A asks B but the prose has B volunteer without A asking, the "ask" event is NOT enacted.
- Paraphrase, dialogue rewording, and atmospheric expansion are fine — judge by the underlying action, not the wording.

Step 3: For each event, return enacted: true | false and a short prose quote as evidence. If enacted is false, evidence_quote should still cite the closest passage so the reviewer can see what the prose did instead (or an empty string if nothing relevant exists in the prose).

Respond with ONLY valid JSON in this exact shape:
{
  "obligated_events": [
    { "event": "<short paraphrase of the event>", "enacted": true | false, "evidence_quote": "<short prose quote, ~10-30 words, or empty>" }
  ],
  "reasoning": "<one sentence summarizing the verdict>"
}`

export async function checkSceneAdherence(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  // Tags so this call lands in llm_calls with the same drill-down keys
  // as the scene writer call it's checking. Optional for backwards compat
  // (callers outside the drafting loop pass nothing → call is logged untagged).
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; sceneId?: string; beatId?: string; attempt?: number },
): Promise<AdherenceResult> {
  const issues: string[] = []

  // ── Deterministic checks (instant) ──────────────────────────────────

  // Character presence: every named character in the scene entry should appear in prose
  issues.push(...findMissingCharacterMentions(prose, beat, outline))

  // Word count check removed 2026-04-16: the metric was never load-bearing for
  // prose quality. Scene size is driven by the brief's dramatic function, not a
  // numeric target.
  //
  // Dialogue check also removed: false-positive rate too high for scenes where
  // silence is intentional. The events+attribution LLM call catches missing
  // dialogue when the scene entry actually requires it.

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

  // ── LLM adherence check — two-stage (binary first, per-event on FAIL) ──

  // L39 (2026-05-02, exp #363): raised from 2000 → 8000 chars after
  // discovering 52% of writer outputs exceed 2000 (heretic ch1 evidence
  // novel-1777709036403). Truncation was dropping resolution actions in
  // long action scene entries — e.g., heretic ch1 scene 4 emitted "She slid it
  // back into its slot" near char 2400, the obligated reshelve event
  // was off-screen, and adherence stage 1 + stage 2 both flagged it
  // missing. Per cross-novel sample: 8000 covers 100% of observed
  // scene entries. DeepSeek V4 Flash 32K context easily fits + prompt cache
  // dominates cost — per-call uncached prose tokens go from ~500 →
  // ~2000, marginal $.
  const proseTrimmed = prose.slice(0, 8000)
  const charsLine = beat.characters.join(", ")
  const userPrompt = `SCENE ENTRY: ${beat.description}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`

  try {
    // Stage 1: cheap binary check. Always runs.
    const stage1 = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      sceneId: tags?.sceneId ?? beat.sceneId,
      beatId: tags?.beatId ?? beat.beatId,
      attempt: tags?.attempt,
      agentName: "adherence-events" as const,
      systemPrompt: EVENTS_SYSTEM,
      userPrompt,
      schema: eventsSchema,
    })
    if (!stage1.output.events_present) {
      // Stage 2: per-event enumeration. Fires ONLY on stage-1 fail so
      // pass-path latency / cost is unchanged. Output is rendered as
      // multi-line per-event detail so the writer's targeted-rewrite
      // prompt names each missing action with quote evidence instead
      // of a single approximate sentence (exp #305 demonstrated this on
      // the b12 partial-enactment cluster).
      //
      // L31c (2026-05-02, exp #346): when stage 2 reports ALL events as
      // enacted, override the stage-1 fail and accept the scene. Stage 2
      // is more authoritative — it provides per-event quote evidence.
      // The override is traced for audit.
      const stage2Result = await enumerateMissingEvents({
        userPrompt,
        fallbackReasoning: stage1.output.reasoning,
        tags: { ...tags, sceneId: tags?.sceneId ?? beat.sceneId, beatId: tags?.beatId ?? beat.beatId },
      })
      if (stage2Result.stage2Override) {
        // Unanimous stage-2 enactment overrides stage-1 fail.
        if (tags?.novelId) {
          await trace(tags.novelId, {
            eventType: "adherence-stage2-override",
            chapter: tags.chapter,
            beatIndex: tags.beatIndex,
            payload: {
              attempt: tags.attempt,
              stage1Reasoning: stage1.output.reasoning || "",
              stage2Override: true,
            },
          })
        }
        log(
          tags?.novelId ?? "",
          "info",
          `Scene ${(tags?.beatIndex ?? 0) + 1} adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed`,
        )
      } else {
        issues.push(...stage2Result.issues)
      }
    }
  } catch (err) {
    issues.push(`Adherence events check failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    pass: issues.length === 0,
    issues,
  }
}

/**
 * Stage 2 of the two-stage adherence design — per-event enumeration.
 *
 * Returns an object with:
 *   - `issues`: per-missing-event strings for the writer's retry prompt
 *   - `stage2Override`: true when stage 2 reports ALL events as enacted,
 *     overriding the stage-1 fail verdict (L31c, 2026-05-02, exp #346)
 *
 * Override semantics: stage 2 is more authoritative than stage 1 because
 * it does per-event verification with quote evidence. When stage 2 finds
 * ALL events enacted, the stage-1 `events_present=false` is treated as a
 * stochastic false negative (temperature self-inconsistency on implicit-
 * action edge cases, e.g. "filling out a complaint form = deciding to
 * report"). The scene is accepted; the override is traced for audit.
 *
 * On any failure (transport / schema error), falls back to the original
 * generic single-line message so the retry loop never silently loses the
 * stage-1 verdict.
 */
async function enumerateMissingEvents(input: {
  userPrompt: string
  // `reasoning` is z.string().optional().default("") — runtime is always a
  // string, but Zod's inferred type stays `string | undefined` (a known
  // quirk of optional+default), so widen the param type to match.
  fallbackReasoning: string | undefined
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; sceneId?: string; beatId?: string; attempt?: number }
}): Promise<{ issues: string[]; stage2Override: boolean }> {
  const { userPrompt, fallbackReasoning, tags } = input
  const fallback = `Scene events not enacted on-page: ${fallbackReasoning || "no evidence found"}`
  try {
    const stage2 = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      sceneId: tags?.sceneId,
      beatId: tags?.beatId,
      attempt: tags?.attempt,
      agentName: "adherence-events" as const,
      systemPrompt: MISSING_EVENTS_SYSTEM,
      userPrompt,
      schema: missingEventsSchema,
    })
    if (stage2.output.obligated_events.length === 0) {
      return { issues: [fallback], stage2Override: false }
    }
    const missing = stage2.output.obligated_events.filter(e => !e.enacted)
    if (missing.length === 0) {
      // Stage 2 found ALL events enacted — override the stage-1 fail.
      // L31c (exp #346): unanimous stage-2 enactment is more authoritative
      // than stage-1's binary verdict because stage 2 provides per-event
      // quote evidence. Return an empty issues list plus the override flag
      // so the caller can trace the decision for audit.
      return { issues: [], stage2Override: true }
    }
    return {
      issues: missing.map(e => {
        const quote = e.evidence_quote?.trim() ?? ""
        return quote
          ? `Scene event missing: ${e.event} — closest prose: "${quote}"`
          : `Scene event missing: ${e.event}`
      }),
      stage2Override: false,
    }
  } catch {
    return { issues: [fallback], stage2Override: false }
  }
}

export const checkBeatAdherence = checkSceneAdherence

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
