/**
 * Planner Canon Proposals — Phase 1 of the collaborative proposal workflow.
 *
 * Charter: docs/charters/world-bible-architecture.md (Step 1 cleared)
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 1 — Planner Source Items To Pending Canon Proposals"
 * Lane:    docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md
 *
 * This service converts mechanically-valid planner source items
 * (`fact` / `knowledge` / `state` rows on `ChapterOutline`) into pending
 * `CanonUpdateProposal` rows via the existing canon substrate. It does not
 * write committed canon — proposals stay `pending` until an operator
 * approves them via `PostgresCanonSubstrate.resolveProposal`.
 *
 * **Mechanical gate.** Before any proposal write, the service runs
 * `runPlannerCanonDeltaAudit` from `src/canon/planner-canon-delta.ts`. If
 * `idGraphGateClear === false`, the service refuses and returns the audit
 * report. This is the proposal-safe boundary — invalid IDs / duplicate IDs
 * / orphan obligations all block proposal generation.
 *
 * **Idempotency.** Each proposal id is deterministic on
 * `(novelId, sourceItemId, schemaVersion)`. The DB write uses
 * `insertProposalIfAbsent` (`ON CONFLICT (id) DO NOTHING`), so re-running
 * the service against the same outlines is a no-op write regardless of the
 * existing proposal's resolution status. A rejected proposal stays rejected;
 * the operator's "no" survives re-runs.
 *
 * **No ghost canon.** Pending and rejected proposals never appear in
 * `factsAsOfChapter` reads. This is enforced by `CanonSubstrate` itself
 * (proposals live in `canon_proposals`; reads come from `canon_facts`); the
 * Phase 1 tests exercise the property end-to-end.
 *
 * **Why fact-only.** Per `docs/designs/canon-substrate-step1.md` and
 * `src/canon/api.ts` (post-hardening pass), `CanonUpdateProposal` covers
 * `CanonFact` only in §1. `FactKind` already enumerates `established_fact`,
 * `knowledge_change`, `character_state` (and `promise` / `payoff`), so all
 * three planner source kinds map cleanly. Typed `Entity` / `CharacterState` /
 * `StoryPromise` proposals are a follow-on charter, not Phase 1.
 */

import type { ChapterOutline } from "../types"
import { trace } from "../trace"
import {
  runPlannerCanonDeltaAudit,
  type PlannerCanonDeltaReport,
  type PlannerCanonDeltaSourceItem,
} from "../canon/planner-canon-delta"
import {
  insertProposalIfAbsent,
  listPendingProposals,
} from "../db/canon-substrate"
import type {
  CanonFact,
  CanonId,
  CanonUpdateProposal,
  FactKind,
  ProvenanceSource,
} from "../canon/api"

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Schema version for planner-origin Canon proposal payloads. Bumped when:
 *
 *   - the proposal-payload shape changes (new required `data.*` fields,
 *     reshaped provenance, etc.), or
 *   - the source-item → kind mapping changes (e.g., a 4th source-item kind
 *     is added).
 *
 * The version is part of the deterministic proposal id, so a bump produces
 * a fresh proposal row alongside any historical row for the same source
 * item. Operators see both; the historical proposal's resolution remains
 * authoritative for that prior version, and the new proposal goes through
 * its own approve/reject lifecycle.
 */
export const PLANNER_PROPOSAL_SCHEMA_VERSION = "v1"

/** Result returned to callers. */
export interface PlannerCanonProposalResult {
  /** Proposals newly inserted (deterministic id; status="pending"). */
  created: readonly CanonUpdateProposal[]
  /** Source items skipped because a proposal with the deterministic id already existed (any status). */
  skipped: readonly PlannerCanonProposalSkip[]
  /** The mechanical-gate audit report. Always returned for observability. */
  gateReport: PlannerCanonDeltaReport
  /** Whether the mechanical gate passed (= `gateReport.summary.idGraphGateClear`). */
  gateClear: boolean
}

/** Pure-helper output: built proposals + gate report, with NO DB writes. */
export interface PlannerCanonProposalBuild {
  /** Proposals built from gate-clear source items. Empty if gate failed. */
  proposals: readonly CanonUpdateProposal[]
  /** The mechanical-gate audit report. */
  gateReport: PlannerCanonDeltaReport
  /** Whether the mechanical gate passed. */
  gateClear: boolean
}

export interface PlannerCanonProposalSkip {
  proposalId: string
  sourceItemId: string
  reason: "already-exists"
}

