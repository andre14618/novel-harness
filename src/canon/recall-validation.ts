/**
 * Recall validation harness for the §0a deterministic bundle builder.
 *
 * Charter: docs/charters/world-bible-architecture.md §0a
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0a-session-3.md
 *
 * Pure-function harness:
 *   1. Validates canon fixture JSON conforms to the §0d schema.
 *   2. Validates labeled query JSON conforms to the query schema.
 *   3. Runs each query through assembleL1 with appropriate scoping hints
 *      and grades the resulting L1 packet against the labeled relevant set.
 *   4. Reports per-query metrics + aggregates (recall, precision, token cap).
 *
 * No LLM calls. No DB access. Fixtures are JSON files on disk; the harness
 * loads them, runs queries deterministically, and emits a metrics report.
 */

import type {
  CanonFact,
  CharacterState,
  Entity,
  StoryPromise,
} from "./api"
import { assembleL1, L1_TOKEN_CAP, type CanonSource } from "./bundle"
import type { ScopingHints } from "./scope"

// ── Canon fixture format ─────────────────────────────────────────────────────

/**
 * On-disk canon fixture. JSON with the four sections, plus a `snapshotVersion`
 * string and a `novelId`. The harness reads this file and presents it to the
 * bundle assembler via a CanonSource adapter that returns the fixture's
 * contents wholesale (the assembler's scoping rules then filter to the
 * chapter-N relevant subset).
 */
export interface CanonFixture {
  novelId: string
  snapshotVersion: string
  /** Brief metadata describing what this fixture covers. */
  description?: string
  facts: CanonFact[]
  entities: Entity[]
  characterStates: CharacterState[]
  promises: StoryPromise[]
}

// ── Labeled query format ─────────────────────────────────────────────────────

export type QueryCategory =
  | "entity-grounding"
  | "character-state-at-time"
  | "active-promises-and-payoffs"

/**
 * One labeled query. Says: "for chapter N with these scoping hints, the
 * relevant canon is exactly this set of fact/entity/state/promise IDs."
 * The harness measures recall (how many of these IDs the assembler emitted)
 * and precision (how many emitted IDs were in this set).
 */
export interface LabeledQuery {
  /** Human-readable query identifier (kebab-case). */
  id: string
  /** What kind of question this query represents. */
  category: QueryCategory
  /** Free-form natural-language description of the query. */
  question: string
  /** Chapter the query is asked about. */
  chapterN: number
  /** Scoping hints the harness will pass to assembleL1 for this query. */
  hints: ScopingHints
  /** IDs of canon entries the labeler considers relevant to this query.
   *  Heterogeneous: facts, entities, character states (by characterId),
   *  promises — all concatenated into one set since the harness measures
   *  membership across the whole L1 packet. */
  relevantIds: string[]
}

export interface QueryFixture {
  novelId: string
  snapshotVersion: string
  description?: string
  queries: LabeledQuery[]
}

// ── Format validators ────────────────────────────────────────────────────────

