---
status: proposed
updated: 2026-05-03
role: design
charter: docs/charters/world-bible-architecture.md
lane: docs/sessions/2026-05-03-canon-substrate-step-1-design.md
---

# Canon Substrate — Step 1 Design

The schema/API seam behind `src/canon/api.ts`. Holds operator-committed Canon, makes `getCanonForChapter(N)` return what was canonical at the time chapter N was written, enforces no-ghost-canon at the read API, and exposes a `CanonSource` adapter for `assembleL1`.

## Charter requirements being satisfied

From `docs/charters/world-bible-architecture.md` §1:

1. **source** — which artifact wrote this fact (`planner-output | planning-state-mapper | post-draft-extraction | human-edit | corpus-import | …`). Already on `Provenance.source`.
2. **chapter/beat/version** — when this fact entered canon, plus the extractor/planner version. `Provenance.chapter` + `Provenance.beat` + `Provenance.extractorVersion` already cover this.
3. **confidence** — extractor-reported `[0,1]`. Already on `Provenance.confidence`.
4. **human approval status** — `auto-extracted | human-approved | human-edited | contested | rejected`. Already on `Provenance.approvalStatus`.
5. **supersession history** — version chain across edits. `Provenance.supersedes` already points to a prior `CanonFact.id`; the substrate adds the per-novel monotonic `version` field below.
6. **planned-vs-observed** — `Provenance.origin: "planned" | "observed"`. Already present.
7. **conflict handling** — when two sources propose the same logical fact, what wins? Substrate-level rule defined below (§Conflict resolution).

The §1 stop gate is the binding constraint: *"Schema must support `getCanonForChapter(N)` returning what was canonical at the time chapter N was written, regardless of subsequent edits."* The design is built around this read query. **Note on gate semantics:** demonstrating the property against `InMemoryCanonSubstrate` clears the *seam*, not the *production substrate*. §1 will be formally cleared only after the Postgres adapter passes the same point-in-time / no-ghost / supersession tests against a real DB backend (see "Tests proving the seam" below — those become the seed for the adapter-equivalence suite).

## Snapshot identity model

Two coordinates per logical canon record:

- **logical id** (`CanonId`) — stable across edits. Two `CanonFact`s with the same `id` are the same canonical statement at different versions.
- **version** (`number`) — monotonic per `(novelId, logicalId)`. Each commit increments it. Version 1 is the original commit; version 2+ are edits or corrections.

Each committed record additionally carries:

- `committedAtChapter` — the chapter whose write window this version was committed in. Equivalent to "this version became canon at chapter X". Stored on `Provenance.chapter`.
- `supersededByVersion?: number` — set when a later version replaces this one. Null on the currently-active version.
- `supersededAtChapter?: number` — chapter at which the supersession was committed. Stored on the *new* record as `Provenance.chapter`; the old record gets a backreference.

A snapshot at chapter N is the set, for each logical id, of the version V such that:

- `committedAtChapter(V) ≤ N`, and
- there is no V' with `committedAtChapter(V') ≤ N` and `V' supersedes V`.

That is: pick the most recent version at-or-before N that has not itself been superseded by chapter N.

This is the bitemporal pattern with story time = chapter index. The schema design satisfies the §1 stop gate by construction: a chapter-12 edit that supersedes a chapter-3 fact does not appear in the chapter-3 snapshot, only in chapter-12 and later snapshots. The seam is demonstrated against the in-memory adapter; the gate formally clears only when the Postgres adapter passes the same property end-to-end.

## Read-side contract: committed-only by construction

`CanonSubstrate.factsAsOfChapter(novelId, N)` returns committed-only by definition. The substrate's read methods filter:

```
status = 'committed'
AND approvalStatus IN {'human-approved', 'human-edited'}
AND committedAtChapter ≤ N
AND (supersededAtChapter IS NULL OR supersededAtChapter > N)
```

The scope.ts approval filter is **kept as defense in depth** even though the substrate enforces approval status. Two layers of enforcement is correct here: the substrate guarantees committed-only at the source, and the scoping rules re-check at assembly time so a misbehaving adapter (test fixture, future cache, or in-memory mock) can't smuggle non-approved canon into a packet.

