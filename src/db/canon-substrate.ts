/**
 * Raw queries for the canon substrate (sql/035_canon_substrate.sql,
 * hardened by sql/036_canon_substrate_invariants.sql).
 *
 * Charter: docs/charters/world-bible-architecture.md §1
 * Design:  docs/designs/canon-substrate-step1.md
 * Lane:    docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md
 *
 * Per CLAUDE.md §"Database And SQL", this is the only place that issues SQL
 * against the canon_* tables. The service-layer wrapper lives at
 * src/harness/canon-substrate.ts and is what callers import.
 *
 * Row mapping is column-to-field; the only structured columns are:
 *   - data (jsonb, nullable) on canon_facts / canon_entities
 *   - aliases (jsonb, default []) on canon_entities
 *   - known_facts (jsonb, default []) on canon_character_states
 *   - state (jsonb, default {}) on canon_character_states
 *   - proposed_payload / modified_payload (jsonb) on canon_proposals
 *
 * No business rules live here — supersession bookkeeping, normalize-on-commit,
 * and the no-ghost-canon filter are enforced in the harness module. This
 * module exposes thin helpers the harness composes.
 *
 * **Transaction support.** Every mutation helper accepts an optional
 * `executor: SQL` parameter so the harness can call them inside a
 * `db.begin(async (tx) => { ... })` block. When `executor` is omitted, the
 * helper uses the global `db`. Read helpers also accept `executor` so a
 * snapshot read can join a write transaction (for repeatable-read
 * semantics inside a commit operation).
 *
 * The transactional contract was added per the Codex round-2 review of
 * `ba72e09` (HIGH finding: proposal resolution + canon commit must be
 * atomic). A crash between updateProposalResolution → markFactSuperseded →
 * insertFact → bumpGeneration would otherwise leave the substrate in an
 * inconsistent state — this is the load-bearing guarantee Step 1 promises.
 */

import { type SQL } from "bun"
import db from "./connection"

type Executor = SQL
import type {
  ApprovalStatus,
  CanonFact,
  CanonId,
  CanonUpdateProposal,
  CharacterState,
  Entity,
  EntityKind,
  FactKind,
  Provenance,
  ProvenanceSource,
  StoryPromise,
  PromiseStatus,
  ProposalStatus,
  FactOrigin,
} from "../canon/api"

// ── DTO row shapes ───────────────────────────────────────────────────────────
//
// We don't expose these — the harness translates rows to canon objects via
// the helpers below — but the types document what comes back from `db\`...\``.

interface FactRow {
  novel_id: string
  logical_id: string
  version: number
  kind: string
  text: string
  data: unknown
  source: string
  committed_at_chapter: number
  committed_at_beat: number | null
  extractor_version: string
  confidence: string | number | null
  approval_status: string
  origin: string
  supersedes_logical_id: string | null
  superseded_by_version: number | null
  superseded_at_chapter: number | null
  created_at: string | Date
  updated_at: string | Date
}

interface EntityRow {
  novel_id: string
  logical_id: string
  version: number
  name: string
  aliases: unknown
  kind: string
  first_appeared_chapter: number | null
  data: unknown
  source: string
  committed_at_chapter: number
  committed_at_beat: number | null
  extractor_version: string
  confidence: string | number | null
  approval_status: string
  origin: string
  supersedes_logical_id: string | null
  superseded_by_version: number | null
  superseded_at_chapter: number | null
  created_at: string | Date
  updated_at: string | Date
}

interface CharacterStateRow {
  novel_id: string
  character_id: string
  version: number
  character_name: string
  known_facts: unknown
  state: unknown
  as_of_chapter: number
  as_of_beat: number | null
  source: string
  committed_at_chapter: number
  committed_at_beat: number | null
  extractor_version: string
  confidence: string | number | null
  approval_status: string
  origin: string
  supersedes_logical_id: string | null
  superseded_by_version: number | null
  superseded_at_chapter: number | null
  created_at: string | Date
  updated_at: string | Date
}

interface PromiseRow {
  novel_id: string
  logical_id: string
  version: number
  setup_chapter: number
  setup_beat: number | null
  expected_payoff_chapter: number | null
  resolved_at_chapter: number | null
  resolved_at_beat: number | null
  status: string
  promise_fact_id: string
  source: string
  committed_at_chapter: number
  committed_at_beat: number | null
  extractor_version: string
  confidence: string | number | null
  approval_status: string
  origin: string
  supersedes_logical_id: string | null
  superseded_by_version: number | null
  superseded_at_chapter: number | null
  created_at: string | Date
  updated_at: string | Date
}

