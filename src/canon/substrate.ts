/**
 * Canon Substrate — the seam behind src/canon/api.ts.
 *
 * Charter: docs/charters/world-bible-architecture.md §1
 * Design:  docs/designs/canon-substrate-step1.md
 * Lane:    docs/sessions/2026-05-03-canon-substrate-step-1-design.md
 *
 * The substrate holds operator-committed Canon and exposes:
 *
 *   - read methods that satisfy `bundle.ts`'s `CanonSource` interface
 *     (committed-only by construction; point-in-time at chapter N),
 *   - the proposal/commit lifecycle that prevents pending or rejected
 *     canon from leaking into reads (the no-ghost-canon rule).
 *
 * This file ships the interface and an in-memory adapter only. The
 * Postgres-backed adapter lives in src/db/canon-substrate.ts and the
 * service-layer wrapper lives in src/harness/canon-substrate.ts —
 * both written in a follow-on session once the seam stabilizes.
 */

import type {
  ApprovalStatus,
  CanonFact,
  CanonId,
  CanonUpdateProposal,
  CharacterState,
  Entity,
  ProposalStatus,
  Provenance,
  ProvenanceSource,
  StoryPromise,
} from "./api"
import type { CanonSource } from "./bundle"

// ── Interface ────────────────────────────────────────────────────────────────

/**
 * Substrate-level read + write surface. Read methods compose `CanonSource`
 * (committed-only by construction at this layer). Write methods carry the
 * proposal/commit lifecycle.
 *
 * Production: src/db/canon-substrate.ts + src/harness/canon-substrate.ts.
 * Tests: InMemoryCanonSubstrate below.
 *
 * **Sync-reads + async-writes contract**: the read methods inherited from
 * `CanonSource` are sync because `assembleL1` is sync (the deterministic-
 * bundle property is reasoned about as pure-function-over-snapshot). The
 * Postgres adapter satisfies this with the async-loader + sync-snapshot-
 * wrapper pattern: `loadSnapshot(novelId, chapterN)` is async and populates
 * an in-process cache; the four sync read methods serve from the cache and
 * throw if the snapshot has not been loaded. See
 * `docs/designs/canon-substrate-step1.md` §"Sync reads + async writes" for
 * the full contract and the test it implies.
 */
export interface CanonSubstrate extends CanonSource {
  /**
   * Record a candidate canon change. The proposal is `pending` until
   * resolved; pending proposals are NEVER visible from the read methods.
   */
  proposeCanonUpdate(
    novelId: string,
    proposal: ProposalInput,
  ): Promise<CanonUpdateProposal>

  /**
   * Adjudicate a pending proposal. On `approved` or `modified` the substrate
   * commits the canon record, bumps the snapshot generation, and (if the
   * proposal targets an existing logical id) supersedes the prior version.
   * On `rejected` the proposal is closed without writing canon.
   */
  resolveProposal(
    proposalId: string,
    status: Exclude<ProposalStatus, "pending">,
    opts?: {
      modifiedFact?: CanonFact
      operatorNote?: string
      /**
       * Phase 6 commit 4: audit-trail metadata. The harness substrate
       * persists these alongside `status` so Phase 7's replay harness can
       * compare what the policy decided vs. what the operator decided. The
       * InMemory adapter stores them on the proposal record for parity but
       * doesn't otherwise act on them.
       */
      resolvedByKind?: "human" | "policy" | "script" | "test"
      policyDecision?: "queue" | "approve" | "reject" | "shadow"
      policyVersion?: string
      policyReasons?: ReadonlyArray<string>
    },
  ): Promise<{ committedFact?: CanonFact }>

  /** Operator-facing — list pending proposals. NEVER feeds reads. */
  listPendingProposals(novelId: string): Promise<readonly CanonUpdateProposal[]>
}

/**
 * Shape callers pass to `proposeCanonUpdate`. Mirrors `CanonUpdateProposal`
 * minus fields the substrate fills in (id, status, createdAt).
 */
export type ProposalInput = Omit<
  CanonUpdateProposal,
  "id" | "status" | "createdAt"
>

// ── In-memory adapter ────────────────────────────────────────────────────────

/**
 * In-memory CanonSubstrate. Used by tests and any future fixture-driven
 * dev workflow. Not for production — Postgres adapter ships separately.
 *
 * Storage shape:
 *   - factsByNovel[novelId][logicalId] = ordered list of CanonFact versions
 *     (length-N array; index = version-1; only committed records stored)
 *   - same shape for entities, character states (logicalId = characterId),
 *     and promises
 *   - proposalsByNovel[novelId] = list of CanonUpdateProposal (pending +
 *     resolved); reads filter by status
 *   - snapshotGen[novelId] = monotonic counter, bumped on every commit/reject
 */
