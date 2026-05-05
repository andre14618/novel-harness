import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { patchLLMCallNerPrepass } from "../../db/ops"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { buildContext, buildCharacterRoster, buildOutlineEntityList, deriveTitleNouns } from "./context"
import {
  hallucUngroundedSchema,
  type HallucUngroundedOutput,
  type HallucEntityRef,
  type HallucIssueMetadata,
  type HallucUngroundedResult,
  type NerFinding,
} from "./schema"
import { deriveBeatEntities, extractProperNouns } from "../../phases/beat-entity-list"
import {
  extractEntityCandidates,
  normalizeForGroundedMatch,
  deriveInitials,
  TITLE_TOKENS,
  type EntityCandidate,
} from "../../lint/entity-candidates"

// Lowercase TITLE_TOKENS set for the title-strip tier-5 fallback in
// isNerGrounded. Computed once at module load.
const TITLE_TOKENS_LOWER: ReadonlySet<string> = new Set(
  TITLE_TOKENS.map(t => t.toLowerCase()),
)

export { buildContext, buildCharacterRoster, buildOutlineEntityList, deriveTitleNouns, hallucUngroundedSchema }
export type { HallucUngroundedOutput, HallucEntityRef, HallucIssueMetadata, HallucUngroundedResult, NerFinding }

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
 * Five-tier grounding check for a NER candidate phrase.
 *
 * Tiers (in order):
 *   1. Exact lowercase match against `surface.lower`.
 *   2. Substring: any surface.lower entry contains the candidate.
 *   3. Normalized exact: normalizeForGroundedMatch(candidate) ∈ surface.normalized.
 *   4. Normalized substring: any surface.normalized entry contains the normalized candidate.
 *   5. Title-strip (L49): if the candidate begins with a known TITLE_TOKEN
 *      (Master, Lord, Captain, Arbiter, ...), strip it and retry tiers 1–4
 *      on the remainder. Grounds title+surname phrases like "Master Orin"
 *      when only the surname "Orin" is in the surface (e.g. as a character
 *      roster entry). Bounded by the closed TITLE_TOKENS lexicon to avoid
 *      over-grounding generic capitalized-multi-word phrases.
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
  // 5. title-strip (L49): if the candidate starts with a known title token,
  //    strip it and retry tiers 1–4 on the remainder. Closes title+surname
  //    grounding gaps (e.g. "Master Orin" with grounded "Orin").
  const tokens = candidatePhrase.trim().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length >= 2 && TITLE_TOKENS_LOWER.has(tokens[0]!.toLowerCase())) {
    const remainder = tokens.slice(1).join(" ")
    const remLower = remainder.toLowerCase()
    if (remLower.length > 0) {
      if (surface.lower.has(remLower)) return true
      for (const s of surface.lower) {
        if (s.length >= remLower.length && s.includes(remLower)) return true
      }
      const remNorm = normalizeForGroundedMatch(remainder)
      if (remNorm.length > 0) {
        if (surface.normalized.has(remNorm)) return true
        for (const s of surface.normalized) {
          if (s.length >= remNorm.length && s.includes(remNorm)) return true
        }
      }
    }
  }
  return false
}

interface EntityRefRegistryEntry {
  kind: HallucEntityRef["kind"]
  ref: string
  name: string
  label: string
}

function buildEntityRefRegistry(
  characters: CharacterProfile[],
  worldBible: any,
): EntityRefRegistryEntry[] {
  const entries: EntityRefRegistryEntry[] = []
  for (const character of characters ?? []) {
    const ref = typeof (character as any)?.id === "string" ? (character as any).id.trim() : ""
    const name = typeof (character as any)?.name === "string" ? (character as any).name.trim() : ""
    if (ref.length > 0 && name.length > 0) {
      entries.push({ kind: "character", ref, name, label: `Character: ${name}` })
    }
  }
  for (const system of worldBible?.systems ?? []) {
    const ref = typeof system?.id === "string" ? system.id.trim() : ""
    const name = typeof system?.name === "string" ? system.name.trim() : ""
    if (ref.length > 0 && name.length > 0) {
      entries.push({ kind: "world_system", ref, name, label: `World system: ${name}` })
    }
  }
  for (const culture of worldBible?.cultures ?? []) {
    const ref = typeof culture?.id === "string" ? culture.id.trim() : ""
    const name = typeof culture?.name === "string" ? culture.name.trim() : ""
    if (ref.length > 0 && name.length > 0) {
      entries.push({ kind: "culture", ref, name, label: `Culture: ${name}` })
    }
  }
  return entries.sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref),
  )
}