interface ProposalRow {
  id: string
  novel_id: string
  source: string
  target_logical_id: string | null
  proposed_payload: unknown
  modified_payload: unknown
  status: string
  operator_note: string | null
  created_at: string | Date
  resolved_at: string | Date | null
}

// ── Provenance hydration helpers ─────────────────────────────────────────────

function num(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined
  return typeof value === "string" ? Number(value) : value
}

function isoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function provFromRow(row: {
  source: string
  committed_at_chapter: number
  committed_at_beat: number | null
  extractor_version: string
  confidence: string | number | null
  approval_status: string
  origin: string
  supersedes_logical_id: string | null
  created_at: string | Date
  updated_at: string | Date
}): Provenance {
  const prov: Provenance = {
    source: row.source as ProvenanceSource,
    chapter: row.committed_at_chapter,
    extractorVersion: row.extractor_version,
    approvalStatus: row.approval_status as ApprovalStatus,
    origin: row.origin as FactOrigin,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  }
  if (row.committed_at_beat != null) prov.beat = row.committed_at_beat
  const conf = num(row.confidence)
  if (conf != null) prov.confidence = conf
  if (row.supersedes_logical_id != null) prov.supersedes = row.supersedes_logical_id
  return prov
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

// ── Snapshot-load queries ────────────────────────────────────────────────────
//
// "Latest version at-or-before chapter N that is not superseded by chapter N,
// per logical id, with approved status." Implemented per-table because the
// row shapes differ.

export async function loadFactsSnapshot(
  novelId: string,
  chapterN: number,
  executor: Executor = db,
): Promise<FactRow[]> {
  const rows = (await executor`
    SELECT DISTINCT ON (logical_id)
           novel_id, logical_id, version, kind, text, data,
           source, committed_at_chapter, committed_at_beat,
           extractor_version, confidence, approval_status, origin,
           supersedes_logical_id, superseded_by_version, superseded_at_chapter,
           created_at, updated_at
    FROM canon_facts
    WHERE novel_id = ${novelId}
      AND approval_status IN ('human-approved', 'human-edited')
      AND committed_at_chapter <= ${chapterN}
      AND (superseded_at_chapter IS NULL OR superseded_at_chapter > ${chapterN})
    ORDER BY logical_id, version DESC
  `) as FactRow[]
  return rows
}

export async function loadEntitiesSnapshot(
  novelId: string,
  chapterN: number,
  executor: Executor = db,
): Promise<EntityRow[]> {
  const rows = (await executor`
    SELECT DISTINCT ON (logical_id)
           novel_id, logical_id, version, name, aliases, kind,
           first_appeared_chapter, data,
           source, committed_at_chapter, committed_at_beat,
           extractor_version, confidence, approval_status, origin,
           supersedes_logical_id, superseded_by_version, superseded_at_chapter,
           created_at, updated_at
    FROM canon_entities
    WHERE novel_id = ${novelId}
      AND approval_status IN ('human-approved', 'human-edited')
      AND committed_at_chapter <= ${chapterN}
      AND (superseded_at_chapter IS NULL OR superseded_at_chapter > ${chapterN})
    ORDER BY logical_id, version DESC
  `) as EntityRow[]
  return rows
}

export async function loadCharacterStatesSnapshot(
  novelId: string,
  chapterN: number,
  executor: Executor = db,
): Promise<CharacterStateRow[]> {
  const rows = (await executor`
    SELECT DISTINCT ON (character_id)
           novel_id, character_id, version, character_name, known_facts, state,
           as_of_chapter, as_of_beat,
           source, committed_at_chapter, committed_at_beat,
           extractor_version, confidence, approval_status, origin,
           supersedes_logical_id, superseded_by_version, superseded_at_chapter,
           created_at, updated_at
    FROM canon_character_states
    WHERE novel_id = ${novelId}
      AND approval_status IN ('human-approved', 'human-edited')
      AND committed_at_chapter <= ${chapterN}
      AND (superseded_at_chapter IS NULL OR superseded_at_chapter > ${chapterN})
    ORDER BY character_id, version DESC
  `) as CharacterStateRow[]
  return rows
}

export async function loadPromisesSnapshot(
  novelId: string,
  chapterN: number,
  executor: Executor = db,
): Promise<PromiseRow[]> {
  const rows = (await executor`
    SELECT DISTINCT ON (logical_id)
           novel_id, logical_id, version, setup_chapter, setup_beat,
           expected_payoff_chapter, resolved_at_chapter, resolved_at_beat,
           status, promise_fact_id,
           source, committed_at_chapter, committed_at_beat,
           extractor_version, confidence, approval_status, origin,
           supersedes_logical_id, superseded_by_version, superseded_at_chapter,
           created_at, updated_at
    FROM canon_promises
    WHERE novel_id = ${novelId}
      AND approval_status IN ('human-approved', 'human-edited')
      AND committed_at_chapter <= ${chapterN}
      AND (superseded_at_chapter IS NULL OR superseded_at_chapter > ${chapterN})
    ORDER BY logical_id, version DESC
  `) as PromiseRow[]
  return rows
}

// ── Row → domain object mapping ──────────────────────────────────────────────

export function factFromRow(row: FactRow): CanonFact {
  const data = jsonValue(row.data) as Record<string, unknown> | null | undefined
  const fact: CanonFact = {
    id: row.logical_id,
    kind: row.kind as FactKind,
    text: row.text,
    provenance: provFromRow(row),
  }
  if (data != null) fact.data = data
  return fact
}

export function entityFromRow(row: EntityRow): Entity {
  const aliases = (jsonValue(row.aliases) as string[] | null | undefined) ?? []
  const data = jsonValue(row.data) as Record<string, unknown> | null | undefined
  const entity: Entity = {
    id: row.logical_id,
    name: row.name,
    aliases,
    kind: row.kind as EntityKind,
    provenance: provFromRow(row),
  }
  if (row.first_appeared_chapter != null) {
    entity.firstAppearedChapter = row.first_appeared_chapter
  }
  if (data != null) entity.data = data
  return entity
}

export function characterStateFromRow(row: CharacterStateRow): CharacterState {
  const knownFacts =
    (jsonValue(row.known_facts) as CanonId[] | null | undefined) ?? []
  const state =
    (jsonValue(row.state) as Record<string, unknown> | null | undefined) ?? {}
  const cs: CharacterState = {
    characterId: row.character_id,
    characterName: row.character_name,
    knownFacts,
    state,
    asOfChapter: row.as_of_chapter,
    provenance: provFromRow(row),
  }
  if (row.as_of_beat != null) cs.asOfBeat = row.as_of_beat
  return cs
}

export function promiseFromRow(row: PromiseRow): StoryPromise {
  const promise: StoryPromise = {
    id: row.logical_id,
    setupChapter: row.setup_chapter,
    status: row.status as PromiseStatus,
    promiseFactId: row.promise_fact_id,
    provenance: provFromRow(row),
  }
  if (row.setup_beat != null) promise.setupBeat = row.setup_beat
  if (row.expected_payoff_chapter != null) {
    promise.expectedPayoffChapter = row.expected_payoff_chapter
  }
  if (row.resolved_at_chapter != null) {
    promise.resolvedAtChapter = row.resolved_at_chapter
  }
  if (row.resolved_at_beat != null) {
    promise.resolvedAtBeat = row.resolved_at_beat
  }
  return promise
}

export function proposalFromRow(row: ProposalRow): CanonUpdateProposal {
  const proposed = jsonValue(row.proposed_payload) as CanonUpdateProposal["proposedFact"]
  const modified = jsonValue(row.modified_payload) as CanonFact | null | undefined
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  const resolvedAt =
    row.resolved_at == null
      ? undefined
      : row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : row.resolved_at
  const proposal: CanonUpdateProposal = {
    id: row.id,
    source: row.source as ProvenanceSource,
    proposedFact: proposed,
    status: row.status as ProposalStatus,
    createdAt,
  }
  if (row.target_logical_id != null) {
    proposal.targetFactId = row.target_logical_id
  }
  if (modified != null) proposal.modifiedFact = modified
  if (row.operator_note != null) proposal.operatorNote = row.operator_note
  if (resolvedAt) proposal.resolvedAt = resolvedAt
  return proposal
}

// ── Active-version lookup (for supersession bookkeeping) ─────────────────────
//
// Returns the version number of the currently active row for (novel_id,
// logical_id) — i.e., the row with superseded_by_version IS NULL. The harness
// uses this when committing a new version: it must close the prior active
// version of the new logical id, regardless of the proposal's targetFactId.

export async function activeFactVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<{ version: number } | null> {
  const rows = (await executor`
    SELECT version FROM canon_facts
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
    ORDER BY version DESC LIMIT 1
  `) as Array<{ version: number }>
  return rows.length > 0 ? { version: rows[0].version } : null
}

export async function activeEntityVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<{ version: number } | null> {
  const rows = (await executor`
    SELECT version FROM canon_entities
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
    ORDER BY version DESC LIMIT 1
  `) as Array<{ version: number }>
  return rows.length > 0 ? { version: rows[0].version } : null
}

export async function activeCharacterStateVersion(
  novelId: string,
  characterId: string,
  executor: Executor = db,
): Promise<{ version: number } | null> {
  const rows = (await executor`
    SELECT version FROM canon_character_states
    WHERE novel_id = ${novelId}
      AND character_id = ${characterId}
      AND superseded_by_version IS NULL
    ORDER BY version DESC LIMIT 1
  `) as Array<{ version: number }>
  return rows.length > 0 ? { version: rows[0].version } : null
}

export async function activePromiseVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<{ version: number } | null> {
  const rows = (await executor`
    SELECT version FROM canon_promises
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
    ORDER BY version DESC LIMIT 1
  `) as Array<{ version: number }>
  return rows.length > 0 ? { version: rows[0].version } : null
}

export async function maxFactVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_facts
    WHERE novel_id = ${novelId} AND logical_id = ${logicalId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxEntityVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_entities
    WHERE novel_id = ${novelId} AND logical_id = ${logicalId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxCharacterStateVersion(
  novelId: string,
  characterId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_character_states
    WHERE novel_id = ${novelId} AND character_id = ${characterId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxPromiseVersion(
  novelId: string,
  logicalId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_promises
    WHERE novel_id = ${novelId} AND logical_id = ${logicalId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

// ── Supersession bookkeeping ─────────────────────────────────────────────────

export async function markFactSuperseded(
  novelId: string,
  logicalId: string,
  newVersion: number,
  atChapter: number,
  executor: Executor = db,
): Promise<void> {
  await executor`
    UPDATE canon_facts
    SET superseded_by_version = ${newVersion},
        superseded_at_chapter = ${atChapter},
        updated_at = NOW()
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
  `
}

export async function markEntitySuperseded(
  novelId: string,
  logicalId: string,
  newVersion: number,
  atChapter: number,
  executor: Executor = db,
): Promise<void> {
  await executor`
    UPDATE canon_entities
    SET superseded_by_version = ${newVersion},
        superseded_at_chapter = ${atChapter},
        updated_at = NOW()
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
  `
}

export async function markCharacterStateSuperseded(
  novelId: string,
  characterId: string,
  newVersion: number,
  atChapter: number,
  executor: Executor = db,
): Promise<void> {
  await executor`
    UPDATE canon_character_states
    SET superseded_by_version = ${newVersion},
        superseded_at_chapter = ${atChapter},
        updated_at = NOW()
    WHERE novel_id = ${novelId}
      AND character_id = ${characterId}
      AND superseded_by_version IS NULL
  `
}

export async function markPromiseSuperseded(
  novelId: string,
  logicalId: string,
  newVersion: number,
  atChapter: number,
  executor: Executor = db,
): Promise<void> {
  await executor`
    UPDATE canon_promises
    SET superseded_by_version = ${newVersion},
        superseded_at_chapter = ${atChapter},
        updated_at = NOW()
    WHERE novel_id = ${novelId}
      AND logical_id = ${logicalId}
      AND superseded_by_version IS NULL
  `
}

// ── Inserts ──────────────────────────────────────────────────────────────────
//
// Each insert returns the version it landed at — the harness pre-computes the
// version number via maxXxxVersion() + 1, so the insert is unconditional. (We
// don't try to derive the next version inside the insert with a subquery
// because that race is already excluded by serializing commit operations at
// the harness layer; the design assumes a single-writer-per-novel commit
// path, which the operator-driven proposal lifecycle inherently provides.)

export async function insertFact(params: {
  novelId: string
  fact: CanonFact
  version: number
}, executor: Executor = db): Promise<void> {
  const { fact, novelId, version } = params
  const p = fact.provenance
  await executor`
    INSERT INTO canon_facts (
      novel_id, logical_id, version, kind, text, data,
      source, committed_at_chapter, committed_at_beat,
      extractor_version, confidence, approval_status, origin,
      supersedes_logical_id, created_at, updated_at
    ) VALUES (
      ${novelId}, ${fact.id}, ${version}, ${fact.kind}, ${fact.text},
      ${fact.data ? JSON.stringify(fact.data) : null}::jsonb,
      ${p.source}, ${p.chapter}, ${p.beat ?? null},
      ${p.extractorVersion}, ${p.confidence ?? null}, ${p.approvalStatus}, ${p.origin},
      ${p.supersedes ?? null},
      ${p.createdAt}::timestamptz, ${p.updatedAt}::timestamptz
    )
  `
}

export async function insertEntity(params: {
  novelId: string
  entity: Entity
  version: number
}, executor: Executor = db): Promise<void> {
  const { entity, novelId, version } = params
  const p = entity.provenance
  await executor`
    INSERT INTO canon_entities (
      novel_id, logical_id, version, name, aliases, kind,
      first_appeared_chapter, data,
      source, committed_at_chapter, committed_at_beat,
      extractor_version, confidence, approval_status, origin,
      supersedes_logical_id, created_at, updated_at
    ) VALUES (
      ${novelId}, ${entity.id}, ${version}, ${entity.name},
      ${JSON.stringify(entity.aliases ?? [])}::jsonb, ${entity.kind},
      ${entity.firstAppearedChapter ?? null},
      ${entity.data ? JSON.stringify(entity.data) : null}::jsonb,
      ${p.source}, ${p.chapter}, ${p.beat ?? null},
      ${p.extractorVersion}, ${p.confidence ?? null}, ${p.approvalStatus}, ${p.origin},
      ${p.supersedes ?? null},
      ${p.createdAt}::timestamptz, ${p.updatedAt}::timestamptz
    )
  `
}

export async function insertCharacterState(params: {
  novelId: string
  state: CharacterState
  version: number
}, executor: Executor = db): Promise<void> {
  const { state, novelId, version } = params
  const p = state.provenance
  await executor`
    INSERT INTO canon_character_states (
      novel_id, character_id, version, character_name, known_facts, state,
      as_of_chapter, as_of_beat,
      source, committed_at_chapter, committed_at_beat,
      extractor_version, confidence, approval_status, origin,
      supersedes_logical_id, created_at, updated_at
    ) VALUES (
      ${novelId}, ${state.characterId}, ${version}, ${state.characterName},
      ${JSON.stringify(state.knownFacts ?? [])}::jsonb,
      ${JSON.stringify(state.state ?? {})}::jsonb,
      ${state.asOfChapter}, ${state.asOfBeat ?? null},
      ${p.source}, ${p.chapter}, ${p.beat ?? null},
      ${p.extractorVersion}, ${p.confidence ?? null}, ${p.approvalStatus}, ${p.origin},
      ${p.supersedes ?? null},
      ${p.createdAt}::timestamptz, ${p.updatedAt}::timestamptz
    )
  `
}

export async function insertPromise(params: {
  novelId: string
  promise: StoryPromise
  version: number
}, executor: Executor = db): Promise<void> {
  const { promise, novelId, version } = params
  const p = promise.provenance
  await executor`
    INSERT INTO canon_promises (
      novel_id, logical_id, version, setup_chapter, setup_beat,
      expected_payoff_chapter, resolved_at_chapter, resolved_at_beat,
      status, promise_fact_id,
      source, committed_at_chapter, committed_at_beat,
      extractor_version, confidence, approval_status, origin,
      supersedes_logical_id, created_at, updated_at
    ) VALUES (
      ${novelId}, ${promise.id}, ${version}, ${promise.setupChapter}, ${promise.setupBeat ?? null},
      ${promise.expectedPayoffChapter ?? null}, ${promise.resolvedAtChapter ?? null}, ${promise.resolvedAtBeat ?? null},
      ${promise.status}, ${promise.promiseFactId},
      ${p.source}, ${p.chapter}, ${p.beat ?? null},
      ${p.extractorVersion}, ${p.confidence ?? null}, ${p.approvalStatus}, ${p.origin},
      ${p.supersedes ?? null},
      ${p.createdAt}::timestamptz, ${p.updatedAt}::timestamptz
    )
  `
}

// ── Proposal queries ─────────────────────────────────────────────────────────

export async function insertProposal(params: {
  id: string
  novelId: string
  source: ProvenanceSource
  targetLogicalId: string | null
  proposedPayload: CanonUpdateProposal["proposedFact"]
  status: ProposalStatus
  operatorNote: string | null
  createdAt: string
}, executor: Executor = db): Promise<void> {
  await executor`
    INSERT INTO canon_proposals (
      id, novel_id, source, target_logical_id, proposed_payload,
      status, operator_note, created_at
    ) VALUES (
      ${params.id}, ${params.novelId}, ${params.source},
      ${params.targetLogicalId},
      ${JSON.stringify(params.proposedPayload)}::jsonb,
      ${params.status}, ${params.operatorNote},
      ${params.createdAt}::timestamptz
    )
  `
}

/**
 * Idempotent proposal insert. Returns `true` if a new row was inserted, `false`
 * if a row with the given `id` already existed. Backed by `ON CONFLICT (id)
 * DO NOTHING` so re-running a proposal-generation service against the same
 * source artifact is a no-op write, regardless of the existing proposal's
 * status (pending / approved / rejected / modified).
 *
 * Designed for caller-supplied deterministic ids — e.g., the
 * `planner:${novelId}:${sourceItemId}:${schemaVersion}` template used by the
 * planner-canon-proposals harness service. The deterministic id IS the
 * idempotency key; primary-key collision is the natural guard.
 */
export async function insertProposalIfAbsent(params: {
  id: string
  novelId: string
  source: ProvenanceSource
  targetLogicalId: string | null
  proposedPayload: CanonUpdateProposal["proposedFact"]
  status: ProposalStatus
  operatorNote: string | null
  createdAt: string
}, executor: Executor = db): Promise<boolean> {
  const rows = (await executor`
    INSERT INTO canon_proposals (
      id, novel_id, source, target_logical_id, proposed_payload,
      status, operator_note, created_at
    ) VALUES (
      ${params.id}, ${params.novelId}, ${params.source},
      ${params.targetLogicalId},
      ${JSON.stringify(params.proposedPayload)}::jsonb,
      ${params.status}, ${params.operatorNote},
      ${params.createdAt}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>
  return rows.length > 0
}

export async function findProposal(
  proposalId: string,
  executor: Executor = db,
): Promise<ProposalRow | null> {
  const rows = (await executor`
    SELECT id, novel_id, source, target_logical_id, proposed_payload,
           modified_payload, status, operator_note, created_at, resolved_at
    FROM canon_proposals
    WHERE id = ${proposalId}
    LIMIT 1
  `) as ProposalRow[]
  return rows.length > 0 ? rows[0] : null
}

/**
 * Resolve a proposal with a guard against re-resolving an already-closed
 * record. The harness checks `proposal.status` first, but the DB helper
 * defends against a TOCTOU window or future operator UI race by gating
 * the UPDATE on `WHERE status = 'pending'`. If 0 rows are updated, the
 * caller gets a thrown error rather than silently committing canon for a
 * proposal that another caller already handled.
 *
 * Codex round-2 finding: "the DB helper should defensively prevent
 * re-resolving an already closed proposal, especially once multiple
 * callers or future operator UI exist."
 */
export async function updateProposalResolution(params: {
  id: string
  status: ProposalStatus
  resolvedAt: string
  operatorNote: string | null
  modifiedPayload: CanonFact | null
}, executor: Executor = db): Promise<void> {
  const rows = (await executor`
    UPDATE canon_proposals
    SET status = ${params.status},
        resolved_at = ${params.resolvedAt}::timestamptz,
        operator_note = COALESCE(${params.operatorNote}, operator_note),
        modified_payload = ${params.modifiedPayload ? JSON.stringify(params.modifiedPayload) : null}::jsonb
    WHERE id = ${params.id}
      AND status = 'pending'
    RETURNING id
  `) as Array<{ id: string }>
  if (rows.length === 0) {
    throw new Error(
      `updateProposalResolution: proposal ${params.id} is not pending (already resolved, or unknown id)`,
    )
  }
}

export async function listPendingProposals(
  novelId: string,
  executor: Executor = db,
): Promise<ProposalRow[]> {
  const rows = (await executor`
    SELECT id, novel_id, source, target_logical_id, proposed_payload,
           modified_payload, status, operator_note, created_at, resolved_at
    FROM canon_proposals
    WHERE novel_id = ${novelId}
      AND status = 'pending'
    ORDER BY created_at
  `) as ProposalRow[]
  return rows
}

/**
 * List proposals filtered by an explicit set of statuses, ordered newest
 * first. Used by the audit-view extension of `GET /api/novel/:id/canon-proposals`
 * (Phase 2B follow-on); pending-only callers should keep using
 * `listPendingProposals` for the existing creation-order semantics.
 *
 * The status set is required and non-empty by contract — pass
 * `["pending","approved","rejected","modified"]` for the all-status view
 * (or use the pre-built `ALL_PROPOSAL_STATUSES` constant). An empty array
 * is treated as "no rows match" (`= ANY('{}'::text[])` matches nothing,
 * but short-circuiting also avoids issuing a pointless query).
 */
export async function listProposalsByStatus(
  novelId: string,
  statuses: readonly string[],
  executor: Executor = db,
): Promise<ProposalRow[]> {
  if (statuses.length === 0) return []
  // Defensive validation per Codex round-1 review of Package C (LOW 1).
  // The literal-construction below would mis-parse if a status contained
  // `,`, `{`, `}`, or backslash. Today every legal status comes from the
  // closed `ALL_PROPOSAL_STATUSES` enum (no special chars), but a future
  // schema change could break the assumption silently. Reject anything
  // outside the canonical set with a typed error so the bug is loud.
  const validSet = new Set<string>(ALL_PROPOSAL_STATUSES)
  for (const s of statuses) {
    if (!validSet.has(s)) {
      throw new Error(
        `listProposalsByStatus: status ${JSON.stringify(s)} is not in ALL_PROPOSAL_STATUSES (${ALL_PROPOSAL_STATUSES.join(",")})`,
      )
    }
  }
  // Bun's SQL driver sends JS arrays as a comma-separated string, which
  // Postgres rejects when bound as text[]. Build an explicit literal.
  // Validation above guarantees no element needs escaping.
  const arrayLiteral = `{${statuses.join(",")}}`
  const rows = (await executor`
    SELECT id, novel_id, source, target_logical_id, proposed_payload,
           modified_payload, status, operator_note, created_at, resolved_at
    FROM canon_proposals
    WHERE novel_id = ${novelId}
      AND status = ANY(${arrayLiteral}::text[])
    ORDER BY created_at DESC
  `) as ProposalRow[]
  return rows
}

export const ALL_PROPOSAL_STATUSES: readonly string[] = [
  "pending",
  "approved",
  "rejected",
  "modified",
]

// ── Snapshot generation counter ──────────────────────────────────────────────

export async function bumpGeneration(
  novelId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    INSERT INTO canon_snapshot_meta (novel_id, generation_counter, updated_at)
    VALUES (${novelId}, 1, NOW())
    ON CONFLICT (novel_id) DO UPDATE
    SET generation_counter = canon_snapshot_meta.generation_counter + 1,
        updated_at = NOW()
    RETURNING generation_counter
  `) as Array<{ generation_counter: number | string }>
  const v = rows[0].generation_counter
  return typeof v === "string" ? Number(v) : v
}

export async function readGeneration(
  novelId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = (await executor`
    SELECT generation_counter FROM canon_snapshot_meta WHERE novel_id = ${novelId}
  `) as Array<{ generation_counter: number | string }>
  if (rows.length === 0) return 0
  const v = rows[0].generation_counter
  return typeof v === "string" ? Number(v) : v
}

// ── Test helpers — full deletion for a novel (DB tests cleanup) ──────────────

export async function deleteAllForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM canon_facts WHERE novel_id = ${novelId}`
  await executor`DELETE FROM canon_entities WHERE novel_id = ${novelId}`
  await executor`DELETE FROM canon_character_states WHERE novel_id = ${novelId}`
  await executor`DELETE FROM canon_promises WHERE novel_id = ${novelId}`
  await executor`DELETE FROM canon_proposals WHERE novel_id = ${novelId}`
  await executor`DELETE FROM canon_snapshot_meta WHERE novel_id = ${novelId}`
}