export interface GeneratePlannerCanonProposalsOpts {
  /**
   * Override the default `extractorVersion` written into provenance. Useful
   * when callers want to attribute proposals to a specific planner build.
   * Default: `"planner-${PLANNER_PROPOSAL_SCHEMA_VERSION}"`.
   */
  extractorVersion?: string
  /**
   * Override the default schema version threaded into the deterministic
   * proposal id. Tests can pass this to force fresh proposals against the
   * same outlines without bumping the production constant.
   */
  schemaVersion?: string
  /**
   * Override the timestamp written to `canon_proposals.created_at`. Tests
   * use this to make idempotency assertions clean. Defaults to `new Date()`
   * at the moment the row is inserted.
   */
  createdAt?: string
}

/**
 * Pure variant of `generatePlannerCanonProposals`: runs the mechanical gate
 * and computes proposal payloads, but performs NO DB writes. Useful for tests
 * (no DB dependency on the mapping logic) and for callers — review preview
 * UIs / dry-run scripts — that want to inspect proposal shape without
 * persisting.
 *
 * If the gate fails, returns an empty `proposals` array and `gateClear=false`.
 * The deterministic proposal id makes this safe to call repeatedly: the same
 * outlines always produce the same proposal-id list, byte-identical aside
 * from `createdAt` if the caller did not pass `opts.createdAt`.
 */
export function buildPlannerCanonProposals(
  novelId: string,
  outlines: readonly ChapterOutline[],
  opts: GeneratePlannerCanonProposalsOpts = {},
): PlannerCanonProposalBuild {
  const schemaVersion = opts.schemaVersion ?? PLANNER_PROPOSAL_SCHEMA_VERSION
  const extractorVersion = opts.extractorVersion ?? `planner-${schemaVersion}`
  const createdAt = opts.createdAt ?? new Date().toISOString()

  const gateReport = runPlannerCanonDeltaAudit(`novel:${novelId}`, outlines)
  const gateClear = gateReport.summary.idGraphGateClear
  if (!gateClear) {
    return { proposals: [], gateReport, gateClear: false }
  }

  const proposals: CanonUpdateProposal[] = []
  for (const item of gateReport.sourceItems) {
    // Defensive: the gate already requires every source item to have a
    // valid id, but re-check at the boundary so a future gate-relaxation
    // can't silently let invalid ids into proposal payloads.
    if (!item.validId) continue
    proposals.push(
      buildProposalFromSourceItem(
        novelId,
        item,
        schemaVersion,
        extractorVersion,
        createdAt,
      ),
    )
  }
  return { proposals, gateReport, gateClear: true }
}

/**
 * Convert mechanically-valid planner source items to pending Canon proposals.
 *
 * The service runs the mechanical gate first; if the gate fails, NO proposals
 * are written and the audit report is returned with `gateClear=false`.
 *
 * On gate-clear, every source item gets a deterministic proposal id and an
 * `INSERT … ON CONFLICT (id) DO NOTHING`. New rows land in `created`;
 * pre-existing rows (any status) land in `skipped`.
 */
export async function generatePlannerCanonProposals(
  novelId: string,
  outlines: readonly ChapterOutline[],
  opts: GeneratePlannerCanonProposalsOpts = {},
): Promise<PlannerCanonProposalResult> {
  const schemaVersion = opts.schemaVersion ?? PLANNER_PROPOSAL_SCHEMA_VERSION
  const { proposals, gateReport, gateClear } = buildPlannerCanonProposals(
    novelId,
    outlines,
    opts,
  )
  if (!gateClear) {
    await trace(novelId, {
      eventType: "canon-proposal-generate-summary",
      agent: "planner-canon-proposals",
      payload: {
        outlinesCount: outlines.length,
        gateClear: false,
        createdCount: 0,
        skippedCount: 0,
        recommendation: gateReport.summary.recommendation,
        validationErrorCount: gateReport.summary.validationErrorCount,
        duplicateSourceIdCount: gateReport.summary.duplicateSourceIdCount,
      },
    })
    return { created: [], skipped: [], gateReport, gateClear: false }
  }

  const created: CanonUpdateProposal[] = []
  const skipped: PlannerCanonProposalSkip[] = []
  for (const proposal of proposals) {
    const inserted = await insertProposalIfAbsent({
      id: proposal.id,
      novelId,
      source: proposal.source,
      targetLogicalId: proposal.targetFactId ?? null,
      proposedPayload: proposal.proposedFact,
      status: "pending",
      operatorNote: null,
      createdAt: proposal.createdAt,
    })
    const sourceItemId =
      (proposal.proposedFact.data?.["sourceItemId"] as string | undefined) ??
      proposal.proposedFact.id
    if (inserted) {
      created.push(proposal)
      // Telemetry — one event per newly-inserted proposal. Skipped (already-
      // exists) inserts intentionally do NOT emit so a re-run is observably
      // silent in pipeline_events. Awaited so the row is durable before the
      // batch returns; trace() catches DB failures and never throws.
      await trace(novelId, {
        eventType: "canon-proposal-create",
        chapter: proposal.proposedFact.provenance.chapter,
        agent: "planner-canon-proposals",
        payload: {
          proposalId: proposal.id,
          source: proposal.source,
          factKind: proposal.proposedFact.kind,
          sourceItemId,
          schemaVersion,
        },
      })
    } else {
      skipped.push({
        proposalId: proposal.id,
        sourceItemId,
        reason: "already-exists",
      })
    }
  }
  // Single summary event per generate-from-outline invocation. Useful for
  // observability without scanning every per-proposal row.
  await trace(novelId, {
    eventType: "canon-proposal-generate-summary",
    agent: "planner-canon-proposals",
    payload: {
      outlinesCount: outlines.length,
      gateClear: true,
      createdCount: created.length,
      skippedCount: skipped.length,
      schemaVersion,
    },
  })
  return { created, skipped, gateReport, gateClear: true }
}