export class InMemoryCanonSubstrate implements CanonSubstrate {
  private readonly factsByNovel = new Map<string, Map<CanonId, CommittedFact[]>>()
  private readonly entitiesByNovel = new Map<string, Map<CanonId, CommittedEntity[]>>()
  private readonly statesByNovel = new Map<string, Map<string, CommittedState[]>>()
  private readonly promisesByNovel = new Map<string, Map<CanonId, CommittedPromise[]>>()
  private readonly proposalsByNovel = new Map<string, StoredCanonUpdateProposal[]>()
  private readonly snapshotGen = new Map<string, number>()
  private nextProposalId = 1

  // ── Read side (CanonSource) ────────────────────────────────────────────────

  factsAsOfChapter(novelId: string, chapterN: number): readonly CanonFact[] {
    return collectCurrentVersions(this.factsByNovel.get(novelId), chapterN)
  }

  entitiesAsOfChapter(novelId: string, chapterN: number): readonly Entity[] {
    return collectCurrentVersions(this.entitiesByNovel.get(novelId), chapterN)
  }

  characterStatesAsOfChapter(
    novelId: string,
    chapterN: number,
  ): readonly CharacterState[] {
    return collectCurrentVersions(this.statesByNovel.get(novelId), chapterN)
  }

  promisesAsOfChapter(novelId: string, chapterN: number): readonly StoryPromise[] {
    return collectCurrentVersions(this.promisesByNovel.get(novelId), chapterN)
  }

  snapshotVersion(novelId: string): string {
    return `${novelId}@${this.snapshotGen.get(novelId) ?? 0}`
  }

  // ── Write side (proposal/commit) ───────────────────────────────────────────