`snapshotVersion(novelId)` returns a deterministic identifier for the current canon-snapshot version — used by `assembleL1` to fingerprint the canon state in the L1 packet hash. Format: `"<novelId>@<canonGenerationCounter>"`, where the counter increments on every commit/reject/supersede operation.

## CharacterState and StoryPromise — no-ghost-canon residual closed

Currently `CharacterState` and `StoryPromise` have no `Provenance`. Decision: **add `Provenance`** to both. Rationale:

- Symmetry with `CanonFact` and `Entity` — every canon-typed object carries the same provenance contract.
- The substrate can audit/filter `approvalStatus` uniformly across all four read methods rather than special-casing two of them.
- Defense in depth: scope.ts can keep its `isApproved()` check and apply it to states/promises the same way.
- Cost: small. The `Provenance` field is added with the same shape as on facts/entities; existing in-tree fixtures need a one-line update.

Alternative considered: push enforcement entirely into the substrate (only return committed states/promises by construction; no provenance on the type). Rejected because (a) it removes information the editorial layer will want for auditing — "when did this character state become canonical?" is a real query — and (b) it makes the in-memory test adapter responsible for filtering correctly, which the scope.ts approval check would no longer guard against.

## Proposal lifecycle

```
[propose]   — extractor/human-edit creates a CanonUpdateProposal with status='pending'
   |
   v
[approve | reject | modify]
   |
   v   (on approve or modify)
[commit]    — substrate writes a new version (version = max+1) with approvalStatus
              ∈ {human-approved, human-edited}, sets committedAtChapter to the
              chapter the operator was working in. If the proposal targets an
              existing logical id, the prior active version's
              supersededByVersion/supersededAtChapter are updated.
```

Pending proposals live in their own table/structure; they never appear in any read method that feeds `assembleL1`. They can be enumerated by an operator-facing API for review (out of scope for Step 1 — only the substrate seam matters).

A rejected proposal stays in the rejected-flag corpus (charter §6 reference) but never enters reads.

## Conflict resolution

When two sources propose the same logical fact concurrently (e.g., the planner asserted `fact-x = "value-A"` at chapter 3, post-draft extraction proposes `fact-x = "value-B"` at chapter 3):

- Both proposals exist as separate pending records.
- The operator adjudicates: approve one, reject the other; or mark the proposal `contested` until resolved; or modify either.
- Substrate enforces: only one version per logical id can have `supersededByVersion IS NULL` at any time. Approving a second proposal for the same logical id automatically supersedes the first.

For Step 1, the substrate does not auto-resolve. Every conflict goes through operator review. (Charter §0d auto-adjudication TTL is a Step 4 concern, not Step 1.)

## Production adapter shape (deferred wiring)

The runtime adapter — written in a follow-on session — lives at `src/db/canon-substrate.ts` for raw queries and `src/harness/canon-substrate.ts` for the service-layer API. It satisfies `CanonSubstrate` and is wired into `assembleL1` callers via dependency injection (the orchestrator constructs a `CanonSubstrate`, hands it to the assembly call site).

The CLAUDE.md rule "no ad-hoc SQL outside service/db modules" is honored: all queries live in `src/db/canon-substrate.ts`; consumers go through `src/harness/canon-substrate.ts`.

This session does not land the adapter — only the interface and an in-memory test implementation. The seam stabilizes first; runtime wiring follows once Step 2 input integrity grading is also designed.

## Postgres schema sketch (informative, not landing this session)

