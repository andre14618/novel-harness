/**
 * Recall validation harness for the §0a deterministic bundle builder.
 *
 * Charter: docs/charters/world-bible-architecture.md §0a
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0a-session-3.md
 *
 * Architectural rule the harness enforces:
 *   ONE deterministic L1 packet per chapter, byte-identical, reused by writer
 *   and every downstream judge. Validation queries are different LENSES on
 *   the SAME packet — they don't each get their own packet, because nothing
 *   in production does either.
 *
 * Pure-function harness:
 *   1. Validates canon fixture JSON conforms to the §0d schema.
 *   2. Validates labeled query JSON conforms to the query schema. Queries
 *      have no scoping hints of their own; hints come from the per-chapter
 *      manifest carried by the QueryFixture.
 *   3. Builds one L1 packet per referenced chapter (cached) using the
 *      manifest's hints. Each query is evaluated against its chapter's
 *      packet — same packet for every query about the same chapter.
 *   4. Reports per-query metrics + aggregates (recall, precision, token cap)
 *      with a recall stop gate that requires sufficient sample size and
 *      category coverage to be meaningful.
 *
 * No LLM calls. No DB access. Fixtures are JSON files on disk.
 */

import type {
  CanonFact,
  CharacterState,
  Entity,
  StoryPromise,
} from "./api"
import {
  assembleL1,
  L1_TOKEN_CAP,
  type CanonSource,
  type L1Packet,
} from "./bundle"
import type { ScopingHints } from "./scope"

// ── Canon fixture format ─────────────────────────────────────────────────────

export interface CanonFixture {
  novelId: string
  snapshotVersion: string
  description?: string
  facts: CanonFact[]
  entities: Entity[]
  characterStates: CharacterState[]
  promises: StoryPromise[]
}

// ── Namespaced relevant IDs ──────────────────────────────────────────────────

/**
 * Kind prefixes that namespace canon IDs in queries' `relevantIds`. Without
 * this prefix, an entity called "aldric" and a character state keyed by
 * characterId="aldric" collide on a flat ID set, so the harness can't tell
 * which thing a labeler meant. Namespacing forces the labeler to be precise:
 * `entity:aldric` is the Entity row, `state:aldric` is the CharacterState
 * snapshot. Same disambiguation for facts vs promises that happen to share IDs.
 */
export type RelevantIdKind = "fact" | "entity" | "state" | "promise"
export type RelevantId = `${RelevantIdKind}:${string}`

const RELEVANT_ID_PREFIXES: readonly string[] = [
  "fact:",
  "entity:",
  "state:",
  "promise:",
]

function isValidRelevantId(id: unknown): id is RelevantId {
  if (typeof id !== "string") return false
  for (const prefix of RELEVANT_ID_PREFIXES) {
    if (id.startsWith(prefix) && id.length > prefix.length) return true
  }
  return false
}

// ── Labeled query format ─────────────────────────────────────────────────────

export type QueryCategory =
  | "entity-grounding"
  | "character-state-at-time"
  | "active-promises-and-payoffs"

const QUERY_CATEGORIES: readonly QueryCategory[] = [
  "entity-grounding",
  "character-state-at-time",
  "active-promises-and-payoffs",
]

/**
 * One labeled query. Says: "for chapter N, the relevant canon for this
 * question is exactly this set of namespaced IDs." The harness measures
 * recall (how many of these IDs the chapter's packet emitted) and
 * precision (how many emitted IDs were in this set).
 *
 * Queries do NOT carry scoping hints — those come from the per-chapter
 * manifest in the QueryFixture. Multiple queries about the same chapter
 * are different lenses on the SAME packet, matching the production rule
 * that the writer and all judges share one packet per chapter.
 */
export interface LabeledQuery {
  id: string
  category: QueryCategory
  question: string
  chapterN: number
  /** Namespaced canon IDs the labeler considers relevant. Each entry must
   *  start with `fact:`, `entity:`, `state:`, or `promise:`. */
  relevantIds: RelevantId[]
}

/**
 * Per-chapter scoping configuration. The harness assembles one L1 packet
 * per chapter using these hints; every query about that chapter is graded
 * against that single packet.
 */
export interface ChapterManifest {
  chapterN: number
  hints: ScopingHints
}

export interface QueryFixture {
  novelId: string
  snapshotVersion: string
  description?: string
  /** One manifest per chapter the queries reference. assembleL1 is called
   *  ONCE per chapter using these hints. */
  chapters: ChapterManifest[]
  queries: LabeledQuery[]
}

