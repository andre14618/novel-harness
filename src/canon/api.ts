/**
 * Canon API — interface stubs for the world-bible / character-bible architecture.
 *
 * Charter: docs/charters/world-bible-architecture.md §0d
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0.md
 *
 * Status: STUB. Function signatures and return shapes are designed; bodies throw
 * `notImplemented()`. No live data, no DB writes, no LLM calls. Compiles under
 * `bunx tsc --noEmit` so downstream charter work can wire against the API
 * without waiting for the substrate to ship.
 *
 * Implementation lands in Step 1 (Canon Substrate). Until then, callers should
 * NOT depend on these stubs at runtime.
 */

// ── Provenance & versioning ──────────────────────────────────────────────────

/** What kind of artifact wrote this canon fact. */
export type CanonSource =
  | "planner-output"
  | "planning-state-mapper"
  | "planning-state-repair"
  | "post-draft-extraction"
  | "human-edit"
  | "corpus-import"

/** Where in the workflow the fact was approved (or hasn't been). */
export type ApprovalStatus =
  | "auto-extracted"   // entered by an extractor; not yet reviewed
  | "human-approved"   // operator confirmed
  | "human-edited"     // operator changed the auto-extracted value
  | "contested"        // two sources disagree; resolution pending
  | "rejected"         // operator marked as not-canon

/** Distinguishes facts the planner asserted from facts observed in approved prose. */
export type FactOrigin =
  | "planned"          // planner asserted this should be canon
  | "observed"         // extracted from approved prose post-draft

/** Provenance metadata attached to every canon fact. */
export interface Provenance {
  source: CanonSource
  /** Chapter this fact entered canon. 0 = bootstrap (pre-chapter-1). */
  chapter: number
  /** Beat index within the chapter, if attributable. */
  beat?: number
  /** Monotonic version of the extractor / planner that produced this fact. */
  extractorVersion: string
  /** Extractor-reported confidence in [0, 1]. Undefined for human edits. */
  confidence?: number
  approvalStatus: ApprovalStatus
  origin: FactOrigin
  /** If this fact superseded a prior version, link to it. */
  supersedes?: string  // CanonFact.id of the prior version
  createdAt: string  // ISO-8601
  updatedAt: string  // ISO-8601
}

// ── Domain types ─────────────────────────────────────────────────────────────

/** Stable kebab-case identifier; e.g. "fact-debt-marks-bind-to-life-force". */
export type CanonId = string

export type FactKind =
  | "established_fact"     // canonical world/character/system fact
  | "knowledge_change"     // a character learned X at chapter N beat M
  | "character_state"      // a character is in state X at chapter N beat M
  | "promise"              // setup that requires payoff
  | "payoff"               // delivery of a prior promise

export interface CanonFact {
  id: CanonId
  kind: FactKind
  /** Human-readable canonical statement. */
  text: string
  /** Free-form structured payload (kind-dependent shape). */
  data?: Record<string, unknown>
  provenance: Provenance
}

/**
 * No-ghost-canon residual: unlike CanonFact and Entity, CharacterState and
 * StoryPromise carry no provenance/approvalStatus. The §0a scoping rules
 * therefore can't filter pending vs. approved snapshots at scope time.
 * Step 1 substrate must either (a) guarantee at the DB/API layer that only
 * operator-approved states/promises are returned by `characterStatesAsOfChapter`
 * / `promisesAsOfChapter`, or (b) extend these types with provenance and
 * filter at scope time the same way facts/entities are filtered today.
 */
export interface CharacterState {
  characterId: string
  characterName: string
  /** What the character knows (refs to knowledge_change CanonFact ids). */
  knownFacts: CanonId[]
  /** Physical state, location, possessions — kind-tagged. */
  state: Record<string, unknown>
  /** Chapter/beat this snapshot is anchored to. */
  asOfChapter: number
  asOfBeat?: number
}

export type PromiseStatus = "open" | "resolved" | "abandoned"

