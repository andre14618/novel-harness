/**
 * Postgres-backed CanonSubstrate — production adapter behind src/canon/api.ts.
 *
 * Charter: docs/charters/world-bible-architecture.md §1
 * Design:  docs/designs/canon-substrate-step1.md
 * Lane:    docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md
 *
 * Mirrors `InMemoryCanonSubstrate` behavior exactly so the same behavioral
 * spec passes against both adapters (see `src/canon/substrate-equivalence.test.ts`).
 *
 * Sync-reads + async-writes contract:
 *
 *   - Read methods are SYNC because `assembleL1` is sync (deterministic-bundle
 *     property). Calling a sync read for an unloaded `(novelId, chapterN)`
 *     throws — the caller must `loadSnapshot` first.
 *   - Write methods (`proposeCanonUpdate`, `resolveProposal`) are async; they
 *     do DB round-trips and bump the snapshot generation counter.
 *   - After any write, the in-process snapshot cache for that novel is
 *     INVALIDATED. Callers that read at chapter N and then commit must call
 *     `loadSnapshot(novelId, N)` again to pick up the new version. This is
 *     intentionally explicit — silent re-load would hide the cache cost.
 *
 * **Atomicity contract (Codex round-2 hardening of `ba72e09`):** every write
 * that touches more than one DB row — proposal resolution + canon commit +
 * generation bump, or seed* commit + generation bump — runs inside a single
 * `db.begin(async (tx) => { ... })` block. A crash or DB error at any step
 * rolls back the whole sequence rather than leaving a proposal marked
 * `approved` with no canon row, or an old fact superseded with no
 * replacement. The `db/canon-substrate.ts` helpers all accept an optional
 * `executor` parameter so the harness can pass the transaction handle
 * through.
 *
 * No SQL lives in this file. Raw queries are in `src/db/canon-substrate.ts`.
 */

import db from "../db/connection"
import * as canonDb from "../db/canon-substrate"
import { trace } from "../trace"
import type { CanonSource } from "../canon/bundle"
import type {
  ApprovalStatus,
  CanonFact,
  CanonId,
  CanonUpdateProposal,
  CharacterState,
  Entity,
  ProposalStatus,
  Provenance,
  StoryPromise,
} from "../canon/api"
import type { CanonSubstrate, ProposalInput } from "../canon/substrate"

// ── Snapshot cache shape ─────────────────────────────────────────────────────

interface ChapterSnapshot {
  facts: readonly CanonFact[]
  entities: readonly Entity[]
  characterStates: readonly CharacterState[]
  promises: readonly StoryPromise[]
}

const COMMITTED_STATUSES: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>([
  "human-approved",
  "human-edited",
])

function assertCommittedApproval(status: ApprovalStatus, kind: string): void {
  if (!COMMITTED_STATUSES.has(status)) {
    throw new Error(
      `${kind}: approvalStatus="${status}" is not a committed status; only human-approved or human-edited can enter the substrate as canon (no ghost canon)`,
    )
  }
}

// ── PostgresCanonSubstrate ───────────────────────────────────────────────────

/**
 * Production substrate backed by sql/035_canon_substrate.sql tables. Satisfies
 * `CanonSubstrate` (and therefore `CanonSource`).
 *
 * Usage:
 *   const sub = new PostgresCanonSubstrate()
 *   await sub.loadSnapshot(novelId, chapterN)        // async, populates cache
 *   const facts = sub.factsAsOfChapter(novelId, chapterN)  // sync from cache
 *   await sub.proposeCanonUpdate(novelId, proposal)  // async write; invalidates cache
 *   await sub.loadSnapshot(novelId, chapterN)        // re-load after commit
 */
export class PostgresCanonSubstrate implements CanonSubstrate {
  private readonly snapshotCache = new Map<string, ChapterSnapshot>()
  // Generation cache so snapshotVersion() can be sync. Refreshed on every
  // loadSnapshot call (cheap query) and on every write.
  private readonly generationCache = new Map<string, number>()
  private nextProposalSeq = 1