```sql
-- One row per committed canon record (canon_facts table)
CREATE TABLE canon_facts (
  novel_id              text NOT NULL,
  logical_id            text NOT NULL,           -- stable across edits
  version               int  NOT NULL,           -- monotonic per (novel_id, logical_id)
  kind                  text NOT NULL,           -- FactKind
  text                  text NOT NULL,
  data                  jsonb,                   -- kind-dependent payload
  -- provenance
  source                text NOT NULL,           -- Provenance.source
  committed_at_chapter  int  NOT NULL,
  committed_at_beat     int,
  extractor_version     text NOT NULL,
  confidence            numeric(4,3),
  approval_status       text NOT NULL,           -- ApprovalStatus
  origin                text NOT NULL,           -- "planned" | "observed"
  -- supersession
  supersedes_version    int,                     -- null = original
  superseded_by_version int,                     -- null = currently active
  superseded_at_chapter int,                     -- null = currently active
  -- audit
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (novel_id, logical_id, version)
);

CREATE INDEX canon_facts_snapshot_idx
  ON canon_facts (novel_id, committed_at_chapter, approval_status)
  WHERE superseded_by_version IS NULL;

-- Parallel structure for canon_entities, canon_character_states, canon_promises.

-- Pending proposals — never read by assembleL1.
CREATE TABLE canon_proposals (
  id                  text PRIMARY KEY,
  novel_id            text NOT NULL,
  target_logical_id   text,                       -- null = brand-new fact
  proposed_payload    jsonb NOT NULL,             -- the CanonFact-shaped proposal
  source              text NOT NULL,
  status              text NOT NULL,              -- 'pending' | 'approved' | 'rejected' | 'modified'
  operator_note       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);

-- Snapshot generation counter — gives snapshotVersion() a stable handle.
CREATE TABLE canon_snapshot_meta (
  novel_id              text PRIMARY KEY,
  generation_counter    bigint NOT NULL DEFAULT 0
);
```

The point-in-time read query is direct:

```sql
SELECT * FROM canon_facts
WHERE novel_id = $1
  AND approval_status IN ('human-approved', 'human-edited')
  AND committed_at_chapter <= $2
  AND (superseded_at_chapter IS NULL OR superseded_at_chapter > $2);
```

## Naming collision: CanonSource

Today `src/canon/api.ts` exports `type CanonSource = "planner-output" | …` (the Provenance origin string), and `src/canon/bundle.ts` exports `interface CanonSource { factsAsOfChapter, … }` (the read interface). They don't collide today because no module imports both. Once the substrate's adapter file imports both — it wants `Provenance` (uses the type) and it implements the read interface — they collide.

Resolution: rename `api.ts`'s `CanonSource` → `ProvenanceSource`. The bundle.ts interface keeps the central name because it's consumed broadly.

This rename lands in the types-update commit (small mechanical change; updates `Provenance.source: ProvenanceSource` and the proposal type).

## What the substrate interface looks like

```ts
// src/canon/substrate.ts (new)
import type {
  CanonFact,
  CanonId,
  CanonUpdateProposal,
  CharacterState,
  Entity,
  ProposalStatus,
  StoryPromise,
} from "./api"
import type { CanonSource } from "./bundle"

/**
 * Substrate-level read + write surface. Read methods compose the bundle.ts
 * CanonSource interface (committed-only by construction at this layer);
 * write methods carry the proposal/commit lifecycle.
 */
export interface CanonSubstrate extends CanonSource {
  // Write-side
  proposeCanonUpdate(
    novelId: string,
    proposal: Omit<CanonUpdateProposal, "id" | "status" | "createdAt">,
  ): Promise<CanonUpdateProposal>

  resolveProposal(
    proposalId: string,
    status: Exclude<ProposalStatus, "pending">,
    opts?: { modifiedFact?: CanonFact; operatorNote?: string },
  ): Promise<{ committedFact?: CanonFact }>

  /** Operator-facing — list pending proposals for review. NEVER feeds reads. */
  listPendingProposals(novelId: string): Promise<CanonUpdateProposal[]>
}
```

The in-memory adapter `InMemoryCanonSubstrate` lives in the same file, satisfies the interface, and is used by tests + future fixture-based dev workflows. Production swaps in the Postgres-backed adapter without changing any consumer.

## Tests proving the seam (this session)

In `src/canon/substrate.test.ts` against `InMemoryCanonSubstrate`:

1. **No-ghost-canon (4 sub-tests)** — propose without committing → not visible in any read; reject → not visible; mark contested → not visible; commit → visible.
2. **Approval-status filter** — auto-extracted not visible; contested not visible; rejected not visible; human-approved visible; human-edited visible.
3. **Point-in-time snapshot** — commit fact-A at chapter 3; assert `factsAsOfChapter(novelId, 3)` includes it. Commit edit-of-A at chapter 7. Assert `factsAsOfChapter(novelId, 5)` returns the chapter-3 version; `factsAsOfChapter(novelId, 8)` returns the chapter-7 version.
4. **Supersession** — same as above but verifying supersession metadata; the chapter-7 record's provenance lists `supersedes` pointing at the chapter-3 record's logical id.
5. **CharacterState + StoryPromise carry provenance** — propose a `CharacterState` with `auto-extracted`, commit with `human-approved`. Assert pre-commit invisible, post-commit visible.
6. **Adapter satisfies bundle.ts CanonSource** — call `assembleL1(adapter, novelId, chapterN, hints)` against an adapter populated with committed canon. Assert the resulting `L1Packet` is valid (has bytes, packet hash, expected sections). This proves the seam holds end-to-end without DB.

## Bar for charter §1 to formally clear

§1 says *"Schema must support `getCanonForChapter(N)` returning what was canonical at the time chapter N was written."* This session lands the schema and proves the property against `InMemoryCanonSubstrate`. The gate is not formally cleared until the production-backed adapter passes equivalent tests. Required to flip §1 to "cleared":

1. Postgres migration creates the tables sketched above; sample data round-trips via the schema unchanged.
2. `src/db/canon-substrate.ts` queries return committed-only by construction (the SQL in §"Postgres schema sketch" above is the read template).
3. `src/harness/canon-substrate.ts` wraps the DB module and exposes `CanonSubstrate` to consumers.
4. **Adapter-equivalence test suite**: the same fixture (drawn from or modeled on `tests/canon/fixtures/salvatore-crystal-shard.canon.json`) runs through both `InMemoryCanonSubstrate` and the Postgres-backed adapter; assertions in `src/canon/substrate.test.ts` pass identically against both. Any divergence is a substrate bug, not a test issue.
5. Charter §1 status flipped to *cleared* in `docs/charters/world-bible-architecture.md` and the Step 1 lane doc, with the equivalence-suite commit cited as evidence.

Until step 5 lands, the operating-model and charter language remains "seam cleared, production substrate pending."

## Out of scope this session

- Postgres tables / migration SQL (sketched above; lands in a follow-on after the seam settles).
- Real `src/db/canon-substrate.ts` and `src/harness/canon-substrate.ts` modules.
- Orchestrator wiring (which assembleL1 caller uses which adapter).
- Step 2 input-integrity grading. The substrate is the substrate; grading inputs is downstream.
- Conflict auto-adjudication TTL (charter §0d, Step 4 concern).
- Operator UI for proposal review.
- Bootstrap path for chapter 1 (charter §0b — separate session).

## Risks / open questions

- **Versioning at the entity level vs the fact level.** This design versions per logical canon id (whether it's a fact, entity, state, or promise). An entity that gets renamed from "Brennan" to "Lord Brennan" gets `version=2`. Open question: if only `aliases` change, do we still bump version? Decision for Step 1: **yes, every committed change bumps version**. Simpler invariant; bigger version chains. Revisit if it bloats the audit trail unproductively.
- **Beat-level granularity for `committedAtChapter`.** The charter mentions `chapter/beat`. Step 1 stores `committed_at_beat` but the snapshot read query is currently chapter-only (`<=` on chapter). Open: should `getCanonForChapter(N)` further filter by beat for partial-chapter snapshots? Decision for Step 1: **no, snapshots are chapter-grained**. Beat-level snapshots add complexity without a clear consumer; the writer reads the same packet for the whole chapter (per the operating-model rule that L1 doesn't change within a chapter).
- **Migration story** when a `Provenance` field is added to `CharacterState` and `StoryPromise`. There's no production data yet (still pre-runtime), so the migration is a one-shot rewrite of in-tree fixtures. If/when production data exists, the same change would need a backfill. Documented but no action required.