export class FixtureValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${path}: ${message}`)
    this.name = "FixtureValidationError"
  }
}

/** Type guard + structured validation. Throws on first error. */
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
  // Spot-check shape on first entry of each section (cheap; full schema
  // validation would mirror the TypeScript types — overkill for fixtures
  // we control. The bundle assembler's downstream usage will fail loud
  // on truly malformed entries.)
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
  if (!Array.isArray(v.queries)) {
    throw new FixtureValidationError("queries must be an array", path)
  }
  const validCategories: ReadonlySet<QueryCategory> = new Set([
    "entity-grounding",
    "character-state-at-time",
    "active-promises-and-payoffs",
  ])
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
    if (!query.hints || typeof query.hints !== "object") {
      throw new FixtureValidationError(`query ${query.id}: hints must be object`, path)
    }
  }
}

// ── CanonSource adapter for fixtures ─────────────────────────────────────────

/**
 * Wraps a CanonFixture as a CanonSource. The fixture data is point-in-time
 * already (entries with provenance.chapter > N are filtered by the bundle
 * assembler's downstream rules); this adapter just exposes the raw fixture
 * contents through the CanonSource interface.
 */
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
  /** IDs the assembler emitted for this query (across all four sections). */
  emittedIds: string[]
  /** Subset of relevantIds that were emitted. */
  recalledIds: string[]
  /** Subset of relevantIds that were NOT emitted (recall failures). */
  missedIds: string[]
  /** Subset of emittedIds that the labeler did NOT mark relevant. */
  spuriousIds: string[]
  /** recalledIds.length / max(relevantIds.length, 1). */
  recall: number
  /** recalledIds.length / max(emittedIds.length, 1). */
  precision: number
  /** approxTokens of the assembled L1 packet. */
  approxTokens: number
  /** Whether approxTokens exceeded L1_TOKEN_CAP. */
  tokenCapExceeded: boolean
}

export interface ValidationReport {
  queries: QueryMetrics[]
  aggregate: {
    queryCount: number
    /** Mean recall across all queries. */
    meanRecall: number
    /** Mean precision across all queries. */
    meanPrecision: number
    /** Number of queries hitting recall ≥ 0.80. */
    recallPassCount: number
    /** Number of queries hitting precision ≥ 0.50. */
    precisionPassCount: number
    /** Number of queries exceeding token cap. */
    tokenCapExceededCount: number
    /** Per-category breakdown. */
    byCategory: Record<QueryCategory, { count: number; meanRecall: number; meanPrecision: number }>
  }
  thresholds: {
    recallFloor: number
    precisionFloor: number
    tokenCap: number
    /** True if all stop-gate-check-4 thresholds clear at the aggregate level. */
    allCleared: boolean
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all canonical IDs from an L1 packet's sections (facts +
 *  entities + characterStates by characterId + promises). */
function collectEmittedIds(packet: ReturnType<typeof assembleL1>): string[] {
  const ids: string[] = []
  for (const f of packet.sections.facts) ids.push(f.id)
  for (const e of packet.sections.entities) ids.push(e.id)
  for (const s of packet.sections.characterStates) ids.push(s.characterId)
  for (const p of packet.sections.activePromises) ids.push(p.id)
  return ids
}

// ── Run validation ───────────────────────────────────────────────────────────

export const RECALL_FLOOR = 0.8
export const PRECISION_FLOOR = 0.5

export function runValidation(
  canon: CanonFixture,
  queries: QueryFixture,
): ValidationReport {
  if (canon.novelId !== queries.novelId) {
    throw new Error(
      `runValidation: novelId mismatch (canon=${canon.novelId} queries=${queries.novelId})`,
    )
  }
  const source = fixtureToCanonSource(canon)
  const queryMetrics: QueryMetrics[] = []

  for (const q of queries.queries) {
    const packet = assembleL1(source, canon.novelId, q.chapterN, q.hints)
    const emittedIds = collectEmittedIds(packet)
    const emittedSet = new Set(emittedIds)
    const relevantSet = new Set(q.relevantIds)

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
  const precisionPassCount = queryMetrics.filter((m) => m.precision >= PRECISION_FLOOR).length
  const tokenCapExceededCount = queryMetrics.filter((m) => m.tokenCapExceeded).length

  const byCategory: Record<QueryCategory, { count: number; meanRecall: number; meanPrecision: number }> = {
    "entity-grounding": { count: 0, meanRecall: 0, meanPrecision: 0 },
    "character-state-at-time": { count: 0, meanRecall: 0, meanPrecision: 0 },
    "active-promises-and-payoffs": { count: 0, meanRecall: 0, meanPrecision: 0 },
  }
  for (const cat of Object.keys(byCategory) as QueryCategory[]) {
    const inCat = queryMetrics.filter((m) => m.category === cat)
    byCategory[cat].count = inCat.length
    byCategory[cat].meanRecall = inCat.length
      ? inCat.reduce((a, m) => a + m.recall, 0) / inCat.length
      : 0
    byCategory[cat].meanPrecision = inCat.length
      ? inCat.reduce((a, m) => a + m.precision, 0) / inCat.length
      : 0
  }

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
      precisionFloor: PRECISION_FLOOR,
      tokenCap: L1_TOKEN_CAP,
      allCleared:
        queryCount > 0 &&
        meanRecall >= RECALL_FLOOR &&
        meanPrecision >= PRECISION_FLOOR &&
        tokenCapExceededCount === 0,
    },
  }
}
