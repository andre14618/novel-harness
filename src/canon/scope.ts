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
  ApprovalStatus,
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
  /** All entity IDs the chapter contract names — characters, places, items,
   *  organizations. Drives rule 3 (entity scoping). If omitted, only
   *  in-scope characters get their Entity row included; non-character
   *  entities like artifacts and locations would be invisible to the writer
   *  unless force-included. */
  chapterEntityIds?: readonly string[]
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

/**
 * "No ghost canon" rule: only operator-blessed canon enters the writer
 * context. Auto-extracted, contested, and rejected canon are pending until
 * a human signs off — they MUST NOT bleed into prompts because the writer
 * can't tell un-approved canon from approved canon, and we'd be teaching
 * the model to hallucinate from its own un-vetted output.
 */
const APPROVED_STATUSES: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>([
  "human-approved",
  "human-edited",
])

function isApproved(approvalStatus: ApprovalStatus): boolean {
  return APPROVED_STATUSES.has(approvalStatus)
}

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
 * CharacterState, reduced to the LATEST snapshot per character at or before
 * chapter N. The writer needs the most current view of each character, not
 * a stack of historical snapshots — emitting all of them would (a) waste
 * tokens, (b) confuse the model about which snapshot is authoritative.
 */
function scopeCharacterStates(
  raw: readonly CharacterState[],
  inScopeIds: ReadonlySet<string>,
  chapterN: number,
): CharacterState[] {
  const eligible = raw.filter(
    (s) =>
      isApproved(s.provenance.approvalStatus) &&
      inScopeIds.has(s.characterId) &&
      s.asOfChapter <= chapterN,
  )
  // Group by characterId, keep the snapshot with strictly-greater asOfChapter.
  // Two states with identical (characterId, asOfChapter) is a data anomaly —
  // the upstream extractor should not produce duplicate snapshots — but if
  // it happens, the first entry in the input array wins so behavior is
  // predictable. Output ordering is then stabilized by cmpCharacterState
  // at the call site.
  const latestByChar = new Map<string, CharacterState>()
  for (const s of eligible) {
    const existing = latestByChar.get(s.characterId)
    if (!existing || s.asOfChapter > existing.asOfChapter) {
      latestByChar.set(s.characterId, s)
    }
  }
  return [...latestByChar.values()]
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
    if (!isApproved(p.provenance.approvalStatus)) return false
    if (p.status !== "open") return false
    if (p.setupChapter > chapterN) return false
    if (p.expectedPayoffChapter == null) return true
    return chapterN <= p.expectedPayoffChapter + windowSlack
  })
}

/**
 * Rule 3 (entity): Entities the chapter contract references — POV char,
 * characters present, ANY entity named in the chapter outline (locations,
 * artifacts, organizations), plus the force-include list. Filters out
 * entities with firstAppearedChapter > N (not-yet-appeared) and entities
 * whose canon is not yet operator-approved (no ghost canon).
 */
function scopeEntities(
  raw: readonly Entity[],
  chapterEntityIdsSet: ReadonlySet<string>,
  forceInclude: ReadonlySet<string>,
  chapterN: number,
): Entity[] {
  return raw.filter((e) => {
    if (!isApproved(e.provenance.approvalStatus)) return false
    if (forceInclude.has(e.id)) {
      // Force-include still respects "not yet appeared" — operator can't
      // teleport future canon to the writer.
      if (e.firstAppearedChapter != null && e.firstAppearedChapter > chapterN) {
        return false
      }
      return true
    }
    if (chapterEntityIdsSet.has(e.id)) {
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
 * Rule 5 (established world): facts where kind === "established_fact" — the
 *   set of "world rules that are always true" once they enter canon. Includes
 *   both planner-asserted and post-draft-observed facts; the distinction is
 *   provenance, not relevance, and observed established facts (e.g., a
 *   law-of-magic that the prose surfaced and the operator approved) are just
 *   as load-bearing as planned ones.
 * Rule 6 (POV knowledge): knowledge_change facts referencing in-scope chars.
 *
 * Combined into one filter pass; each rule contributes inclusion. Exclusion
 * rules (point-in-time, not-yet-approved, force-exclude) override.
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
    if (!isApproved(f.provenance.approvalStatus)) return false
    if (f.provenance.chapter > chapterN) return false

    if (forceInclude.has(f.id)) return true

    // Rule 5: established world rules (any origin — planned or observed).
    if (f.kind === "established_fact") return true

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
  // Entity scope = characters in scope ∪ entities the chapter contract names.
  // This catches non-character entities (kingdoms, artifacts, organizations)
  // without forcing every chapter outline to enumerate them as force-includes.
  const chapterEntityIdsSet = new Set<string>([
    ...inScopeIds,
    ...(hints.chapterEntityIds ?? []),
  ])

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
    chapterEntityIdsSet,
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
