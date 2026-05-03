---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-canon-substrate-step-1-design
charter: docs/charters/world-bible-architecture.md
parent-lane: docs/sessions/2026-05-03-world-bible-architecture-step-0a-session-3.md
---

# Lane — Charter Step 1: Canon Substrate Design

## Session-Start Contract

### 1. Goal + component

Land the **schema/API seam** behind `src/canon/api.ts` so a future production adapter can satisfy `bundle.ts`'s `CanonSource` interface and feed `assembleL1` with operator-committed Canon Snapshots that are pinned to the chapter at which they were canonical.

Component scope:

- `docs/designs/canon-substrate-step1.md` — design doc covering storage/versioning, snapshot identity, proposal lifecycle, point-in-time semantics, supersession, no-ghost-canon enforcement boundary, the production-adapter shape, and a Postgres-schema sketch.
- `src/canon/api.ts` — extend `CharacterState` and `StoryPromise` with `Provenance`, closing the LOW 2 residual flagged in the round-2 Codex review.
- `src/canon/substrate.ts` (new) — `CanonSubstrate` interface (read-side committed-only contract + write-side proposal/commit lifecycle), plus a small in-memory adapter implementation for testing the seam.
- `src/canon/substrate.test.ts` (new) — tests proving no-ghost-canon and point-in-time snapshot behavior against the in-memory adapter.

Out of scope this session: Postgres tables, real `src/db/canon.ts`, real `src/harness/canon-substrate.ts` service module, runtime wiring into the orchestrator. The seam must be stable before any of those land.

### 2. Why

Charter §1 stop gate: *"Schema must support `getCanonForChapter(N)` returning what was canonical at the time chapter N was written, regardless of subsequent edits. If the schema can't do that, redesign before populating."* The §0a stop gate is closed (recall 0.927) but it ran against a JSON fixture; production needs a live, versioned, approval-aware substrate. Until that seam is stable, no other Step 1+ work can land — every downstream path (Step 2 input integrity grading, Step 3 mechanical middle, Step 4 editorial loop) reads from this substrate.

The Codex round-2 review also flagged the LOW 2 residual: `CharacterState` and `StoryPromise` currently have no `Provenance`, so the no-ghost-canon rule is enforced for facts/entities only. Step 1 is the right place to either add provenance to those types or push the committed-only enforcement entirely into the substrate read API. The design doc will resolve this explicitly.

### 3. What is measurable

The work is complete when:

- The design doc covers each Step 1 schema requirement listed in the charter (`source`, `chapter/beat/version`, `confidence`, `approvalStatus`, `supersession history`, `planned-vs-observed`, `conflict handling`) and explains how each is realized.
- `CharacterState` and `StoryPromise` carry `Provenance`; existing canon tests still pass after the type change.
- `CanonSubstrate` interface compiles and the in-memory adapter implements it.
- The in-memory adapter satisfies `bundle.ts`'s `CanonSource` interface (proven by a test that calls `assembleL1` against the adapter and gets a valid `L1Packet`).
- Tests prove:
  - **No-ghost-canon**: pending, auto-extracted, contested, and rejected proposals are invisible to all read methods.
  - **Point-in-time snapshot**: `factsAsOfChapter(novelId, N)` and friends return what was committed by chapter N's write window, regardless of edits committed after chapter N.
  - **Supersession**: when a fact is superseded by a later version, the snapshot at the supersession chapter (and after) reflects the new version; the snapshot before reflects the original.
  - **Approval-status filter**: `human-approved` and `human-edited` enter the snapshot; `auto-extracted`, `contested`, `rejected` do not.
- `bun test src/canon/` passes; `bunx tsc --noEmit` is clean.

### 4. Validated gates