function normalizedEntityKey(value: string): string {
  const normalized = normalizeForGroundedMatch(value)
  return normalized.length > 0 ? normalized : value.toLowerCase().trim()
}

function entityNamesMatch(a: string, b: string): boolean {
  const lowerA = a.toLowerCase().trim()
  const lowerB = b.toLowerCase().trim()
  if (lowerA.length === 0 || lowerB.length === 0) return false
  return lowerA === lowerB || normalizedEntityKey(a) === normalizedEntityKey(b)
}

function titleStrippedPhrase(phrase: string): string | null {
  const tokens = phrase.trim().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length < 2) return null
  if (!TITLE_TOKENS_LOWER.has(tokens[0]!.toLowerCase())) return null
  const stripped = tokens.slice(1).join(" ").trim()
  return stripped.length > 0 ? stripped : null
}

function resolveEntityRefsFromRegistry(
  phrase: string,
  registry: readonly EntityRefRegistryEntry[],
): HallucEntityRef[] {
  const refs = new Map<string, HallucEntityRef>()
  const stripped = titleStrippedPhrase(phrase)
  for (const entry of registry) {
    let match: HallucEntityRef["match"] | null = null
    if (entityNamesMatch(phrase, entry.name)) {
      match = "exact"
    } else if (stripped && entityNamesMatch(stripped, entry.name)) {
      match = "title-stripped-exact"
    }
    if (!match) continue
    refs.set(`${entry.kind}:${entry.ref}`, {
      kind: entry.kind,
      ref: entry.ref,
      label: entry.label,
      matchedName: entry.name,
      match,
    })
  }
  return Array.from(refs.values()).sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref),
  )
}

export function resolveEntityRefsForPhrase(
  phrase: string,
  characters: CharacterProfile[],
  worldBible: any,
): HallucEntityRef[] {
  return resolveEntityRefsFromRegistry(phrase, buildEntityRefRegistry(characters, worldBible))
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
 *     `nerOnlyFindings` is populated; `pass: true` — L31a treats a NER
 *     signal without LLM confirmation as warning-only)
 *   - NER passes, LLM fires → **LLM-only blocker** (existing behavior)
 *   - Neither fires → **pass**
 *
 * The warning vs blocker distinction lets the retry loop escalate
 * selectively: NER+LLM agreement = high-confidence fail worth retrying;
 * NER-only = ambiguous, surface but don't burn retries indefinitely.
 */
/**
 * Resolve the multi-call vote N from env, falling back to the explicit opt
 * value, then to 1. The env override (`HALLUC_UNGROUNDED_VOTE_N`) lets LXC
 * production toggle without a redeploy; the opt value lets unit tests pin a
 * specific N regardless of env.
 *
 * L68 (Lever G-D): runs the LLM checker N parallel times per beat and unions
 * the LLM-confirmed flagged entities. Addresses checker stochasticity on
 * byte-identical prose surfaced by exp #389 + #395 trace.
 */
function resolveVoteN(optValue?: number): number {
  if (typeof optValue === "number" && Number.isFinite(optValue) && optValue >= 1) {
    return Math.floor(optValue)
  }
  const raw = process.env.HALLUC_UNGROUNDED_VOTE_N
  if (raw != null) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 1) return parsed
  }
  return 1
}