/** Domain type — distinct from the JS Promise. Setup-payoff link in story state. */
export interface StoryPromise {
  id: CanonId
  /** Setup location. */
  setupChapter: number
  setupBeat?: number
  /** Expected payoff window (planner-asserted; may slip). */
  expectedPayoffChapter?: number
  /** Actual payoff if resolved. */
  resolvedAtChapter?: number
  resolvedAtBeat?: number
  status: PromiseStatus
  /** Reference to the CanonFact that asserts the promise. */
  promiseFactId: CanonId
}

export type EntityKind =
  | "character"
  | "location"
  | "system"        // magic system, technology, institutional system
  | "item"
  | "organization"
  | "event"
  | "concept"

export interface Entity {
  id: CanonId
  name: string
  /** Surface forms the writer might use (e.g. "Lord Brennan", "Lord Sorcerer Brennan"). */
  aliases: string[]
  kind: EntityKind
  /** First chapter this entity appeared in approved prose. */
  firstAppearedChapter?: number
  /** Free-form structured payload (kind-dependent shape). */
  data?: Record<string, unknown>
  provenance: Provenance
}

// ── Update proposal flow ─────────────────────────────────────────────────────

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"

export interface CanonUpdateProposal {
  id: string
  source: CanonSource
  /** Either a new fact or an edit to an existing one (CanonFact.id). */
  targetFactId?: CanonId
  proposedFact: Omit<CanonFact, "provenance"> & { provenance: Omit<Provenance, "approvalStatus" | "createdAt" | "updatedAt"> }
  status: ProposalStatus
  /** Operator-supplied modification, if status === "modified". */
  modifiedFact?: CanonFact
  /** Free-form operator note explaining the decision. */
  operatorNote?: string
  createdAt: string
  resolvedAt?: string
}

// ── API surface ──────────────────────────────────────────────────────────────

/**
 * Returns canon as it was at the time chapter N was being written.
 * Subsequent edits / supersessions are NOT visible — this is the
 * "what was true when" query that lets the editorial layer evaluate
 * whether retroactive corrections invalidate earlier prose.
 */
export async function getCanonForChapter(
  novelId: string,
  chapterNumber: number,
): Promise<{ facts: CanonFact[]; entities: Entity[] }> {
  notImplemented("getCanonForChapter")
}

/**
 * Point-in-time character knowledge / state. The chapter+beat coordinate
 * is exclusive of the named beat — i.e. "what did this character know
 * and what state were they in *before* this beat started."
 */
export async function getCharacterStateAt(
  novelId: string,
  characterId: string,
  chapter: number,
  beat?: number,
): Promise<CharacterState> {
  notImplemented("getCharacterStateAt")
}

/** All open promises with payoff chapter context. */
export async function getActivePromises(
  novelId: string,
  asOfChapter?: number,
): Promise<StoryPromise[]> {
  notImplemented("getActivePromises")
}

/** Full named-entity registry for the novel as of a point in time. */
export async function getEntityRegistry(
  novelId: string,
  asOfChapter?: number,
): Promise<Entity[]> {
  notImplemented("getEntityRegistry")
}

/**
 * Extraction or human edit produces a proposal, NOT a write. Proposal sits
 * in `pending_canon_updates` until `commitCanonUpdate` is called. This is
 * the "no ghost canon" rule: pending updates never appear in writer context.
 */
export async function proposeCanonUpdate(
  novelId: string,
  proposal: Omit<CanonUpdateProposal, "id" | "status" | "createdAt">,
): Promise<CanonUpdateProposal> {
  notImplemented("proposeCanonUpdate")
}

/**
 * Resolve a pending proposal. On `approved` the fact is written to canon.
 * On `modified` the operator-supplied `modifiedFact` is written instead.
 * On `rejected` the proposal is closed and stored in the rejected-flags
 * corpus (per charter §6 feedback corpora).
 */
export async function commitCanonUpdate(
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
  opts?: { modifiedFact?: CanonFact; operatorNote?: string },
): Promise<{ committedFact?: CanonFact }> {
  notImplemented("commitCanonUpdate")
}

// ── Stub helper ──────────────────────────────────────────────────────────────

function notImplemented(fn: string): never {
  throw new Error(`canon/api.ts: ${fn} is a Step-0 stub; implementation lands in charter Step 1 (Canon Substrate). See docs/charters/world-bible-architecture.md.`)
}