  async proposeCanonUpdate(
    novelId: string,
    proposal: ProposalInput,
  ): Promise<CanonUpdateProposal> {
    const id = `proposal-${this.nextProposalId++}`
    const record: StoredCanonUpdateProposal = {
      ...proposal,
      id,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    const list = this.proposalsByNovel.get(novelId) ?? []
    list.push(record)
    this.proposalsByNovel.set(novelId, list)
    return record
  }

  async resolveProposal(
    proposalId: string,
    status: Exclude<ProposalStatus, "pending">,
    opts?: {
      modifiedFact?: CanonFact
      operatorNote?: string
      resolvedByKind?: "human" | "policy" | "script" | "test"
      policyDecision?: "queue" | "approve" | "reject" | "shadow"
      policyVersion?: string
      policyReasons?: ReadonlyArray<string>
    },
  ): Promise<{ committedFact?: CanonFact }> {
    // Validate inputs BEFORE mutating proposal state — a half-applied
    // resolveProposal that throws after mutating the proposal but before
    // committing canon would leave the proposal in an inconsistent state.
    if (status === "modified" && !opts?.modifiedFact) {
      throw new Error(
        `resolveProposal: status="modified" requires opts.modifiedFact`,
      )
    }
    const found = this.findProposal(proposalId)
    if (!found) throw new Error(`resolveProposal: unknown proposalId ${proposalId}`)
    const { novelId, proposal } = found
    if (proposal.status !== "pending") {
      throw new Error(
        `resolveProposal: proposal ${proposalId} already ${proposal.status}`,
      )
    }

    proposal.status = status
    proposal.resolvedAt = new Date().toISOString()
    proposal.operatorNote = opts?.operatorNote ?? proposal.operatorNote
    proposal.resolvedByKind = opts?.resolvedByKind
    proposal.policyDecision = opts?.policyDecision
    proposal.policyVersion = opts?.policyVersion
    proposal.policyReasons = opts?.policyReasons

    if (status === "rejected") {
      // No canon write. Bump generation so consumers that cache snapshots
      // can detect any state change.
      this.bumpGeneration(novelId)
      return {}
    }

    // Approved or modified: route both through the same normalization
    // helper. The helper enforces committed provenance (approvalStatus,
    // createdAt, updatedAt) and normalizes supersedes from the proposal's
    // targetFactId, so the modified path can't ship raw operator-supplied
    // provenance into canon.
    const factToCommit = this.normalizeForCommit(proposal, status, opts)
    if (status === "modified" && opts?.modifiedFact) {
      // Persist on the proposal record for audit. This is what the operator
      // submitted; the canon record is what ended up committed (same shape,
      // but provenance was normalized).
      proposal.modifiedFact = opts.modifiedFact
    }

    const committed = this.commitFact(novelId, factToCommit, proposal.targetFactId)
    this.bumpGeneration(novelId)
    return { committedFact: committed }
  }

  async listPendingProposals(
    novelId: string,
  ): Promise<readonly CanonUpdateProposal[]> {
    return (this.proposalsByNovel.get(novelId) ?? []).filter(
      (p) => p.status === "pending",
    )
  }

  // ── Test helpers (not part of CanonSubstrate) ──────────────────────────────

  /**
   * Seed a committed canon record directly. For tests that want to skip the
   * proposal/commit dance and exercise read-side behavior. The fact's
   * provenance.approvalStatus must already be a committed status
   * (human-approved or human-edited); otherwise a write through this method
   * would by definition be ghost canon.
   */
  seedFact(novelId: string, fact: CanonFact): void {
    assertCommittedApproval(fact.provenance.approvalStatus, "fact")
    this.commitFact(novelId, fact, fact.provenance.supersedes)
    this.bumpGeneration(novelId)
  }

  seedEntity(novelId: string, entity: Entity): void {
    assertCommittedApproval(entity.provenance.approvalStatus, "entity")
    this.commitEntity(novelId, entity)
    this.bumpGeneration(novelId)
  }

  seedCharacterState(novelId: string, state: CharacterState): void {
    assertCommittedApproval(state.provenance.approvalStatus, "characterState")
    this.commitState(novelId, state)
    this.bumpGeneration(novelId)
  }

  seedStoryPromise(novelId: string, promise: StoryPromise): void {
    assertCommittedApproval(promise.provenance.approvalStatus, "storyPromise")
    this.commitPromise(novelId, promise)
    this.bumpGeneration(novelId)
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private findProposal(
    proposalId: string,
  ): { novelId: string; proposal: StoredCanonUpdateProposal } | null {
    for (const [novelId, list] of this.proposalsByNovel) {
      const proposal = list.find((p) => p.id === proposalId)
      if (proposal) return { novelId, proposal }
    }
    return null
  }

  private bumpGeneration(novelId: string): void {
    this.snapshotGen.set(novelId, (this.snapshotGen.get(novelId) ?? 0) + 1)
  }

  /**
   * Normalize proposal payload into a committable CanonFact. Both the
   * `approved` and `modified` paths route through here so neither can ship
   * raw operator-supplied provenance into canon.
   *
   * - approved: uses `proposal.proposedFact` body
   * - modified: uses `opts.modifiedFact` body (must be present — caller
   *   already validated)
   * - both: forces approvalStatus, createdAt, updatedAt; normalizes
   *   `supersedes` from `proposal.targetFactId` (falls back to whatever the
   *   source provenance already had if no targetFactId is set, which lets
   *   "fresh fact, no supersession" cases stay null).
   */
  private normalizeForCommit(
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

  private commitFact(
    novelId: string,
    fact: CanonFact,
    supersedesLogicalId: CanonId | undefined,
  ): CanonFact {
    const map = this.factsByNovel.get(novelId) ?? new Map<CanonId, CommittedFact[]>()
    const existing = map.get(fact.id) ?? []
    const previousSameId = existing.length
      ? existing[existing.length - 1]
      : undefined

    // Invariant: at most one currently-active version per logical id. Always
    // supersede the prior active version of the new logical id (if any).
    if (previousSameId && previousSameId.supersededAtChapter == null) {
      previousSameId.supersededAtChapter = fact.provenance.chapter
    }

    // Cross-id supersession is ADDITIVE — when a new fact replaces a fact
    // with a different canonical id, both chains need their active version
    // closed. Previously this was an else-branch, so a cross-id commit
    // against a new id that already had an active version left two active
    // versions — invariant violation flagged by Codex H2.
    if (supersedesLogicalId && supersedesLogicalId !== fact.id) {
      this.markSuperseded(map, supersedesLogicalId, fact.provenance.chapter)
    }

    const committed: CommittedFact = {
      ...fact,
      committedAtChapter: fact.provenance.chapter,
      supersededAtChapter: undefined,
    }
    existing.push(committed)
    map.set(fact.id, existing)
    this.factsByNovel.set(novelId, map)
    return fact
  }

  private commitEntity(novelId: string, entity: Entity): void {
    const map =
      this.entitiesByNovel.get(novelId) ?? new Map<CanonId, CommittedEntity[]>()
    const existing = map.get(entity.id) ?? []
    const previous = existing.length ? existing[existing.length - 1] : undefined
    if (previous && previous.supersededAtChapter == null) {
      previous.supersededAtChapter = entity.provenance.chapter
    }
    existing.push({
      ...entity,
      committedAtChapter: entity.provenance.chapter,
      supersededAtChapter: undefined,
    })
    map.set(entity.id, existing)
    this.entitiesByNovel.set(novelId, map)
  }

  private commitState(novelId: string, state: CharacterState): void {
    const map =
      this.statesByNovel.get(novelId) ?? new Map<string, CommittedState[]>()
    // Logical id = characterId (states don't have their own canonical id).
    const existing = map.get(state.characterId) ?? []
    const previous = existing.length ? existing[existing.length - 1] : undefined
    if (previous && previous.supersededAtChapter == null) {
      previous.supersededAtChapter = state.provenance.chapter
    }
    existing.push({
      ...state,
      committedAtChapter: state.provenance.chapter,
      supersededAtChapter: undefined,
    })
    map.set(state.characterId, existing)
    this.statesByNovel.set(novelId, map)
  }

  private commitPromise(novelId: string, promise: StoryPromise): void {
    const map =
      this.promisesByNovel.get(novelId) ?? new Map<CanonId, CommittedPromise[]>()
    const existing = map.get(promise.id) ?? []
    const previous = existing.length ? existing[existing.length - 1] : undefined
    if (previous && previous.supersededAtChapter == null) {
      previous.supersededAtChapter = promise.provenance.chapter
    }
    existing.push({
      ...promise,
      committedAtChapter: promise.provenance.chapter,
      supersededAtChapter: undefined,
    })
    map.set(promise.id, existing)
    this.promisesByNovel.set(novelId, map)
  }

  private markSuperseded(
    map: Map<CanonId, CommittedFact[]>,
    logicalId: CanonId,
    atChapter: number,
  ): void {
    const list = map.get(logicalId)
    if (!list) return
    const last = list[list.length - 1]
    if (last && last.supersededAtChapter == null) {
      last.supersededAtChapter = atChapter
    }
  }
}

// ── Internal record shapes ───────────────────────────────────────────────────

type StoredCanonUpdateProposal = CanonUpdateProposal & {
  resolvedByKind?: "human" | "policy" | "script" | "test"
  policyDecision?: "queue" | "approve" | "reject" | "shadow"
  policyVersion?: string
  policyReasons?: ReadonlyArray<string>
}

interface CommittedRecord {
  committedAtChapter: number
  supersededAtChapter?: number
}

type CommittedFact = CanonFact & CommittedRecord
type CommittedEntity = Entity & CommittedRecord
type CommittedState = CharacterState & CommittedRecord
type CommittedPromise = StoryPromise & CommittedRecord

// ── Helpers ──────────────────────────────────────────────────────────────────

const COMMITTED_STATUSES: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>([
  "human-approved",
  "human-edited",
])

function assertCommittedApproval(status: ApprovalStatus, kind: string): void {
  if (!COMMITTED_STATUSES.has(status)) {
    throw new Error(
      `seed${capitalize(kind)}: approvalStatus="${status}" is not a committed status; only human-approved or human-edited can enter the substrate as canon (no ghost canon)`,
    )
  }
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * Walk per-logical-id version chains, pick the version that was current at
 * chapter N, and STRIP the internal CommittedRecord fields on the way out.
 *
 * The strip is deliberate: a Postgres-backed adapter would produce plain
 * domain objects (CanonFact, Entity, CharacterState, StoryPromise) without
 * `committedAtChapter` / `supersededAtChapter` properties. The in-memory
 * adapter must return the same shape so the two are drop-in equivalent for
 * downstream consumers (assembleL1, scope.ts, scoping tests). Codex M1
 * flagged that the original implementation leaked these internal fields
 * through the CanonSource interface.
 */
function collectCurrentVersions<
  T extends CommittedRecord & { provenance: { approvalStatus: ApprovalStatus } },
>(
  map: Map<string, T[]> | undefined,
  chapterN: number,
): readonly Omit<T, keyof CommittedRecord>[] {
  if (!map) return []
  const out: Omit<T, keyof CommittedRecord>[] = []
  for (const versions of map.values()) {
    // Walk backwards: the latest version at-or-before chapterN that has not
    // been superseded by chapterN wins. There is at most one such version
    // per logical id by construction.
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i]
      if (v.committedAtChapter > chapterN) continue
      if (v.supersededAtChapter != null && v.supersededAtChapter <= chapterN) {
        // This version was superseded by chapterN; keep walking back to
        // find the version that was current at chapterN.
        continue
      }
      // Defense in depth: the substrate only commits records with approved
      // statuses, but re-check at read time.
      if (!COMMITTED_STATUSES.has(v.provenance.approvalStatus)) continue
      const { committedAtChapter: _c, supersededAtChapter: _s, ...domain } = v
      out.push(domain as Omit<T, keyof CommittedRecord>)
      break
    }
  }
  return out
}

// Re-export ProvenanceSource so callers building proposals don't have to
// import from two places. Pure convenience.
export type { ProvenanceSource }