/**
 * Union the N parallel LLM outputs into a single logical output. Used by the
 * L68 multi-call vote path. Pure helper so unit tests can exercise the union
 * semantics without LLM calls.
 *
 * Semantics:
 *   - `pass = true` IFF every output's `pass` is true (any blocker fails the
 *     union, mirroring "any caller flagged something" → don't approve).
 *   - `issues` is the dedup'd union across all outputs by case-insensitive
 *     trimmed entity name. First non-empty excerpt for each entity wins.
 *   - At N=1 the union is byte-equivalent to the single output for any
 *     well-formed (no duplicate-entity) issues array.
 */
export function unionLlmOutputs(
  outputs: Array<{ pass: boolean; issues?: Array<{ entity: string; excerpt?: string }> }>,
): { pass: boolean; issues: Array<{ entity: string; excerpt: string }> } {
  if (outputs.length === 0) return { pass: true, issues: [] }
  const seen = new Map<string, { entity: string; excerpt: string }>()
  for (const out of outputs) {
    for (const issue of out.issues ?? []) {
      const key = issue.entity.toLowerCase().trim()
      if (key.length === 0) continue
      const prior = seen.get(key)
      const excerpt = issue.excerpt ?? ""
      if (prior == null) {
        seen.set(key, { entity: issue.entity, excerpt })
      } else if (prior.excerpt.length === 0 && excerpt.length > 0) {
        // Prefer first non-empty excerpt for this entity. Keeps the original
        // entity casing from whichever call surfaced it first.
        seen.set(key, { entity: prior.entity, excerpt })
      }
    }
  }
  return {
    pass: outputs.every(o => o.pass === true),
    issues: Array.from(seen.values()),
  }
}