  // ── Snapshot load (call before any sync read) ──────────────────────────────

  async loadSnapshot(novelId: string, chapterN: number): Promise<void> {
    const [factRows, entityRows, stateRows, promiseRows, generation] =
      await Promise.all([
        canonDb.loadFactsSnapshot(novelId, chapterN),
        canonDb.loadEntitiesSnapshot(novelId, chapterN),
        canonDb.loadCharacterStatesSnapshot(novelId, chapterN),
        canonDb.loadPromisesSnapshot(novelId, chapterN),
        canonDb.readGeneration(novelId),
      ])
    this.snapshotCache.set(this.cacheKey(novelId, chapterN), {
      facts: factRows.map(canonDb.factFromRow),
      entities: entityRows.map(canonDb.entityFromRow),
      characterStates: stateRows.map(canonDb.characterStateFromRow),
      promises: promiseRows.map(canonDb.promiseFromRow),
    })
    this.generationCache.set(novelId, generation)
  }

  /**
   * Drop a cached snapshot. Useful after writes that may have changed canon
   * for that (novelId, chapterN). Tests also call this to force a re-load.
   */
  invalidateSnapshot(novelId: string, chapterN?: number): void {
    if (chapterN === undefined) {
      // Clear all chapters for this novel.
      for (const key of [...this.snapshotCache.keys()]) {
        if (key.startsWith(`${novelId}@`)) this.snapshotCache.delete(key)
      }
      return
    }
    this.snapshotCache.delete(this.cacheKey(novelId, chapterN))
  }

  // ── Read side (CanonSource) — sync ─────────────────────────────────────────

  factsAsOfChapter(novelId: string, chapterN: number): readonly CanonFact[] {
    return this.requireSnapshot(novelId, chapterN).facts.filter((f) =>
      COMMITTED_STATUSES.has(f.provenance.approvalStatus),
    )
  }

  entitiesAsOfChapter(novelId: string, chapterN: number): readonly Entity[] {
    return this.requireSnapshot(novelId, chapterN).entities.filter((e) =>
      COMMITTED_STATUSES.has(e.provenance.approvalStatus),
    )
  }

  characterStatesAsOfChapter(
    novelId: string,
    chapterN: number,
  ): readonly CharacterState[] {
    return this.requireSnapshot(novelId, chapterN).characterStates.filter((s) =>
      COMMITTED_STATUSES.has(s.provenance.approvalStatus),
    )
  }

  promisesAsOfChapter(
    novelId: string,
    chapterN: number,
  ): readonly StoryPromise[] {
    return this.requireSnapshot(novelId, chapterN).promises.filter((p) =>
      COMMITTED_STATUSES.has(p.provenance.approvalStatus),
    )
  }

  snapshotVersion(novelId: string): string {
    return `${novelId}@${this.generationCache.get(novelId) ?? 0}`
  }

  // ── Write side (proposal/commit lifecycle) — async ─────────────────────────

  async proposeCanonUpdate(
    novelId: string,
    proposal: ProposalInput,
  ): Promise<CanonUpdateProposal> {
    const id = `proposal-${Date.now()}-${this.nextProposalSeq++}`
    const createdAt = new Date().toISOString()
    await canonDb.insertProposal({
      id,
      novelId,
      source: proposal.source,
      targetLogicalId: proposal.targetFactId ?? null,
      proposedPayload: proposal.proposedFact,
      status: "pending",
      operatorNote: proposal.operatorNote ?? null,
      createdAt,
    })
    await trace(novelId, {
      eventType: "canon-proposal-create",
      chapter: proposal.proposedFact.provenance.chapter,
      agent: "canon-substrate",
      payload: {
        proposalId: id,
        source: proposal.source,
        factKind: proposal.proposedFact.kind,
        factId: proposal.proposedFact.id,
        targetFactId: proposal.targetFactId ?? null,
      },
    })
    return {
      ...proposal,
      id,
      status: "pending",
      createdAt,
    }
  }

