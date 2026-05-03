/**
 * Raw queries for the canon substrate (sql/035_canon_substrate.sql).
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
 */

import db from "./connection"
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
): Promise<FactRow[]> {
  const rows = (await db`
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
): Promise<EntityRow[]> {
  const rows = (await db`
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
): Promise<CharacterStateRow[]> {
  const rows = (await db`
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
): Promise<PromiseRow[]> {
  const rows = (await db`
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
): Promise<{ version: number } | null> {
  const rows = (await db`
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
): Promise<{ version: number } | null> {
  const rows = (await db`
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
): Promise<{ version: number } | null> {
  const rows = (await db`
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
): Promise<{ version: number } | null> {
  const rows = (await db`
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
): Promise<number> {
  const rows = (await db`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_facts
    WHERE novel_id = ${novelId} AND logical_id = ${logicalId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxEntityVersion(
  novelId: string,
  logicalId: string,
): Promise<number> {
  const rows = (await db`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_entities
    WHERE novel_id = ${novelId} AND logical_id = ${logicalId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxCharacterStateVersion(
  novelId: string,
  characterId: string,
): Promise<number> {
  const rows = (await db`
    SELECT COALESCE(MAX(version), 0) AS max_version FROM canon_character_states
    WHERE novel_id = ${novelId} AND character_id = ${characterId}
  `) as Array<{ max_version: number | string }>
  const v = rows[0]?.max_version
  return typeof v === "string" ? Number(v) : (v ?? 0)
}

export async function maxPromiseVersion(
  novelId: string,
  logicalId: string,
): Promise<number> {
  const rows = (await db`
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
): Promise<void> {
  await db`
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
): Promise<void> {
  await db`
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
): Promise<void> {
  await db`
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
): Promise<void> {
  await db`
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
}): Promise<void> {
  const { fact, novelId, version } = params
  const p = fact.provenance
  await db`
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
}): Promise<void> {
  const { entity, novelId, version } = params
  const p = entity.provenance
  await db`
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
}): Promise<void> {
  const { state, novelId, version } = params
  const p = state.provenance
  await db`
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
}): Promise<void> {
  const { promise, novelId, version } = params
  const p = promise.provenance
  await db`
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
}): Promise<void> {
  await db`
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

export async function findProposal(
  proposalId: string,
): Promise<ProposalRow | null> {
  const rows = (await db`
    SELECT id, novel_id, source, target_logical_id, proposed_payload,
           modified_payload, status, operator_note, created_at, resolved_at
    FROM canon_proposals
    WHERE id = ${proposalId}
    LIMIT 1
  `) as ProposalRow[]
  return rows.length > 0 ? rows[0] : null
}

export async function updateProposalResolution(params: {
  id: string
  status: ProposalStatus
  resolvedAt: string
  operatorNote: string | null
  modifiedPayload: CanonFact | null
}): Promise<void> {
  await db`
    UPDATE canon_proposals
    SET status = ${params.status},
        resolved_at = ${params.resolvedAt}::timestamptz,
        operator_note = COALESCE(${params.operatorNote}, operator_note),
        modified_payload = ${params.modifiedPayload ? JSON.stringify(params.modifiedPayload) : null}::jsonb
    WHERE id = ${params.id}
  `
}

export async function listPendingProposals(
  novelId: string,
): Promise<ProposalRow[]> {
  const rows = (await db`
    SELECT id, novel_id, source, target_logical_id, proposed_payload,
           modified_payload, status, operator_note, created_at, resolved_at
    FROM canon_proposals
    WHERE novel_id = ${novelId}
      AND status = 'pending'
    ORDER BY created_at
  `) as ProposalRow[]
  return rows
}

// ── Snapshot generation counter ──────────────────────────────────────────────

export async function bumpGeneration(novelId: string): Promise<number> {
  const rows = (await db`
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

export async function readGeneration(novelId: string): Promise<number> {
  const rows = (await db`
    SELECT generation_counter FROM canon_snapshot_meta WHERE novel_id = ${novelId}
  `) as Array<{ generation_counter: number | string }>
  if (rows.length === 0) return 0
  const v = rows[0].generation_counter
  return typeof v === "string" ? Number(v) : v
}

// ── Test helpers — full deletion for a novel (DB tests cleanup) ──────────────

export async function deleteAllForNovel(novelId: string): Promise<void> {
  await db`DELETE FROM canon_facts WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_entities WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_character_states WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_promises WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_proposals WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_snapshot_meta WHERE novel_id = ${novelId}`
}