// ── Format validators ────────────────────────────────────────────────────────

export class FixtureValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${path}: ${message}`)
    this.name = "FixtureValidationError"
  }
}

export function validateCanonFixture(value: unknown, path = "<canon>"): asserts value is CanonFixture {
  if (!value || typeof value !== "object") {
    throw new FixtureValidationError("expected object", path)
  }
  const v = value as Record<string, unknown>
  if (typeof v.novelId !== "string" || !v.novelId) {
    throw new FixtureValidationError("missing or invalid novelId", path)
  }
  if (typeof v.snapshotVersion !== "string" || !v.snapshotVersion) {
    throw new FixtureValidationError("missing or invalid snapshotVersion", path)
  }
  for (const section of ["facts", "entities", "characterStates", "promises"] as const) {
    if (!Array.isArray(v[section])) {
      throw new FixtureValidationError(`section ${section} must be an array`, path)
    }
  }
  for (const f of v.facts as unknown[]) {
    const fact = f as Record<string, unknown>
    if (typeof fact.id !== "string" || typeof fact.text !== "string") {
      throw new FixtureValidationError(`fact missing id or text: ${JSON.stringify(f)}`, path)
    }
    if (!fact.provenance || typeof fact.provenance !== "object") {
      throw new FixtureValidationError(`fact ${fact.id} missing provenance`, path)
    }
  }
  for (const e of v.entities as unknown[]) {
    const ent = e as Record<string, unknown>
    if (typeof ent.id !== "string" || typeof ent.name !== "string") {
      throw new FixtureValidationError(`entity missing id or name: ${JSON.stringify(e)}`, path)
    }
  }
  for (const s of v.characterStates as unknown[]) {
    const state = s as Record<string, unknown>
    if (typeof state.characterId !== "string" || typeof state.asOfChapter !== "number") {
      throw new FixtureValidationError(
        `characterState missing characterId or asOfChapter: ${JSON.stringify(s)}`,
        path,
      )
    }
  }
  for (const p of v.promises as unknown[]) {
    const promise = p as Record<string, unknown>
    if (typeof promise.id !== "string" || typeof promise.setupChapter !== "number") {
      throw new FixtureValidationError(
        `promise missing id or setupChapter: ${JSON.stringify(p)}`,
        path,
      )
    }
  }
}

export function validateQueryFixture(value: unknown, path = "<queries>"): asserts value is QueryFixture {
  if (!value || typeof value !== "object") {
    throw new FixtureValidationError("expected object", path)
  }
  const v = value as Record<string, unknown>
  if (typeof v.novelId !== "string" || !v.novelId) {
    throw new FixtureValidationError("missing or invalid novelId", path)
  }
  if (!Array.isArray(v.chapters)) {
    throw new FixtureValidationError("chapters manifest must be an array", path)
  }
  for (const c of v.chapters as unknown[]) {
    const chap = c as Record<string, unknown>
    if (typeof chap.chapterN !== "number") {
      throw new FixtureValidationError(`chapter manifest entry missing chapterN: ${JSON.stringify(c)}`, path)
    }
    if (!chap.hints || typeof chap.hints !== "object") {
      throw new FixtureValidationError(`chapter ${chap.chapterN} manifest missing hints`, path)
    }
  }
  if (!Array.isArray(v.queries)) {
    throw new FixtureValidationError("queries must be an array", path)
  }
  const validCategories: ReadonlySet<QueryCategory> = new Set(QUERY_CATEGORIES)
  for (const q of v.queries as unknown[]) {
    const query = q as Record<string, unknown>
    if (typeof query.id !== "string") {
      throw new FixtureValidationError(`query missing id: ${JSON.stringify(q)}`, path)
    }
    if (typeof query.chapterN !== "number") {
      throw new FixtureValidationError(`query ${query.id}: chapterN must be number`, path)
    }
    if (!validCategories.has(query.category as QueryCategory)) {
      throw new FixtureValidationError(
        `query ${query.id}: invalid category ${query.category}`,
        path,
      )
    }
    if (!Array.isArray(query.relevantIds)) {
      throw new FixtureValidationError(`query ${query.id}: relevantIds must be array`, path)
    }
    for (const id of query.relevantIds as unknown[]) {
      if (!isValidRelevantId(id)) {
        throw new FixtureValidationError(
          `query ${query.id}: relevantId must be namespaced (fact:, entity:, state:, or promise:); got ${JSON.stringify(id)}`,
          path,
        )
      }
    }
  }
}

// ── CanonSource adapter for fixtures ─────────────────────────────────────────

export function fixtureToCanonSource(fixture: CanonFixture): CanonSource {
  return {
    factsAsOfChapter: () => fixture.facts,
    entitiesAsOfChapter: () => fixture.entities,
    characterStatesAsOfChapter: () => fixture.characterStates,
    promisesAsOfChapter: () => fixture.promises,
    snapshotVersion: () => fixture.snapshotVersion,
  }
}

// ── Per-query metrics ────────────────────────────────────────────────────────

export interface QueryMetrics {
  queryId: string
  category: QueryCategory
  chapterN: number
  /** Namespaced IDs the chapter's packet emitted (across all four sections). */
  emittedIds: RelevantId[]
  recalledIds: RelevantId[]
  missedIds: RelevantId[]
  spuriousIds: RelevantId[]
  /** recalledIds.length / max(relevantIds.length, 1). */
  recall: number
  /** recalledIds.length / max(emittedIds.length, 1). */
  precision: number
  approxTokens: number
  tokenCapExceeded: boolean
}

export interface ValidationReport {
  queries: QueryMetrics[]
  aggregate: {
    queryCount: number
    /** Mean recall. PRIMARY quality metric. */
    meanRecall: number
    /** Mean precision. OBSERVABILITY only — extra canon is fine at modest
     *  sizes; reported so pathological dilution stays visible. */
    meanPrecision: number
    recallPassCount: number
    precisionPassCount: number
    /** Number of chapter packets exceeding the sanity ceiling. Normal: 0. */
    tokenCapExceededCount: number
    byCategory: Record<QueryCategory, { count: number; meanRecall: number; meanPrecision: number }>
  }
  thresholds: {
    /** Stop-gate threshold (PRIMARY). */
    recallFloor: number
    /** Minimum query count for the recall gate to be meaningful. */
    recallMinQueryCount: number
    /** Minimum number of distinct categories for the recall gate. */
    recallMinCategoryCount: number
    /** Observability threshold (NOT a stop gate). */
    precisionObservability: number
    /** Sanity ceiling (NOT a stop gate). */
    tokenCapSanityCeiling: number
    /** True iff sample size, category coverage, AND recall floor all clear.
     *  This IS the stop gate. Precision and bundle-size are observability,
     *  not gates. */
    recallGateClear: boolean
    /** Whether any chapter packet tripped the sanity ceiling — observability
     *  signal for "investigate the rules", not a gate. */
    sanityCeilingClear: boolean
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all namespaced IDs from an L1 packet's sections. */
function collectEmittedIds(packet: L1Packet): RelevantId[] {
  const ids: RelevantId[] = []
  for (const f of packet.sections.facts) ids.push(`fact:${f.id}`)
  for (const e of packet.sections.entities) ids.push(`entity:${e.id}`)
  for (const s of packet.sections.characterStates) ids.push(`state:${s.characterId}`)
  for (const p of packet.sections.activePromises) ids.push(`promise:${p.id}`)
  return ids
}

// ── Run validation ───────────────────────────────────────────────────────────

/** Stop-gate threshold: aggregate mean recall must clear this. PRIMARY. */
export const RECALL_FLOOR = 0.8
/** Minimum query count for the recall gate. Smaller samples do not produce
 *  statistically meaningful means; the gate refuses to clear. */
export const RECALL_MIN_QUERY_COUNT = 40
/** Minimum number of distinct categories represented. The fixture must
 *  cover all three QueryCategory values; a sample that ignores one category
 *  can pass recall while leaving that category broken. */
export const RECALL_MIN_CATEGORY_COUNT = QUERY_CATEGORIES.length
/** Observability threshold for precision. NOT a stop gate. Reported so
 *  pathological dilution stays visible. */
export const PRECISION_OBSERVABILITY = 0.5

export function runValidation(
  canon: CanonFixture,
  queries: QueryFixture,
): ValidationReport {
  if (canon.novelId !== queries.novelId) {
    throw new Error(
      `runValidation: novelId mismatch (canon=${canon.novelId} queries=${queries.novelId})`,
    )
  }

  // Build per-chapter packet cache: ONE assembleL1 call per chapter, shared
  // across every query that asks about that chapter. Mirrors the production
  // rule that one chapter has one bundle reused by writer + all judges.
  const source = fixtureToCanonSource(canon)
  const packetByChapter = new Map<number, L1Packet>()
  const manifestByChapter = new Map<number, ChapterManifest>()
  for (const m of queries.chapters) {
    if (manifestByChapter.has(m.chapterN)) {
      throw new Error(
        `runValidation: duplicate chapter manifest for chapterN=${m.chapterN}`,
      )
    }
    manifestByChapter.set(m.chapterN, m)
    packetByChapter.set(
      m.chapterN,
      assembleL1(source, canon.novelId, m.chapterN, m.hints),
    )
  }

  const queryMetrics: QueryMetrics[] = []
  for (const q of queries.queries) {
    const packet = packetByChapter.get(q.chapterN)
    if (!packet) {
      throw new Error(
        `runValidation: query ${q.id} references chapterN=${q.chapterN} which has no entry in chapter manifest`,
      )
    }
    const emittedIds = collectEmittedIds(packet)
    const emittedSet = new Set<string>(emittedIds)
    const relevantSet = new Set<string>(q.relevantIds)

    const recalledIds = q.relevantIds.filter((id) => emittedSet.has(id))
    const missedIds = q.relevantIds.filter((id) => !emittedSet.has(id))
    const spuriousIds = emittedIds.filter((id) => !relevantSet.has(id))

    const recall = recalledIds.length / Math.max(q.relevantIds.length, 1)
    const precision = recalledIds.length / Math.max(emittedIds.length, 1)

    queryMetrics.push({
      queryId: q.id,
      category: q.category,
      chapterN: q.chapterN,
      emittedIds,
      recalledIds,
      missedIds,
      spuriousIds,
      recall,
      precision,
      approxTokens: packet.approxTokens,
      tokenCapExceeded: packet.tokenCapExceeded,
    })
  }

  const queryCount = queryMetrics.length
  const meanRecall = queryCount
    ? queryMetrics.reduce((acc, m) => acc + m.recall, 0) / queryCount
    : 0
  const meanPrecision = queryCount
    ? queryMetrics.reduce((acc, m) => acc + m.precision, 0) / queryCount
    : 0
  const recallPassCount = queryMetrics.filter((m) => m.recall >= RECALL_FLOOR).length
  const precisionPassCount = queryMetrics.filter((m) => m.precision >= PRECISION_OBSERVABILITY).length
  // tokenCapExceeded is a property of the chapter packet, not the query.
  // Count distinct chapter packets that tripped the ceiling.
  const tokenCapExceededCount = [...packetByChapter.values()].filter(
    (p) => p.tokenCapExceeded,
  ).length

  const byCategory: Record<QueryCategory, { count: number; meanRecall: number; meanPrecision: number }> = {
    "entity-grounding": { count: 0, meanRecall: 0, meanPrecision: 0 },
    "character-state-at-time": { count: 0, meanRecall: 0, meanPrecision: 0 },
    "active-promises-and-payoffs": { count: 0, meanRecall: 0, meanPrecision: 0 },
  }
  for (const cat of QUERY_CATEGORIES) {
    const inCat = queryMetrics.filter((m) => m.category === cat)
    byCategory[cat].count = inCat.length
    byCategory[cat].meanRecall = inCat.length
      ? inCat.reduce((a, m) => a + m.recall, 0) / inCat.length
      : 0
    byCategory[cat].meanPrecision = inCat.length
      ? inCat.reduce((a, m) => a + m.precision, 0) / inCat.length
      : 0
  }

  const categoriesRepresented = QUERY_CATEGORIES.filter(
    (cat) => byCategory[cat].count > 0,
  ).length
  const sufficientSampleSize = queryCount >= RECALL_MIN_QUERY_COUNT
  const sufficientCategoryCoverage =
    categoriesRepresented >= RECALL_MIN_CATEGORY_COUNT
  const recallGateClear =
    sufficientSampleSize &&
    sufficientCategoryCoverage &&
    meanRecall >= RECALL_FLOOR

  return {
    queries: queryMetrics,
    aggregate: {
      queryCount,
      meanRecall,
      meanPrecision,
      recallPassCount,
      precisionPassCount,
      tokenCapExceededCount,
      byCategory,
    },
    thresholds: {
      recallFloor: RECALL_FLOOR,
      recallMinQueryCount: RECALL_MIN_QUERY_COUNT,
      recallMinCategoryCount: RECALL_MIN_CATEGORY_COUNT,
      precisionObservability: PRECISION_OBSERVABILITY,
      tokenCapSanityCeiling: L1_TOKEN_CAP,
      recallGateClear,
      sanityCeilingClear: tokenCapExceededCount === 0,
    },
  }
}
