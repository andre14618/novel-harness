import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { patchLLMCallNerPrepass } from "../../db/ops"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { buildContext, buildCharacterRoster, buildOutlineEntityList, deriveTitleNouns } from "./context"
import {
  hallucUngroundedSchema,
  type HallucUngroundedOutput,
  type HallucUngroundedResult,
  type NerFinding,
} from "./schema"
import { deriveBeatEntities, extractProperNouns } from "../../phases/beat-entity-list"
import {
  extractEntityCandidates,
  normalizeForGroundedMatch,
  deriveInitials,
  type EntityCandidate,
} from "../../lint/entity-candidates"

export { buildContext, buildCharacterRoster, buildOutlineEntityList, deriveTitleNouns, hallucUngroundedSchema }
export type { HallucUngroundedOutput, HallucUngroundedResult, NerFinding }

// Load the bounded checker prompt from disk so rubric updates don't require a
// TS recompile.
export const HALLUC_UNGROUNDED_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "halluc-ungrounded-system.md"),
  "utf-8",
)

/** Parses the BEAT_ENTITY_LIST_VARIANT env into a canonical variant tag.
 *  The checker-side is active for v1 and v3; v2 is writer-only.
 *
 *  **Default: v1** (promoted 2026-04-20 after exp #254 — charter ladder
 *  found V1 drops the ungrounded fire rate by 16 pts vs V0 on fantasy-debt,
 *  clears all 5 gates: magnitude (−16), adherence (0±0), degenerate (0%),
 *  Class-B (17%), precision (87.5%). See docs/decisions.md. Set
 *  `BEAT_ENTITY_LIST_VARIANT=v0` to opt out for regression testing.
 */
function resolveVariant(): "v0" | "v1" | "v2" | "v3" | "v4" {
  const raw = (process.env.BEAT_ENTITY_LIST_VARIANT ?? "v1").toLowerCase()
  if (raw === "v0" || raw === "v1" || raw === "v2" || raw === "v3" || raw === "v4") return raw
  return "v1"
}

// ── NER prepass helpers ───────────────────────────────────────────────────────

/**
 * Build a normalized grounded-surface set from all the evidence sources that
 * the checker has access to. Used by the NER prepass to decide whether a
 * candidate phrase is already grounded (and should not fire).
 *
 * Mirrors the logic in `scripts/hallucination/ner-vs-llm-calibration.ts`
 * `buildGroundedSurface` + `isGrounded`, but operates directly on the runtime
 * components rather than on a serialized JSONL row. Both the lowercase-exact
 * tier and the normalized (possessive/plural/article-stripped) tier are built
 * so `isNerGrounded` can apply the same four-tier check the calibration loop
 * validated.
 */