  async resolveProposal(
    proposalId: string,
    status: Exclude<ProposalStatus, "pending">,
    opts?: { modifiedFact?: CanonFact; operatorNote?: string },
  ): Promise<{ committedFact?: CanonFact }> {
    // Validate inputs BEFORE the transaction so we don't churn the DB on a
    // call that was malformed at the API boundary.
    if (status === "modified" && !opts?.modifiedFact) {
      throw new Error(
        `resolveProposal: status="modified" requires opts.modifiedFact`,
      )
    }
    // Snapshot the proposal row outside the transaction to validate the
    // status check and decide the path. The transaction below re-validates
    // by calling updateProposalResolution with the `WHERE status = 'pending'`
    // guard — that's the binding check.
    const row = await canonDb.findProposal(proposalId)
    if (!row) throw new Error(`resolveProposal: unknown proposalId ${proposalId}`)
    if (row.status !== "pending") {
      throw new Error(
        `resolveProposal: proposal ${proposalId} already ${row.status}`,
      )
    }
    const proposal = canonDb.proposalFromRow(row)
    const novelId = row.novel_id
    const resolvedAt = new Date().toISOString()

    let committedFact: CanonFact | undefined

    // Atomic commit/resolution: proposal status update + canon write +
    // generation bump must all succeed or all roll back. Codex round-2 HIGH:
    // a crash between any pair of these would leave the substrate
    // inconsistent (proposal approved with no canon row, or old fact
    // superseded with no replacement).
    await db.begin(async (tx: typeof db) => {
      if (status === "rejected") {
        await canonDb.updateProposalResolution({
          id: proposalId,
          status: "rejected",
          resolvedAt,
          operatorNote: opts?.operatorNote ?? null,
          modifiedPayload: null,
        }, tx)
        await canonDb.bumpGeneration(novelId, tx)
        return
      }

      const factToCommit = normalizeForCommit(proposal, status, opts)
      await canonDb.updateProposalResolution({
        id: proposalId,
        status,
        resolvedAt,
        operatorNote: opts?.operatorNote ?? null,
        modifiedPayload: status === "modified" && opts?.modifiedFact
          ? opts.modifiedFact
          : null,
      }, tx)
      await this.commitFact(novelId, factToCommit, proposal.targetFactId, tx)
      await canonDb.bumpGeneration(novelId, tx)
      committedFact = factToCommit
    })

    // Cache invalidation + generation refresh happen AFTER the transaction
    // commits so we never reflect uncommitted DB state in the in-process
    // cache. If the transaction throws, the cache stays at its prior value.
    this.invalidateSnapshot(novelId)
    this.generationCache.set(novelId, await canonDb.readGeneration(novelId))

    // Telemetry — fired AFTER the transaction commits so the event reflects
    // durable state. Captures the resolution outcome for observability.
    await trace(novelId, {
      eventType: "canon-proposal-resolve",
      chapter: committedFact?.provenance.chapter ?? proposal.proposedFact.provenance.chapter,
      agent: "canon-substrate",
      payload: {
        proposalId,
        status,
        factId: committedFact?.id ?? null,
        targetFactId: proposal.targetFactId ?? null,
        operatorNote: opts?.operatorNote ?? null,
      },
    })

    return committedFact ? { committedFact } : {}
  }

  async listPendingProposals(
    novelId: string,
  ): Promise<readonly CanonUpdateProposal[]> {
    const rows = await canonDb.listPendingProposals(novelId)
    return rows.map(canonDb.proposalFromRow)
  }

  // ── Test helpers — direct seeding (mirrors InMemoryCanonSubstrate) ─────────
  //
  // Each seed method is one transaction: commitXxx (which may issue a
  // markSuperseded UPDATE plus an INSERT) + bumpGeneration. A crash between
  // them would leave the prior version closed with no replacement, or a new
  // row in canon_* with no generation bump (the snapshot version cache would
  // miss the change). All-or-nothing.

