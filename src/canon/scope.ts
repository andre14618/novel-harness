/**
 * Canon scoping rules — picks the subset of canon that matters for chapter N.
 *
 * Charter: docs/charters/world-bible-architecture.md §0a
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0a-session-2.md
 *
 * Production canon will exceed the L1 token cap once a novel grows past a
 * handful of chapters. The bundle assembler can't ship the whole canon to
 * every writer + judge call; it picks the relevant subset using the rules
 * here. These rules are tuned by the §0a recall/precision validation against
 * a labeled query set; v1 is the starting point, refined empirically.
 *
 * Determinism contract: `scopeCanonForChapter` is pure-function over
 * (raw canon snapshot, hints, chapterN). No clocks, no randomness, no
 * insertion-order-sensitive ops. Output is sorted by stable IDs (matches
 * the assembler's downstream expectations).
 */

import type {
  CanonFact,
  CharacterState,
  Entity,
  StoryPromise,
} from "./api"
import type { L1Sections } from "./bundle"

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ScopingHints {
  /** Chapter outline's POV character (kebab-case ID matching Entity.id). */
  povCharacterId: string
  /** All characters listed as present in the chapter outline. */
  charactersPresentIds: readonly string[]
  /** How many chapters back to include canon-events from. Default 5. */
  recencyWindow?: number
  /** Slack chapters past `expectedPayoffChapter` to still consider a promise
   *  active (e.g., a promise expected at chapter 12 may still be relevant at
   *  chapter 13 if not yet resolved). Default 2. */
  windowSlackChapters?: number
  /** Explicit fact IDs to force-include regardless of rules. Use sparingly. */
  includeFactIds?: readonly string[]
  /** Explicit fact IDs to force-exclude regardless of rules. */
  excludeFactIds?: readonly string[]
  /** Explicit entity IDs to force-include. */
  includeEntityIds?: readonly string[]
}

const DEFAULT_RECENCY_WINDOW = 5
const DEFAULT_WINDOW_SLACK = 2

// ── Helpers ──────────────────────────────────────────────────────────────────

const cmpString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const cmpFact = (a: CanonFact, b: CanonFact): number => cmpString(a.id, b.id)
const cmpEntity = (a: Entity, b: Entity): number => cmpString(a.id, b.id)
const cmpCharacterState = (a: CharacterState, b: CharacterState): number =>
  cmpString(a.characterId, b.characterId)
const cmpPromise = (a: StoryPromise, b: StoryPromise): number =>
  cmpString(a.id, b.id)

/** Returns a Set of strings the way the rules need it. */
function inScopeCharacterIds(hints: ScopingHints): Set<string> {
  const set = new Set<string>()
  if (hints.povCharacterId) set.add(hints.povCharacterId)
  for (const id of hints.charactersPresentIds) set.add(id)
  return set
}

/**
 * Heuristic: does a knowledge_change fact "reference" any of the in-scope
 * characters? Looks at the fact's free-form `data` payload for character ID
 * or character name fields. v1 best-effort; will be refined by labeled-query
 * feedback in session-3.
 */
function knowledgeFactReferencesCharacter(
  fact: CanonFact,
  characterIds: ReadonlySet<string>,
): boolean {
  if (fact.kind !== "knowledge_change") return false
  const data = fact.data
  if (!data || typeof data !== "object") return false
  const candidateFields = [
    "characterId",
    "character_id",
    "characterName",
    "character_name",
    "knower",
    "knowerId",
  ]
  for (const field of candidateFields) {
    const v = (data as Record<string, unknown>)[field]
    if (typeof v === "string" && characterIds.has(v)) return true
  }
  // Also check arrays of character IDs (e.g., participantIds).
  for (const arrField of ["characterIds", "participantIds", "knowerIds"]) {
    const v = (data as Record<string, unknown>)[arrField]
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && characterIds.has(item)) return true
      }
    }
  }
  return false
}

// ── Scoping rules ────────────────────────────────────────────────────────────

/**
 * Rule 1 (state): POV character's CharacterState + every characters-present
 * CharacterState. Filters out states with asOfChapter > N (future state).
 */
function scopeCharacterStates(
  raw: readonly CharacterState[],
  inScopeIds: ReadonlySet<string>,
  chapterN: number,
): CharacterState[] {
  return raw.filter(
    (s) => inScopeIds.has(s.characterId) && s.asOfChapter <= chapterN,
  )
}

/**
 * Rule 2: active promises overlapping chapter N. status === "open" AND
 * setupChapter ≤ N AND (expectedPayoffChapter undefined OR N ≤ expectedPayoffChapter + slack).
 */