function buildNerGroundedSet(components: {
  bibleNames: string[]
  beatCharacters: string[]
  fromBrief: string[]
  derivedOutlineFact: string[]
  derivedPriorBeat: string[]
  allowedNewEntities: string[]
  povCharacter: string | undefined
  /** Novel-spanning character roster from character-agent outputs (L20). */
  characterRoster?: string[]
  /** Planner-emitted named entities from chapter outline text (L20). */
  outlineEntities?: string[]
  /** Character-profile derived title nouns (L23b). */
  derivedTitles?: string[]
}): { lower: Set<string>; normalized: Set<string> } {
  const lower = new Set<string>()
  const normalized = new Set<string>()

  const allSources: string[] = [
    ...components.bibleNames,
    ...components.beatCharacters,
    ...components.fromBrief,
    ...components.derivedOutlineFact,
    ...components.derivedPriorBeat,
    ...components.allowedNewEntities,
    ...(components.povCharacter ? [components.povCharacter] : []),
    ...(components.characterRoster ?? []),
    ...(components.outlineEntities ?? []),
    ...(components.derivedTitles ?? []),
  ]

  for (const raw of allSources) {
    if (typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue

    // Add the whole-phrase forms.
    const lo = trimmed.toLowerCase()
    lower.add(lo)
    const norm = normalizeForGroundedMatch(trimmed)
    if (norm.length > 0) normalized.add(norm)

    // Also add per-token shards (handles embedded newlines, compound entries).
    const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
    for (const t of tokens) {
      const cleaned = t.replace(/[''](s|S)?$/, "").toLowerCase()
      if (cleaned.length > 0) lower.add(cleaned)
      const normT = normalizeForGroundedMatch(t)
      if (normT.length > 0) normalized.add(normT)
    }
  }

  // L23a: Derive abbreviated initials from character roster entries.
  // This allows "T.C." in prose to be grounded when "Taryn Coombs" is in
  // the character roster. deriveInitials produces all 2- and 3-initial forms;
  // we add them in lowercase (initials are case-insensitive in grounding).
  const rosterEntries = [
    ...(components.characterRoster ?? []),
    ...components.beatCharacters,
    ...(components.povCharacter ? [components.povCharacter] : []),
  ]
  for (const name of rosterEntries) {
    if (typeof name !== "string") continue
    const derived = deriveInitials(name.trim())
    for (const init of derived) {
      lower.add(init.toLowerCase())
      // No normalized form needed — initials don't have plural/possessive
      // variants that normalizeForGroundedMatch handles. Exact lowercase match
      // is sufficient for the `isNerGrounded` tier-1 check.
    }
  }

  return { lower, normalized }
}

/**
 * Four-tier grounding check for a NER candidate phrase.
 *
 * Tiers (in order):
 *   1. Exact lowercase match against `surface.lower`.
 *   2. Substring: any surface.lower entry contains the candidate.
 *   3. Normalized exact: normalizeForGroundedMatch(candidate) ∈ surface.normalized.
 *   4. Normalized substring: any surface.normalized entry contains the normalized candidate.
 *
 * Returns `true` (grounded) when any tier matches.
 */
function isNerGrounded(
  candidatePhrase: string,
  surface: { lower: Set<string>; normalized: Set<string> },
): boolean {
  const c = candidatePhrase.toLowerCase().trim()
  if (c.length === 0) return true
  // 1. exact lowercase
  if (surface.lower.has(c)) return true
  // 2. lowercase substring
  for (const s of surface.lower) {
    if (s.length >= c.length && s.includes(c)) return true
  }
  // 3. normalized exact
  const normC = normalizeForGroundedMatch(candidatePhrase)
  if (normC.length > 0 && surface.normalized.has(normC)) return true
  // 4. normalized substring
  if (normC.length > 0) {
    for (const s of surface.normalized) {
      if (s.length >= normC.length && s.includes(normC)) return true
    }
  }
  return false
}

/**
 * Run the deterministic NER prepass over `prose`.
 *
 * Returns the list of entity candidates that are NOT grounded against the
 * evidence surface. Empty array = prepass passes (no ungrounded candidates
 * detected by NER). Non-empty array = prepass fires; the AND-gate decides
 * whether this becomes a blocker or warning.
 *
 * L23a: Applies the `capitalized-first-only` safe-fallback gate here (not
 * inside `extractEntityCandidates` which is a pure function). A
 * `capitalized-first-only` candidate is suppressed (not returned as
 * ungrounded) when its first word is NOT in the BIBLE-only token set
 * (worldBible.systems + locations + cultures). This prevents sentence-initial
 * FPs from character names: "Kael walked" should NOT fire even though "Kael"
 * is in the full grounded set — "Kael" is a character name, not a bible
 * concept. "Aether waste" fires ONLY when "Aether" appears in a world-bible
 * systems/locations/cultures entry, because that is the usage pattern we are
 * trying to detect (a derived domain compound of a known system/concept).
 *
 * `bibleTokens` (optional): a Set<string> of lowercase first-word tokens
 * derived ONLY from worldBible.systems + .locations + .cultures name fields.
 * Callers that do not provide it get the pre-L23a behavior (no cap-first-only
 * candidates emitted — safe fallback to 0 FP risk when context is unavailable).
 *
 * Note: `initials` candidates that ARE grounded (e.g. "T.C." matching
 * derived initials from character_roster) are suppressed by the standard
 * `isNerGrounded` check, same as all other classes.
 */
/**
 * Common English prepositions, conjunctions, and function words that
 * commonly follow a capitalized proper noun in normal prose but are NOT
 * domain-term second words. Used to suppress FP cap-first-only candidates
 * like "Thornwall before" or "Aether into" where a world-bible name is
 * followed by a preposition.
 *
 * Curated to cover ≥4-char words (shorter ones are already filtered by the
 * `[a-z]{4,}` second-word constraint in `capitalizedFirstOnlyRegex`).
 */
const CAP_FIRST_ONLY_STOP_WORDS: ReadonlySet<string> = new Set([
  "before", "after", "since", "while", "above", "below", "under", "until",
  "where", "which", "whose", "when", "what", "whom", "that", "this", "then",
  "than", "thus", "also", "even", "only", "back", "down", "away", "into",
  "onto", "upon", "over", "from", "with", "through", "along", "among",
  "between", "during", "against", "toward", "within", "without", "across",
  "behind", "beside", "beyond", "inside", "outside", "around", "about",
  "near", "next", "like", "just", "both", "each", "many", "some", "more",
  "most", "much", "very", "been", "were", "have", "will", "would", "could",
  "should", "might", "must", "shall", "said", "told", "knew", "made", "gave",
  "took", "came", "went", "kept", "left", "sent", "held", "knew", "came",
])

export function runNerPrepass(
  prose: string,
  groundedSurface: { lower: Set<string>; normalized: Set<string> },
  bibleTokens?: Set<string>,
): EntityCandidate[] {
  const candidates = extractEntityCandidates(prose)
  return candidates.filter(c => {
    // Standard grounding check for all classes.
    if (isNerGrounded(c.phrase, groundedSurface)) return false

    // L23a safe fallback: suppress capitalized-first-only candidates where
    // the first word is NOT in the bible-only token set. We use BIBLE tokens
    // (not the full grounded set) to avoid sentence-initial FPs from character
    // names: "Kael walked" must NOT fire even though "Kael" is grounded —
    // character names are not the source of domain-term derived compounds.
    // "Aether waste" fires only when "Aether" ∈ worldBible.systems names.
    if (c.class === "capitalized-first-only") {
      if (!bibleTokens || bibleTokens.size === 0) {
        // No bible context available — suppress all cap-first-only candidates
        // (safe fallback to 0 FP risk).
        return false
      }
      const words = c.phrase.split(/\s+/)
      const firstWord = (words[0] ?? "").toLowerCase()
      const secondWord = (words[1] ?? "").toLowerCase()
      // Gate 1: first word must be a bible-entry first-word token.
      if (!bibleTokens.has(firstWord)) return false
      // Gate 2: second word must not be a common function word (prepositions,
      // conjunctions, auxiliary verbs). This prevents FPs like "Thornwall before"
      // where a city name happens to be followed by a preposition.
      if (CAP_FIRST_ONLY_STOP_WORDS.has(secondWord)) return false
    }

    return true
  })
}

/**
 * Runtime wrapper for the entity-grounding checker. Called
 * from the beat drafting retry loop. Never throws — any transport or
 * schema failure is normalized into a blocking issue so the drafting
 * loop can still decide whether to retry or accept.
 *
 * Beat-entity-list charter (docs/charters/beat-entity-list-v1.md):
 * when `BEAT_ENTITY_LIST_VARIANT` is `v1` or `v3`, derive a per-beat
 * entity list from the outline's establishedFacts + prior-beat
 * description via `deriveBeatEntities` and surface it to the checker as
 * a `Beat-entities:` sub-line inside the WORLD BIBLE block. In every
 * variant (including v0) we write a `groundedSources` object to
 * `llm_calls.request_json` so the mechanism-falsifier can join fired
 * entities against per-source provenance (bible / from_brief /
 * derived_outline_fact / derived_prior_beat / allowed_new_entities /
 * planner_emitted).
 *
 * `allowed_new_entities` carries `beat.obligations.allowedNewEntities`
 * — planner-sanctioned new named entities the writer is permitted to
 * introduce in THIS beat (walk-ons, props, lore terms). Threading is
 * provenance-only at this stage; checker pass/fail logic is unchanged
 * (calibration of "use it as a sanction" is a separate L4-adjacent
 * loop, see docs/todo.md §7).
 *
 * **NER prepass (L4-followup-3, exp #322):** For variants v1/v3/v4, a
 * deterministic entity-candidate prepass runs before the LLM call.
 * AND-gate behavior:
 *   - NER fires AND LLM fires → **blocker** (same as current LLM-only fail)
 *   - NER fires, LLM passes → **warning** (issues include a NER-only note;
 *     `nerOnlyFindings` is populated; the beat is NOT passed — Design A
 *     treats a NER signal without LLM confirmation as a soft fail)
 *   - NER passes, LLM fires → **LLM-only blocker** (existing behavior)
 *   - Neither fires → **pass**
 *
 * The warning vs blocker distinction lets the retry loop escalate
 * selectively: NER+LLM agreement = high-confidence fail worth retrying;
 * NER-only = ambiguous, surface but don't burn retries indefinitely.
 */
export async function checkHallucUngrounded(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
  opts?: { prevBeat?: SceneBeat },
): Promise<HallucUngroundedResult> {
  const variant = resolveVariant()
  const derive = variant === "v1" || variant === "v3"

  const derivation = derive ? deriveBeatEntities(beat, outline, opts?.prevBeat) : null

  // L20: compute novel-spanning character roster + outline-emitted entities.
  // These are always computed (not gated on variant) so every checker call
  // has access to established characters and planner-named locations.
  const characterRoster = buildCharacterRoster(characters)
  const outlineEntities = buildOutlineEntityList(outline)
  // L23b: derive title noun forms from character role fields.
  const derivedTitles = deriveTitleNouns(characters)

  const userPrompt = buildContext(
    prose, beat, outline, characters, worldBible,
    {
      ...(derive ? { beatEntities: derivation!.entities } : {}),
      characterRoster,
      outlineEntities,
      derivedTitles,
    },
  )

  // Per charter §3 + §9: write the provenance-tagged grounded-surface
  // snapshot into request_json for the mechanism-falsifier. Bible and
  // from_brief are always populated (they're in every variant's
  // surface); derived_* are only populated when the variant activates
  // derivation; planner_emitted is reserved for V4.
  const bibleNames = [
    ...(worldBible?.locations ?? []).map((l: any) => l?.name).filter(Boolean),
    ...(worldBible?.cultures ?? []).map((c: any) => c?.name).filter(Boolean),
    ...(worldBible?.systems ?? []).map((s: any) => s?.name).filter(Boolean),
  ]
  // Re-derive From-brief so the snapshot matches what buildContext
  // surfaces. We compute it here (rather than extracting from the
  // rendered prompt string) because the From-brief line is filtered
  // against bibleKnown, and we want the provenance tag to reflect the
  // *final* set the checker actually saw.
  const briefSources = [beat.description ?? "", outline.setting ?? ""].join(" \n ")
  const bibleKnown = new Set<string>()
  for (const n of [...bibleNames, ...beat.characters, outline.povCharacter]) {
    if (n) bibleKnown.add(String(n).toLowerCase())
  }
  const fromBrief = extractProperNouns(briefSources).filter(e => !bibleKnown.has(e.toLowerCase()))

  // Planner-sanctioned new named entities for this beat. Cleaned
  // (string-coerced + trimmed + non-empty) so the snapshot matches the
  // shape the checker actually receives. Not deduped against bible /
  // from_brief here — the snapshot records the planner's authored
  // sanction set; the rendered context.ts handles display dedup.
  const allowedNewEntities: string[] = (
    (beat.obligations?.allowedNewEntities ?? []) as unknown[]
  )
    .map(e => (typeof e === "string" ? e.trim() : ""))
    .filter(Boolean)

  const groundedSourcesObj = {
    variant,
    bible: bibleNames,
    from_brief: fromBrief,
    derived_outline_fact: derivation?.sources.derivedOutlineFact ?? [],
    derived_prior_beat: derivation?.sources.derivedPriorBeat ?? [],
    allowed_new_entities: allowedNewEntities,
    planner_emitted: [] as string[],
    // L20: novel-spanning character roster + planner-emitted outline entities.
    // Default to empty arrays for backward compatibility with existing analyses.
    character_roster: characterRoster,
    outline_entities: outlineEntities,
    // L23b: character-profile derived title nouns.
    derived_titles: derivedTitles,
  }

  // ── NER prepass (variants v1 / v3 / v4 only) ──────────────────────────────
  // Build the same grounded-surface the LLM checker sees, run the
  // deterministic extractor, and record which candidates escape grounding.
  // The LLM call below is only gated on its own output — the NER signal
  // is combined at the result-assembly stage (AND-gate).
  const nerEnabled = variant === "v1" || variant === "v3" || variant === "v4"
  let nerUngrounded: EntityCandidate[] = []
  if (nerEnabled) {
    const groundedSurface = buildNerGroundedSet({
      bibleNames,
      beatCharacters: beat.characters,
      fromBrief,
      derivedOutlineFact: derivation?.sources.derivedOutlineFact ?? [],
      derivedPriorBeat: derivation?.sources.derivedPriorBeat ?? [],
      allowedNewEntities,
      povCharacter: outline.povCharacter ?? undefined,
      characterRoster,
      outlineEntities,
      derivedTitles,
    })

    // L23a: Build a bible-ONLY first-word token set (worldBible.systems +
    // .locations + .cultures names) for the cap-first-only gate in
    // runNerPrepass. Only the FIRST word of each bible name is added —
    // e.g. "Aether" from "Aether System", "Vesh" from "Vesh Order". This
    // ensures that "Aether waste" fires (Aether is a bible first-word) but
    // "Order hall" does NOT fire (Order is the SECOND word of "Vesh Order",
    // not a bible-name first-word). The set intentionally excludes character
    // names and outline entities to prevent sentence-initial character-name FPs
    // like "Kael walked" (Kael is a character roster entry, not a bible term).
    const bibleTokens = new Set<string>()
    for (const name of bibleNames) {
      if (typeof name === "string") {
        const firstWord = name.trim().split(/\s+/)[0] ?? ""
        if (firstWord.length > 0) {
          bibleTokens.add(firstWord.toLowerCase())
        }
      }
    }

    nerUngrounded = runNerPrepass(prose, groundedSurface, bibleTokens)
  }

  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      attempt: tags?.attempt,
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
      logMetadata: { groundedSources: groundedSourcesObj },
    })
    const output = result.output
    const llmPass = output.pass

    // Build NER finding list for result provenance.
    const allNerFindings: NerFinding[] = nerUngrounded.map(c => ({
      phrase: c.phrase,
      class: c.class,
    }))

    // Zod's `.default([])` resolves to an array at parse time, but the
    // inferred input type keeps the field optional — fall back to [] so
    // downstream consumers never see undefined.
    const llmIssues = (output.issues ?? []).map(i =>
      `Ungrounded entity "${i.entity}"${i.excerpt ? ` — context: "${i.excerpt}"` : ""}`,
    )

    // Build the final result and determine the AND-gate decision label for
    // persistence. We defer `return` until after the NER patch call so the
    // llm_calls row is enriched before this function returns. (L16)
    let finalResult: HallucUngroundedResult
    let andGateDecision: "ner+llm-blocker" | "ner-only-warning" | "llm-only-blocker" | "pass" | "disabled"

    if (!nerEnabled) {
      // NER prepass not active (variant v0 / v2) — preserve prior behavior exactly.
      andGateDecision = "disabled"
      if (llmPass) {
        finalResult = { pass: true, issues: [] }
      } else {
        finalResult = { pass: false, issues: llmIssues }
      }
    } else if (llmPass && nerUngrounded.length === 0) {
      // Both pass → clean beat.
      andGateDecision = "pass"
      finalResult = { pass: true, issues: [], nerFindings: [] }
    } else {
      // AND-gate assembly:
      //
      //   • NER fires ∩ LLM fires → **blocker**: both agree, high confidence.
      //   • NER fires ∩ LLM passes → **warning**: NER-only, surface but flag.
      //   • NER passes ∩ LLM fires → **LLM-only blocker**: existing behavior.
      //
      // In all non-pass cases we return pass=false so the retry loop acts. The
      // distinction between high-confidence blockers vs NER-only warnings is
      // carried in the issue message prefix and the nerOnlyFindings field so
      // callers that want to treat them differently can.

      const nerFires = nerUngrounded.length > 0
      const llmFires = !llmPass

      if (nerFires && llmFires) {
        // Blocker: NER ∩ LLM — merge both issue sets.
        // LLM issues are the canonical description (they carry excerpt context).
        // NER phrases that have NO corresponding LLM issue get appended so no
        // NER-caught entity is silently dropped.
        const llmEntitiesLower = new Set(
          (output.issues ?? []).map(i => i.entity.toLowerCase().trim()),
        )
        const nerExtraIssues = nerUngrounded
          .filter(c => !llmEntitiesLower.has(c.phrase.toLowerCase().trim()))
          .map(c => `Ungrounded entity "${c.phrase}" [NER prepass]`)
        andGateDecision = "ner+llm-blocker"
        finalResult = {
          pass: false,
          issues: [...llmIssues, ...nerExtraIssues],
          nerFindings: allNerFindings,
          nerOnlyFindings: [],
        }
      } else if (nerFires && !llmFires) {
        // Warning: NER-only — LLM did not confirm. Still fail so the retry
        // loop sees it, but label the issues clearly so operators can triage.
        const nerOnlyIssues = nerUngrounded.map(
          c => `Ungrounded entity "${c.phrase}" [NER-only warning — LLM passed]`,
        )
        andGateDecision = "ner-only-warning"
        finalResult = {
          pass: false,
          issues: nerOnlyIssues,
          nerFindings: allNerFindings,
          nerOnlyFindings: allNerFindings,
        }
      } else {
        // NER passes, LLM fires — LLM-only blocker; existing behavior.
        andGateDecision = "llm-only-blocker"
        finalResult = {
          pass: false,
          issues: llmIssues,
          nerFindings: [],
          nerOnlyFindings: [],
        }
      }
    }

    // Persist NER prepass findings to llm_calls.ner_prepass_json so future
    // LXC runs can audit AND-gate firing rates without re-running. Fail-open:
    // a patch failure never blocks the beat pipeline. (L16)
    if (result.llmCallId != null) {
      patchLLMCallNerPrepass(result.llmCallId, {
        nerEnabled,
        nerFindings: allNerFindings,
        nerOnlyFindings: finalResult.nerOnlyFindings ?? [],
        andGateDecision,
      }).catch(err => {
        console.error(`[halluc-ungrounded] NER prepass patch failed for llm_call ${result.llmCallId}:`, err)
      })
    }

    return finalResult
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      issues: [`Ungrounded check failed: ${msg}`],
    }
  }
}