  async seedFact(novelId: string, fact: CanonFact): Promise<void> {
    assertCommittedApproval(fact.provenance.approvalStatus, "seedFact")
    await db.begin(async (tx: typeof db) => {
      await this.commitFact(novelId, fact, fact.provenance.supersedes, tx)
      await canonDb.bumpGeneration(novelId, tx)
    })
    this.invalidateSnapshot(novelId)
    this.generationCache.set(novelId, await canonDb.readGeneration(novelId))
  }

  async seedEntity(novelId: string, entity: Entity): Promise<void> {
    assertCommittedApproval(entity.provenance.approvalStatus, "seedEntity")
    await db.begin(async (tx: typeof db) => {
      await this.commitEntity(novelId, entity, tx)
      await canonDb.bumpGeneration(novelId, tx)
    })
    this.invalidateSnapshot(novelId)
    this.generationCache.set(novelId, await canonDb.readGeneration(novelId))
  }

  async seedCharacterState(
    novelId: string,
    state: CharacterState,
  ): Promise<void> {
    assertCommittedApproval(state.provenance.approvalStatus, "seedCharacterState")
    await db.begin(async (tx: typeof db) => {
      await this.commitState(novelId, state, tx)
      await canonDb.bumpGeneration(novelId, tx)
    })
    this.invalidateSnapshot(novelId)
    this.generationCache.set(novelId, await canonDb.readGeneration(novelId))
  }