export async function checkHallucUngrounded(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; beatId?: string; attempt?: number },
  opts?: { prevBeat?: SceneBeat; voteN?: number },
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
  const entityRefRegistry = buildEntityRefRegistry(characters, worldBible)

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
  //
  // L40: `groundedSurface` is lifted to outer scope so it can also serve as
  // a deterministic post-filter on LLM-flagged entities after the LLM call
  // (see post-LLM block below). This addresses cases where the LLM checker
  // under-attends to a world-bible entry that NER's normalizer would catch
  // (e.g. heretic "the System" vs worldBible.systems "The System").
  const nerEnabled = variant === "v1" || variant === "v3" || variant === "v4"
  let nerUngrounded: EntityCandidate[] = []
  let groundedSurface: { lower: Set<string>; normalized: Set<string> } | null = null
  if (nerEnabled) {
    groundedSurface = buildNerGroundedSet({
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

  // L68 (Lever G-D): multi-call vote/union. When voteN > 1 we issue N parallel
  // halluc-ungrounded LLM calls and union their flagged-entity sets. The NER
  // prepass above runs once (deterministic on the same prose+grounded surface);
  // only the LLM call repeats. At voteN=1 the behavior is byte-equivalent to
  // the pre-L68 single-call path for any well-formed checker output.
  const voteN = resolveVoteN(opts?.voteN)

  try {
    const callResults = await Promise.all(
      Array.from({ length: voteN }, () =>
        callAgent({
          novelId: tags?.novelId,
          chapter: tags?.chapter,
          beatIndex: tags?.beatIndex,
          beatId: tags?.beatId ?? beat.beatId,
          attempt: tags?.attempt,
          agentName: "halluc-ungrounded" as const,
          systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
          userPrompt,
          schema: hallucUngroundedSchema,
          logMetadata: { groundedSources: groundedSourcesObj },
        }),
      ),
    )
    // Union the N LLM outputs into a single logical output for the L40 filter
    // and AND-gate assembly downstream. At voteN=1 this is a no-op pass-through.
    const output = unionLlmOutputs(callResults.map(r => r.output))
    const llmPass = output.pass

    // Build NER finding list for result provenance.
    const allNerFindings: NerFinding[] = nerUngrounded.map(c => {
      const entityRefs = resolveEntityRefsFromRegistry(c.phrase, entityRefRegistry)
      return {
        phrase: c.phrase,
        class: c.class,
        ...(entityRefs.length > 0 ? { entityRefs } : {}),
      }
    })

    // L40: Apply NER's deterministic grounded-surface as a post-filter on
    // LLM-flagged entities. The LLM checker has the same evidence surface
    // in its prompt context but can occasionally miss matches due to
    // surface-form variation (e.g. "the System" vs "The System" / single-
    // word capitalisations of a world-bible entry). isNerGrounded uses the
    // same four-tier check (exact / substring / normalized / normalized-
    // substring) the NER prepass uses on its own candidates — applying it
    // here as a final arbiter drops LLM issues whose entity is in the
    // grounded set. Closes the L40 cluster (heretic gamelit "System"
    // entity in worldBible.systems[] but flagged by LLM).
    //
    // Filter only runs when nerEnabled (v1/v3/v4) — v0/v2 lack a built
    // groundedSurface and preserve prior behavior exactly.
    const rawLlmIssues = output.issues ?? []
    const llmRescuedByNer: typeof rawLlmIssues = []
    const llmKeptRawIssues: typeof rawLlmIssues = []
    if (nerEnabled && groundedSurface) {
      for (const issue of rawLlmIssues) {
        if (isNerGrounded(issue.entity, groundedSurface)) {
          llmRescuedByNer.push(issue)
        } else {
          llmKeptRawIssues.push(issue)
        }
      }
    } else {
      llmKeptRawIssues.push(...rawLlmIssues)
    }
    // L40: when LLM said pass=false but every flagged entity was rescued
    // by the grounded surface, treat the LLM signal as effectively pass.
    // Used by the AND-gate below to compute the final decision.
    const llmEffectivelyFires = !llmPass && llmKeptRawIssues.length > 0

    // Zod's `.default([])` resolves to an array at parse time, but the
    // inferred input type keeps the field optional — fall back to [] so
    // downstream consumers never see undefined. Built from the L40-filtered
    // kept issues; rescued-by-NER entries do not surface as issues.
    const llmIssues = llmKeptRawIssues.map(i =>
      `Ungrounded entity "${i.entity}"${i.excerpt ? ` — context: "${i.excerpt}"` : ""}`,
    )
    const issueMetadataForEntity = (entity: string, excerpt = ""): HallucIssueMetadata => ({
      entity,
      excerpt,
      entityRefs: resolveEntityRefsFromRegistry(entity, entityRefRegistry),
    })
    const issueMetadataForLlmIssue = (issue: { entity: string; excerpt?: string }): HallucIssueMetadata =>
      issueMetadataForEntity(issue.entity, issue.excerpt ?? "")
    const llmIssueMetadata = llmKeptRawIssues.map(issueMetadataForLlmIssue)
    const llmRescuedIssueMetadata = llmRescuedByNer.map(issueMetadataForLlmIssue)

    // Build the final result and determine the AND-gate decision label for
    // persistence. We defer `return` until after the NER patch call so the
    // llm_calls row is enriched before this function returns. (L16)
    let finalResult: HallucUngroundedResult
    let andGateDecision: "ner+llm-blocker" | "ner-only-warning" | "llm-only-blocker" | "pass" | "disabled"

    if (!nerEnabled) {
      // NER prepass not active (variant v0 / v2) — preserve prior behavior exactly.
      andGateDecision = "disabled"
      if (llmPass) {
        finalResult = { pass: true, issues: [], issueMetadata: [] }
      } else {
        finalResult = { pass: false, issues: llmIssues, issueMetadata: llmIssueMetadata }
      }
    } else if (!llmEffectivelyFires && nerUngrounded.length === 0) {
      // Both pass → clean beat. (L40: `!llmEffectivelyFires` covers the
      // case where the LLM raised issues but every flagged entity was
      // rescued by NER's grounded surface.)
      andGateDecision = "pass"
      finalResult = { pass: true, issues: [], issueMetadata: [], nerFindings: [] }
    } else {
      // AND-gate assembly (L31a + L31b redesign):
      //
      //   • NER fires ∩ LLM fires on the SAME entity → **ner+llm-blocker**
      //     (intersection ≠ ∅, high confidence). pass=false.
      //   • NER fires ∩ LLM fires on DIFFERENT entities → split:
      //       - NER-only-warning issues for the NER-only entities (pass=true)
      //       - LLM-only-blocker issues for the LLM-only entities (pass=false)
      //     Combined: pass=false because there is at least one LLM-only blocker.
      //   • NER fires ∩ LLM passes → **NER-only warning**: LLM did not confirm.
      //     pass=true (L31a: don't burn retries on plausible world-building nouns
      //     the LLM already approved). Issues carry severity: "warning".
      //   • NER passes ∩ LLM fires → **LLM-only blocker**: existing behavior.
      //     pass=false.
      //
      // The distinction is carried in:
      //   - issue message prefixes ([NER-only warning — LLM passed] / [NER prepass])
      //   - nerOnlyFindings field (populated only for NER-only warnings)
      //   - issuesSeverity[] parallel array consumed by aggregateIssues in beat-checks.ts

      const nerFires = nerUngrounded.length > 0
      const llmFires = llmEffectivelyFires // L40: post-rescue signal

      if (nerFires && llmFires) {
        // L31b: compute entity-level intersection between NER and LLM findings.
        // "Same entity" = case-insensitive phrase overlap using the same
        // normalizeForGroundedMatch logic the grounding check uses.
        // L40: only the kept (un-rescued) LLM issues participate in the
        // intersection — rescued entries already collapsed via NER grounding.
        const nerPhrasesLower = new Set(nerUngrounded.map(c => c.phrase.toLowerCase().trim()))
        const llmPhrasesLower = new Set(llmKeptRawIssues.map(i => i.entity.toLowerCase().trim()))

        // Build intersection: NER phrase matches LLM phrase when either contains the other
        // (handles title-pair "Vesh Order" matching LLM "Vesh Order" exactly, or partial
        // phrases where NER catches "Aldric" but LLM says "Aldric Vey" — directional match
        // guards against false compound signals).
        const nerInLlm = new Set<string>() // NER phrases confirmed by LLM
        const llmInNer = new Set<string>() // LLM phrases confirmed by NER
        for (const np of nerPhrasesLower) {
          for (const lp of llmPhrasesLower) {
            if (np === lp || lp.includes(np) || np.includes(lp)) {
              nerInLlm.add(np)
              llmInNer.add(lp)
            }
          }
        }

        const hasIntersection = nerInLlm.size > 0

        if (hasIntersection) {
          // True compound blocker: at least one entity flagged by both NER AND LLM.
          // Merge all LLM issues + NER-extra phrases not mentioned by LLM.
          // L40: kept-only issues feed this set so rescued entries don't
          // resurrect as "extra" NER phrases.
          const llmEntitiesLower = new Set(
            llmKeptRawIssues.map(i => i.entity.toLowerCase().trim()),
          )
          const nerExtraIssues = nerUngrounded
            .filter(c => !llmEntitiesLower.has(c.phrase.toLowerCase().trim()))
            .map(c => `Ungrounded entity "${c.phrase}" [NER prepass]`)
          const nerExtraIssueMetadata = nerUngrounded
            .filter(c => !llmEntitiesLower.has(c.phrase.toLowerCase().trim()))
            .map(c => issueMetadataForEntity(c.phrase))
          andGateDecision = "ner+llm-blocker"
          finalResult = {
            pass: false,
            issues: [...llmIssues, ...nerExtraIssues],
            issuesSeverity: [
              ...llmIssues.map(() => "blocker" as const),
              ...nerExtraIssues.map(() => "blocker" as const),
            ],
            issueMetadata: [...llmIssueMetadata, ...nerExtraIssueMetadata],
            nerFindings: allNerFindings,
            nerOnlyFindings: [],
          }
        } else {
          // L31b disjoint case: NER and LLM flagged completely different entities.
          // Emit NER-only warnings (severity: "warning") + LLM-only blockers (severity: "blocker").
          // Combined pass=false because there are LLM blockers.
          const nerOnlyIssues = nerUngrounded.map(
            c => `Ungrounded entity "${c.phrase}" [NER-only warning — LLM passed]`,
          )
          const nerOnlyIssueMetadata = nerUngrounded.map(c => issueMetadataForEntity(c.phrase))
          const nerOnlyFindings = allNerFindings
          andGateDecision = "ner-only-warning" // dominant decision for per-entity NER side
          finalResult = {
            pass: false,
            issues: [...nerOnlyIssues, ...llmIssues],
            issuesSeverity: [
              ...nerOnlyIssues.map(() => "warning" as const),
              ...llmIssues.map(() => "blocker" as const),
            ],
            issueMetadata: [...nerOnlyIssueMetadata, ...llmIssueMetadata],
            nerFindings: allNerFindings,
            nerOnlyFindings,
          }
        }
      } else if (nerFires && !llmFires) {
        // L31a: NER-only warning — LLM did not confirm.
        // Return pass=true: the LLM (primary semantic judge) already approved
        // these entities. NER-only signals are surfaced as warnings so operators
        // can triage but beat retry budget is NOT consumed. Docstring at line 295
        // says "NER-only = ambiguous, surface but don't burn retries indefinitely".
        const nerOnlyIssues = nerUngrounded.map(
          c => `Ungrounded entity "${c.phrase}" [NER-only warning — LLM passed]`,
        )
        const nerOnlyIssueMetadata = nerUngrounded.map(c => issueMetadataForEntity(c.phrase))
        andGateDecision = "ner-only-warning"
        finalResult = {
          pass: true,
          issues: nerOnlyIssues,
          issuesSeverity: nerOnlyIssues.map(() => "warning" as const),
          issueMetadata: nerOnlyIssueMetadata,
          nerFindings: allNerFindings,
          nerOnlyFindings: allNerFindings,
        }
      } else {
        // NER passes, LLM fires — LLM-only blocker; existing behavior.
        andGateDecision = "llm-only-blocker"
        finalResult = {
          pass: false,
          issues: llmIssues,
          issuesSeverity: llmIssues.map(() => "blocker" as const),
          issueMetadata: llmIssueMetadata,
          nerFindings: [],
          nerOnlyFindings: [],
        }
      }
    }

    // Persist NER prepass findings to llm_calls.ner_prepass_json before
    // returning so future LXC runs can audit AND-gate firing rates without
    // re-running. Fail-open: a patch failure never blocks the beat pipeline.
    // (L16)
    //
    // L68: when voteN > 1 we patch all N call rows so the audit trail can
    // reconstruct the union per-beat. Each row is tagged with its `voteIndex`
    // and the `voteN` of the fan-out. The shared union-derived fields
    // (nerFindings, nerOnlyFindings, andGateDecision, llmRescuedByNer) are
    // identical across all N rows because they describe the unioned outcome.
    await Promise.all(
      callResults.map((r, i) => {
        if (r.llmCallId == null) return Promise.resolve()
        return patchLLMCallNerPrepass(r.llmCallId, {
          nerEnabled,
          nerFindings: allNerFindings,
          nerOnlyFindings: finalResult.nerOnlyFindings ?? [],
          issueMetadata: finalResult.issueMetadata ?? [],
          llmRescuedIssueMetadata,
          andGateDecision,
          // L40: count of LLM issues filtered out by NER's grounded-surface
          // post-pass. >0 means NER overrode an LLM-only blocker (or partial
          // blocker) on entities the deterministic surface already grounds.
          llmRescuedByNer: llmRescuedByNer.length,
          // L68: only set when this is part of a multi-call fan-out so the
          // single-call path stays bit-for-bit identical to pre-L68 patches.
          ...(voteN > 1 ? { voteIndex: i, voteN } : {}),
        }).catch(err => {
          console.error(
            `[halluc-ungrounded] NER prepass patch failed for llm_call ${r.llmCallId} (voteIndex=${i}, voteN=${voteN}):`,
            err,
          )
        })
      }),
    )

    return finalResult
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      issues: [`Ungrounded check failed: ${msg}`],
    }
  }
}