function scopeActivePromises(
  raw: readonly StoryPromise[],
  chapterN: number,
  windowSlack: number,
): StoryPromise[] {
  return raw.filter((p) => {
    if (p.status !== "open") return false
    if (p.setupChapter > chapterN) return false
    if (p.expectedPayoffChapter == null) return true
    return chapterN <= p.expectedPayoffChapter + windowSlack
  })
}

/**
 * Rule 3 (entity): Entities the chapter contract references (POV char +
 * characters present + force-include list). Filters out entities with
 * firstAppearedChapter > N (rule: not-yet-appeared entities excluded).
 */
function scopeEntities(
  raw: readonly Entity[],
  inScopeCharacterIdsSet: ReadonlySet<string>,
  forceInclude: ReadonlySet<string>,
  chapterN: number,
): Entity[] {
  return raw.filter((e) => {
    if (forceInclude.has(e.id)) {
      // Force-include still respects "not yet appeared" — operator can't
      // teleport future canon to the writer.
      if (e.firstAppearedChapter != null && e.firstAppearedChapter > chapterN) {
        return false
      }
      return true
    }
    if (inScopeCharacterIdsSet.has(e.id)) {
      if (e.firstAppearedChapter != null && e.firstAppearedChapter > chapterN) {
        return false
      }
      return true
    }
    return false
  })
}

/**
 * Rule 4 (recent events): facts whose provenance.chapter ∈ [N-recency, N-1].
 * Rule 5 (established world): facts where kind === "established_fact" AND
 *   provenance.origin === "planned" (foundational, always included).
 * Rule 6 (POV knowledge): knowledge_change facts referencing in-scope chars.
 *
 * Combined into one filter pass; each rule contributes inclusion. Exclusion
 * rules (point-in-time, rejected, force-exclude) override.
 */
function scopeFacts(
  raw: readonly CanonFact[],
  hints: ScopingHints,
  inScopeIds: ReadonlySet<string>,
  recencyWindow: number,
  chapterN: number,
): CanonFact[] {
  const forceInclude = new Set(hints.includeFactIds ?? [])
  const forceExclude = new Set(hints.excludeFactIds ?? [])
  const recencyStart = Math.max(0, chapterN - recencyWindow)

  return raw.filter((f) => {
    if (forceExclude.has(f.id)) return false
    if (f.provenance.approvalStatus === "rejected") return false
    if (f.provenance.chapter > chapterN) return false

    if (forceInclude.has(f.id)) return true

    // Rule 5: established world rules (planned, established_fact)
    if (
      f.kind === "established_fact" &&
      f.provenance.origin === "planned"
    ) {
      return true
    }

    // Rule 4: recent canon-events
    if (
      f.provenance.chapter >= recencyStart &&
      f.provenance.chapter <= chapterN - 1
    ) {
      return true
    }

    // Rule 6: knowledge changes attached to in-scope characters
    if (knowledgeFactReferencesCharacter(f, inScopeIds)) return true

    return false
  })
}

// ── Top-level scoping function ───────────────────────────────────────────────

/**
 * Apply scoping rules v1 to a raw canon snapshot. Pure function: same inputs
 * → identical outputs. Output is sorted by stable IDs so the bundle
 * assembler's downstream serialization is deterministic.
 */
export function scopeCanonForChapter(
  raw: L1Sections,
  hints: ScopingHints,
  chapterN: number,
): L1Sections {
  const recencyWindow = hints.recencyWindow ?? DEFAULT_RECENCY_WINDOW
  const windowSlack = hints.windowSlackChapters ?? DEFAULT_WINDOW_SLACK
  const inScopeIds = inScopeCharacterIds(hints)
  const forceIncludeEntityIds = new Set(hints.includeEntityIds ?? [])

  const characterStates = scopeCharacterStates(
    raw.characterStates,
    inScopeIds,
    chapterN,
  ).sort(cmpCharacterState)

  const activePromises = scopeActivePromises(
    raw.activePromises,
    chapterN,
    windowSlack,
  ).sort(cmpPromise)

  const entities = scopeEntities(
    raw.entities,
    inScopeIds,
    forceIncludeEntityIds,
    chapterN,
  ).sort(cmpEntity)

  const facts = scopeFacts(
    raw.facts,
    hints,
    inScopeIds,
    recencyWindow,
    chapterN,
  ).sort(cmpFact)

  return { facts, entities, characterStates, activePromises }
}