  async seedStoryPromise(
    novelId: string,
    promise: StoryPromise,
  ): Promise<void> {
    assertCommittedApproval(promise.provenance.approvalStatus, "seedStoryPromise")
    await db.begin(async (tx: typeof db) => {
      await this.commitPromise(novelId, promise, tx)
      await canonDb.bumpGeneration(novelId, tx)
    })
    this.invalidateSnapshot(novelId)
    this.generationCache.set(novelId, await canonDb.readGeneration(novelId))
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private cacheKey(novelId: string, chapterN: number): string {
    return `${novelId}@${chapterN}`
  }

  private requireSnapshot(novelId: string, chapterN: number): ChapterSnapshot {
    const snap = this.snapshotCache.get(this.cacheKey(novelId, chapterN))
    if (!snap) {
      throw new Error(
        `PostgresCanonSubstrate: snapshot not loaded for ${novelId}@chapter=${chapterN}. ` +
          `Call loadSnapshot(novelId, chapterN) before sync reads. This is the async-loader + ` +
          `sync-snapshot-wrapper pattern documented in docs/designs/canon-substrate-step1.md ` +
          `§"Sync reads + async writes".`,
      )
    }
    return snap
  }

  /**
   * Mirror of `InMemoryCanonSubstrate.commitFact`:
   *   1. Always close the new logical id's prior active version (same-id
   *      always-supersede invariant; Codex H2).
   *   2. If supersedesLogicalId is set and != fact.id, ALSO close the
   *      cross-id chain's active version (cross-id supersession is ADDITIVE,
   *      not else-branched).
   *   3. Insert the new version at version = max(version) + 1 for fact.id.
   *
   * `executor` is the transaction handle from the caller's `db.begin` block.
   * The maxFactVersion read joins the same transaction so the version we
   * compute is consistent with the supersession + insert.
   */
  private async commitFact(
    novelId: string,
    fact: CanonFact,
    supersedesLogicalId: CanonId | undefined,
    executor: typeof db,
  ): Promise<void> {
    const nextVersion = (await canonDb.maxFactVersion(novelId, fact.id, executor)) + 1
    const atChapter = fact.provenance.chapter
    // Always close same-id active version, if any.
    await canonDb.markFactSuperseded(novelId, fact.id, nextVersion, atChapter, executor)
    // Additive cross-id close.
    if (supersedesLogicalId && supersedesLogicalId !== fact.id) {
      await canonDb.markFactSuperseded(
        novelId,
        supersedesLogicalId,
        nextVersion,
        atChapter,
        executor,
      )
    }
    await canonDb.insertFact({ novelId, fact, version: nextVersion }, executor)
  }

  /**
   * Mirror of `InMemoryCanonSubstrate.commitEntity` — same-id close only.
   *
   * The in-memory adapter does NOT close cross-id chains for entities; the
   * `provenance.supersedes` field on Entity/CharacterState/StoryPromise is
   * documented in api.ts as load-bearing for CanonFact only. The earlier
   * Postgres adapter had a cross-id branch here (and on commitPromise) that
   * the in-memory adapter lacked, which would cause behavior to diverge
   * once an entity carrying a non-empty `provenance.supersedes` was seeded.
   * Codex round-2 caught the divergence; we drop the cross-id branch here
   * to match the in-memory model. If a future requirement needs cross-id
   * supersession for non-fact types, the proposal lifecycle for those types
   * lands first (it currently only handles facts).
   */
  private async commitEntity(
    novelId: string,
    entity: Entity,
    executor: typeof db,
  ): Promise<void> {
    const nextVersion = (await canonDb.maxEntityVersion(novelId, entity.id, executor)) + 1
    const atChapter = entity.provenance.chapter
    await canonDb.markEntitySuperseded(novelId, entity.id, nextVersion, atChapter, executor)
    await canonDb.insertEntity({ novelId, entity, version: nextVersion }, executor)
  }

  /** Same-id close only — CharacterState has no cross-id supersession concept. */
  private async commitState(
    novelId: string,
    state: CharacterState,
    executor: typeof db,
  ): Promise<void> {
    const nextVersion =
      (await canonDb.maxCharacterStateVersion(novelId, state.characterId, executor)) + 1
    const atChapter = state.provenance.chapter
    await canonDb.markCharacterStateSuperseded(
      novelId,
      state.characterId,
      nextVersion,
      atChapter,
      executor,
    )
    await canonDb.insertCharacterState({ novelId, state, version: nextVersion }, executor)
  }

  /**
   * Mirror of `InMemoryCanonSubstrate.commitPromise` — same-id close only.
   * See `commitEntity` for the rationale; cross-id supersession is fact-only
   * in §1.
   */
  private async commitPromise(
    novelId: string,
    promise: StoryPromise,
    executor: typeof db,
  ): Promise<void> {
    const nextVersion =
      (await canonDb.maxPromiseVersion(novelId, promise.id, executor)) + 1
    const atChapter = promise.provenance.chapter
    await canonDb.markPromiseSuperseded(
      novelId,
      promise.id,
      nextVersion,
      atChapter,
      executor,
    )
    await canonDb.insertPromise({ novelId, promise, version: nextVersion }, executor)
  }
}

// ── Shared normalize-on-commit helper ────────────────────────────────────────
//
// Same shape as `InMemoryCanonSubstrate.normalizeForCommit` — both adapters
// must enforce identical commit-time provenance normalization so the modified
// path can't smuggle raw operator-supplied provenance into canon.

function normalizeForCommit(
  proposal: CanonUpdateProposal,
  status: Exclude<ProposalStatus, "pending" | "rejected">,
  opts?: { modifiedFact?: CanonFact },
): CanonFact {
  const sourceFact: CanonFact | CanonUpdateProposal["proposedFact"] =
    status === "modified" && opts?.modifiedFact
      ? opts.modifiedFact
      : proposal.proposedFact
  const approvalStatus: ApprovalStatus =
    status === "modified" ? "human-edited" : "human-approved"
  const now = new Date().toISOString()
  const provenance: Provenance = {
    ...sourceFact.provenance,
    approvalStatus,
    createdAt: now,
    updatedAt: now,
    supersedes:
      proposal.targetFactId ?? sourceFact.provenance.supersedes,
  }
  return {
    id: sourceFact.id,
    kind: sourceFact.kind,
    text: sourceFact.text,
    data: sourceFact.data,
    provenance,
  }
}