/**
 * Pipeline-boundary auto-wire: run `generatePlannerCanonProposals` against
 * the novel's persisted outlines and swallow errors so a transient DB blip
 * cannot block the planning phase from advancing to drafting. Used by
 * `runPlanningPhase` immediately after `saveChapterOutline` + `updateTotalChapters`.
 *
 * Idempotent by construction (Phase 1's deterministic id + ON CONFLICT
 * DO NOTHING). A re-run of planning produces 0 new rows even though the
 * helper fires on every planning-phase exit.
 *
 * Returns counts for the caller to log; never throws. The internal
 * `generatePlannerCanonProposals` already emits a `canon-proposal-generate-summary`
 * trace event on both gate paths, so observability is automatic — the
 * caller's log is just for stdout.
 */
export async function autogenPlannerProposalsAfterPlanning(
  novelId: string,
  outlines: readonly ChapterOutline[],
): Promise<{
  created: number
  skipped: number
  gateClear: boolean
  error: string | null
}> {
  if (outlines.length === 0) {
    return { created: 0, skipped: 0, gateClear: false, error: "no outlines" }
  }
  try {
    const result = await generatePlannerCanonProposals(novelId, outlines)
    return {
      created: result.created.length,
      skipped: result.skipped.length,
      gateClear: result.gateClear,
      error: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { created: 0, skipped: 0, gateClear: false, error: msg }
  }
}

/**
 * Convenience for consumers (review UI, smoke scripts) that just want the
 * pending planner-origin proposals for a novel without re-generating. Filters
 * `listPendingProposals` to rows whose id matches the planner deterministic
 * template (cheap string match).
 */
export async function listPendingPlannerProposals(
  novelId: string,
): Promise<readonly CanonUpdateProposal[]> {
  const all = await listPendingProposals(novelId)
  const prefix = plannerProposalPrefix(novelId)
  return all
    .filter((row) => typeof row.id === "string" && row.id.startsWith(prefix))
    .map((row) => proposalRowToProposal(row))
}

// ── Internals ────────────────────────────────────────────────────────────────

function buildProposalFromSourceItem(
  novelId: string,
  item: PlannerCanonDeltaSourceItem,
  schemaVersion: string,
  extractorVersion: string,
  createdAt: string,
): CanonUpdateProposal {
  const id = plannerProposalId(novelId, item.id, schemaVersion)
  const factKind = sourceItemFactKind(item.kind)
  const provenanceSource = sourceItemProvenanceSource(item.kind)

  return {
    id,
    source: provenanceSource,
    // Phase 1 generates net-new facts only. Supersession of existing canon
    // is an operator-driven path and goes through targetFactId; planner re-
    // runs that produce updated source items will re-use the deterministic
    // id (idempotency) rather than supersede.
    targetFactId: undefined,
    proposedFact: {
      id: item.id as CanonId,
      kind: factKind,
      text: item.text,
      data: dataPayloadFor(item, schemaVersion),
      provenance: {
        source: provenanceSource,
        chapter: item.chapterN,
        extractorVersion,
        confidence: undefined,
        origin: "planned",
        // `supersedes` left undefined — Phase 1 doesn't author supersession;
        // the operator does it via a separate proposal with targetFactId.
        supersedes: undefined,
      },
    },
    status: "pending",
    createdAt,
  }
}

/** Map source-item kind → CanonFact.kind. */
function sourceItemFactKind(kind: PlannerCanonDeltaSourceItem["kind"]): FactKind {
  switch (kind) {
    case "fact":
      return "established_fact"
    case "knowledge":
      return "knowledge_change"
    case "state":
      return "character_state"
  }
}

/**
 * Map source-item kind → ProvenanceSource. Per the Phase 1 spec:
 *
 *   - `fact` rows come out of the planner directly → `planner-output`.
 *   - `knowledge` and `state` rows come out of the state-mapping pass
 *     (`planning-state-mapper` agent) → `planning-state-mapper`.
 *
 * The distinction matters for downstream calibration — `planner-output`
 * and `planning-state-mapper` may have different precision/recall floors
 * once Step 2's source-quality gate lands.
 */
function sourceItemProvenanceSource(
  kind: PlannerCanonDeltaSourceItem["kind"],
): ProvenanceSource {
  return kind === "fact" ? "planner-output" : "planning-state-mapper"
}

/** Build the kind-dependent `data` payload preserved on the CanonFact. */
function dataPayloadFor(
  item: PlannerCanonDeltaSourceItem,
  schemaVersion: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    sourceItemId: item.id,
    sourceItemKind: item.kind,
    schemaVersion,
  }
  if (item.kind === "fact") {
    if (item.category) base.category = item.category
    return base
  }
  if (item.kind === "knowledge") {
    if (item.characterId) base.characterId = item.characterId
    if (item.characterName) base.characterName = item.characterName
    return base
  }
  // state
  if (item.characterId) base.characterId = item.characterId
  if (item.characterName) base.characterName = item.characterName
  // The audit's `text` summarizes location/emotion/knows/doesNotKnow; we
  // keep the summary on `text` and store the structured fields on `data`.
  // The PlannerCanonDeltaSourceItem doesn't carry the structured fields
  // (it carries only the summarized `text`), so we don't have them here.
  // Callers that need the structured payload will read from the underlying
  // ChapterOutline directly. Phase 2+ may extend the audit's source-item
  // shape to carry them; out of scope for Phase 1.
  return base
}