- **(a) Clean pass:** design doc + types update + interface + in-memory adapter + seam tests; tsc clean; canon tests still pass.
- **(b) New dominant blocker:** design surfaces a contradiction with the charter or operating model that needs reconciliation before the seam can stabilize (e.g., the schema can't satisfy `getCanonForChapter` without breaking another invariant).
- **(c) Regression:** adding `Provenance` to `CharacterState`/`StoryPromise` breaks the §0a recall harness or scope tests beyond cosmetic test-fixture updates.
- **(d) Infrastructure failure:** N/A — pure code/types work, no LLM/API/DB calls.
- **(e) Budget cap:** no runtime LLM/API cost.

## Command Plan

1. Read charter §1 and §0d, the operating-model doc, and the existing `src/canon/api.ts`/`bundle.ts`/`scope.ts` to ground the design.
2. Write `docs/designs/canon-substrate-step1.md` covering storage model (versioned rows + supersession), snapshot identity, proposal lifecycle, committed-only read contract, point-in-time semantics, no-ghost-canon enforcement boundary, naming-collision note (`CanonSource` is currently both a Provenance origin type and the bundle.ts read interface), and a Postgres-schema sketch.
3. Update `src/canon/api.ts` to add `Provenance` to `CharacterState` and `StoryPromise`. Remove the LOW 2 residual TODO comment.
4. Update fixtures and tests for the new required field.
5. Define `CanonSubstrate` in `src/canon/substrate.ts`. The interface composes the bundle.ts `CanonSource` read methods (returning committed-only) with the proposal/commit write surface from the Canon API stubs.
6. Implement an in-memory adapter (`InMemoryCanonSubstrate`) that backs the substrate with maps keyed by (novelId, logical canon id, version). Used by tests; not for production.
7. Write seam-proving tests in `src/canon/substrate.test.ts`.
8. Verify `bun test src/canon/` is green; tsc clean. Co-stage the operating-model + current-state + CONTEXT docs already present in the working tree if they're related (they are — the operating-model doc IS what this lane builds substrate for).

## Results

Step 1 substrate seam landed. The schema/API surface that future production-adapter code will plug into is now defined, type-checked, and exercised against an in-memory implementation.

- **Design doc**: `docs/designs/canon-substrate-step1.md` covers each charter §1 schema requirement (source, chapter/beat/version, confidence, approval status, supersession history, planned-vs-observed, conflict resolution), the snapshot identity model (logical id + monotonic version, supersession by chapter), the read contract (committed-only by construction; defense-in-depth retained at scope.ts), the proposal/commit lifecycle, the production-adapter shape (`src/db/canon-substrate.ts` + `src/harness/canon-substrate.ts` — deferred), and an informative Postgres-schema sketch. Naming-collision note included: `CanonSource` was both the Provenance origin string in api.ts and the read interface in bundle.ts; the api.ts type is renamed to `ProvenanceSource` to free the name for the more central interface.

- **Types**: `Provenance` added to `CharacterState` and `StoryPromise` (closes the LOW 2 residual flagged in Codex round-2). `CanonSource` (origin type) renamed to `ProvenanceSource`. All in-tree fixtures and test helpers updated; existing 88 canon tests still green.

- **Substrate interface + in-memory adapter**: `src/canon/substrate.ts` ships `CanonSubstrate` (composes `CanonSource` read methods with proposal/commit write methods + pending-list operator surface) and `InMemoryCanonSubstrate` (test/fixture-driven implementation). The adapter enforces no-ghost-canon at write time (`seed*` methods reject non-committed approval status) and at read time (defensive re-check during snapshot assembly).

- **Seam-proving tests**: `src/canon/substrate.test.ts` ships 19 tests across five clusters — pending/rejected/contested invisibility, approval-status filter at the seed boundary, point-in-time snapshot semantics including supersession via direct seed and via `resolveProposal`, `CharacterState` and `StoryPromise` no-ghost enforcement, and end-to-end `assembleL1` against an `InMemoryCanonSubstrate` (proves the production-adapter shape will satisfy the bundle assembler).

- **Verification**: `bun test src/canon/` → 107 pass / 0 fail / 211 expects (88 → 107, +19). `bunx tsc --noEmit` clean. `bun scripts/audits/run-salvatore-recall.ts` → recallGateClear=true, meanRecall=0.927, tokenCapExceeded=0/5 (§0a remains closed under the new type shape).

Stop gate status — **seam cleared, production substrate pending**: this session lands the schema/API design and an in-memory adapter that demonstrates the charter §1 property ("`getCanonForChapter(N)` returns what was canonical at the time chapter N was written, regardless of subsequent edits") on the supersession test cluster. The §1 stop gate is NOT formally cleared yet — that requires the production-backed adapter (`src/db/canon-substrate.ts` + `src/harness/canon-substrate.ts`) to pass the same point-in-time, no-ghost-canon, and supersession tests against a Postgres backend. Marking §1 cleared now would conflate the design seam with the production substrate; the user has explicitly asked to keep these distinct until both pieces exist.

Out of scope and explicitly deferred: Postgres schema migrations, real `src/db/canon-substrate.ts` and `src/harness/canon-substrate.ts` modules, an adapter-equivalence test suite (in-memory vs Postgres against the same fixture), orchestrator wiring, bootstrap-chapter-1 path (charter §0b), and operator-facing proposal review UI. The seam is stable; runtime wiring is the next session's concern, gated on commit-pinned implementation review of this commit (`28071ea`) before any DB work begins.

## Stop gate fired

**(a) Clean pass for the seam (NOT for charter §1).** Design doc + types update + interface + in-memory adapter + 19 seam-proving tests; tsc clean; 107/107 canon tests pass; Salvatore recall harness re-runs at 0.927 (§0a remains closed under new types).

Charter §1 stop gate language: **seam cleared, production substrate pending.** The supersession test cluster demonstrates the point-in-time property against `InMemoryCanonSubstrate`, but charter §1 is about the production substrate, not the seam. §1 will be marked cleared only after the Postgres adapter (`src/db/canon-substrate.ts` + `src/harness/canon-substrate.ts`) passes an adapter-equivalence test suite against the same fixture as the in-memory adapter.

## Evidence

- `bun test src/canon/` — 107 pass / 0 fail / 211 expects.
- `bunx tsc --noEmit` — clean.
- `bun scripts/audits/run-salvatore-recall.ts` — recallGateClear=true, meanRecall=0.927, tokenCapExceeded=0/5; §0a remains closed under the new type contract.
- Commit-pinned implementation review of `28071ea` requested before Postgres work; review gate-keeps the next session's DB-adapter implementation.

## Cost

| line | spend |
|---|---|
| (no LLM/API calls) | 0 |
| **total** | **0** |

## Commits

(TBD)