/**
 * Deterministic proposal id for planner-origin proposals. Format:
 *
 *   planner:<novelId>:<sourceItemId>:<schemaVersion>
 *
 * Components:
 *   - `planner:` prefix — identifies the proposal source family for
 *     filtering / observability.
 *   - `<novelId>` — primary-key namespace (canon_proposals.id is globally
 *     unique).
 *   - `<sourceItemId>` — the planner's stable kebab-case id.
 *   - `<schemaVersion>` — bumps to invalidate prior proposals when the
 *     payload shape changes.
 *
 * The id IS the idempotency key; `insertProposalIfAbsent` uses
 * `ON CONFLICT (id) DO NOTHING`.
 */
export function plannerProposalId(
  novelId: string,
  sourceItemId: string,
  schemaVersion: string = PLANNER_PROPOSAL_SCHEMA_VERSION,
): string {
  return `planner:${novelId}:${sourceItemId}:${schemaVersion}`
}

/** Prefix used by `listPendingPlannerProposals` to filter to planner-origin rows. */
export function plannerProposalPrefix(novelId: string): string {
  return `planner:${novelId}:`
}

// Local hydration helper — the canon-substrate row mapper is colocated with
// the DB module; we re-shape ProposalRow into CanonUpdateProposal here so
// callers don't depend on the DB-row type.
function proposalRowToProposal(row: {
  id: string
  source: string
  target_logical_id: string | null
  proposed_payload: unknown
  modified_payload: unknown
  status: string
  operator_note: string | null
  created_at: string | Date
  resolved_at: string | Date | null
}): CanonUpdateProposal {
  const proposed = (
    typeof row.proposed_payload === "string"
      ? JSON.parse(row.proposed_payload)
      : row.proposed_payload
  ) as CanonUpdateProposal["proposedFact"]
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  const proposal: CanonUpdateProposal = {
    id: row.id,
    source: row.source as ProvenanceSource,
    proposedFact: proposed,
    status: row.status as CanonUpdateProposal["status"],
    createdAt,
  }
  if (row.target_logical_id != null) proposal.targetFactId = row.target_logical_id
  if (row.operator_note != null) proposal.operatorNote = row.operator_note
  if (row.modified_payload != null) {
    const modified = typeof row.modified_payload === "string"
      ? JSON.parse(row.modified_payload as string)
      : row.modified_payload
    proposal.modifiedFact = modified as CanonFact
  }
  if (row.resolved_at != null) {
    proposal.resolvedAt =
      row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : row.resolved_at
  }
  return proposal
}
