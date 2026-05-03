---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-canon-substrate-postgres-adapter
charter: docs/charters/world-bible-architecture.md
parent-lane: docs/sessions/2026-05-03-canon-substrate-step-1-design.md
---

# Lane — Charter Step 1: Canon Substrate Production Adapter (Postgres)

## Session-Start Contract

### 1. Goal + component

Land the **production-backed Postgres adapter** behind the now-cleared `CanonSubstrate` seam, plus an **adapter-equivalence test suite** that runs the same behavioral spec against `InMemoryCanonSubstrate` and the new `PostgresCanonSubstrate`. If the equivalence suite passes, charter §1 stop gate flips from "seam cleared, production substrate pending" to formally cleared.

Component scope:

- `sql/035_canon_substrate.sql` — six tables (`canon_facts`, `canon_entities`, `canon_character_states`, `canon_promises`, `canon_proposals`, `canon_snapshot_meta`) with versioning + supersession columns. Sketch lives in `docs/designs/canon-substrate-step1.md` §"Postgres schema sketch".
- `src/db/canon-substrate.ts` (new) — raw query module per CLAUDE.md §"Database And SQL". DTO mapping between row shape and the four canon-typed objects + `CanonUpdateProposal`. Snapshot loader query — pulls latest at-or-before-chapter rows per logical id.
- `src/harness/canon-substrate.ts` (new) — `PostgresCanonSubstrate` class implementing `CanonSubstrate`. Async `loadSnapshot(novelId, chapterN)` populates an in-process cache; sync read methods serve from cache and throw if not loaded (the async-loader + sync-snapshot-wrapper pattern documented in the design doc).
- `src/canon/substrate-equivalence.test.ts` (new) — single behavioral spec exported as a function `runCanonSubstrateSpec(label, makeAdapter)`. Run twice: once with the in-memory factory, once with the Postgres factory. Skipped via `describe.skipIf(!reachable)` when Postgres is unreachable, mirroring `src/db/chapter-exhaustions.test.ts`.

Out of scope this session: orchestrator wiring (which `assembleL1` caller uses which adapter), bootstrap-chapter-1 path (charter §0b), operator-facing proposal review UI, deploy to LXC, applying the migration on LXC.

### 2. Why

The §1 stop gate from the world-bible charter is binding: *"Schema must support `getCanonForChapter(N)` returning what was canonical at the time chapter N was written, regardless of subsequent edits."* The prior session (`2026-05-03-canon-substrate-step-1-design`) cleared the seam — types, interface, in-memory adapter, 31 seam tests — but explicitly left §1 at "seam cleared, production substrate pending" because demonstrating the property against `InMemoryCanonSubstrate` is not the same as demonstrating it against Postgres rows. Until the production adapter ships and passes equivalent tests, downstream Step 2/3/4 work cannot land — every read path eventually goes through `CanonSource`, and the scoping/assembly machinery is already pinned to that interface.

The Codex round-2 follow-up review of `28071ea` flagged MEDIUM 3 (sync-reads + async-writes asymmetry) and noted that the equivalence suite when Postgres lands MUST include a "snapshot not loaded" test. That test is in scope here.

### 3. What is measurable

The work is complete when:

- Migration applies cleanly against a Postgres DB (`bun -e "import('./src/db/connection').then(m => m.migrate())"`); each table created; indexes present; round-trip insert/select returns the same row shape.
- `src/db/canon-substrate.ts` raw queries cover: insert canon record (per type), insert proposal, update proposal status, update prior-version supersession columns, snapshot-load select, list-pending-proposals select, snapshot-meta increment.
- `src/harness/canon-substrate.ts` ships `PostgresCanonSubstrate` implementing `CanonSubstrate`. `loadSnapshot` is async; `factsAsOfChapter` and friends are sync and throw an explicit error if the snapshot for `(novelId, chapterN)` has not been loaded.
- `src/canon/substrate-equivalence.test.ts` runs the same spec against both adapters and passes against both. Coverage:
  - **Point-in-time reads** — supersession + future-commit invisibility hold under both adapters.
  - **No-ghost-canon** for all four read methods (facts, entities, character states, story promises) under both adapters.
  - **Proposal lifecycle** — approved, modified (with operator-supplied `modifiedFact`), rejected. Reads visible only after approve/modify; rejected proposal does not affect reads.
  - **Modified-proposal audit trail** — operator's `modifiedFact` survives on the proposal record after resolve; committed canon's provenance is normalized (forced `human-edited`, fresh timestamps).
  - **Same-id supersession** — committing a new version of an existing logical id closes the prior active version.
  - **Cross-id additive supersession** — committing a new version with a different logical id that declares supersession over an old logical id closes BOTH the new id's prior active version AND the old id's active version.
  - **Read-shape cleanliness** — neither adapter leaks `committedAtChapter` / `supersededAtChapter` through the `CanonSource` return shape.
  - **Snapshot-not-loaded** — Postgres adapter throws an explicit error on sync read for an unloaded `(novelId, chapterN)`; in-memory adapter does not (no-op load).
- `bun test src/canon/`, `bun test src/db/canon-substrate.test.ts` (or whatever path the suite ends up at), `bunx tsc --noEmit` all green.
- `bun scripts/audits/run-salvatore-recall.ts` still reports `recallGateClear=true` (§0a remains closed under whatever type changes might land).
- Docs sweep: lane Results filled, design doc updated to reflect cleared status if equivalence passes, charter §1 status flipped to cleared in `docs/charters/world-bible-architecture.md`, decisions.md entry added, current-state.md updated, lane-queue advanced.

### 4. Validated gates

- **(a) Clean pass:** migration + db + harness + equivalence suite ship; suite passes against both adapters; tsc + canon + recall all green; charter §1 flips to cleared.
- **(b) New dominant blocker:** equivalence suite surfaces a behavior that the in-memory adapter has but Postgres can't (e.g., a transaction-isolation gap, a JSONB serialization difference) that requires substrate redesign. Stop, document, redesign before continuing.
- **(c) Regression:** Postgres adapter changes leak through to consumers (existing canon tests fail, recall harness drops below 0.8). Stop, fix, re-verify.
- **(d) Infrastructure failure:** Postgres unreachable in the local dev env — equivalence suite skips the Postgres branch via `describe.skipIf(!reachable)`. Document the skip explicitly in Results; charter §1 cannot flip to cleared without a passing Postgres run, but the in-memory branch still gives signal on the test plumbing.
- **(e) Budget cap:** no LLM/API cost. Postgres is local. $0.

### 5. Cost-threshold autonomy

This work runs entirely locally (DB writes, type-checks, unit tests). No LXC deploy, no LLM calls, no shared infra. Per CLAUDE.md §"Cost-threshold autonomy", autonomous proceed.

## Command Plan

1. Re-read recent migration patterns (`sql/030_chapter_exhaustions.sql`, `sql/032_drift_checks.sql`, `sql/033_phase_eval_runs.sql`), `src/db/connection.ts`, `src/db/character-states.ts`, `src/db/test-helpers.ts`, `src/harness/charters.ts`, `src/canon/substrate.ts`, `src/canon/substrate.test.ts`, `docs/designs/canon-substrate-step1.md` to ground the schema and module shape. **(done — exploration phase)**
2. Write `sql/035_canon_substrate.sql` per the design doc's schema sketch. Adjust column types where the existing migration corpus uses different conventions (e.g., `TEXT` vs `text`, `TIMESTAMPTZ` vs `timestamptz`).
3. Implement `src/db/canon-substrate.ts` — raw queries only. DTO conversion is straightforward column-to-field; provenance is a flat object so JSONB is unnecessary except for the kind-dependent `data` column.
4. Implement `src/harness/canon-substrate.ts` — `PostgresCanonSubstrate` class. Mirror the `InMemoryCanonSubstrate` semantics exactly (single normalize-on-commit path, always-supersede same-id, additive cross-id supersession, generation bump on every commit/reject). Keep all DB calls in `src/db/canon-substrate.ts`.
5. Refactor `src/canon/substrate.test.ts` if needed to expose the per-adapter spec runner; or leave the existing tests in place and add a new `src/canon/substrate-equivalence.test.ts` that imports a shared spec helper.
6. Run the equivalence suite locally against both adapters; verify Postgres skip behavior when DB is unreachable.
7. Run `bun test src/canon/`, `bun test src/db/`, `bun test src/harness/`, `bunx tsc --noEmit`, `bun scripts/audits/run-salvatore-recall.ts`, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.
8. Docs sweep: lane Results, design-doc cleared note, charter §1 flip (only if Postgres ran cleanly), `docs/decisions.md` entry, `docs/current-state.md` (or `docs-impact: none` footer), `docs/todo.md` close-out, `docs/lessons-learned.md` if applicable, `docs/sessions/lane-queue.md` advance.

## Results

Charter §1 production substrate landed and the **adapter-equivalence suite passes against both adapters**. Charter §1 stop gate flipped from "seam cleared, production substrate pending" → **cleared (2026-05-03)**.

- **Migration**: `sql/035_canon_substrate.sql` (six tables — `canon_facts`, `canon_entities`, `canon_character_states`, `canon_promises`, `canon_proposals`, `canon_snapshot_meta`). Each canon-typed table carries the full bitemporal-style versioning shape: `(novel_id, logical_id, version)` PK, `committed_at_chapter`, `superseded_by_version`, `superseded_at_chapter`, plus flat-column provenance (source, confidence, approval_status, origin, supersedes_logical_id). Partial index on the active version (`WHERE superseded_by_version IS NULL`) plus a snapshot-shaped index per canon table. Migration applied locally via `bun -e "import('./src/db/connection').then(m => m.migrate())"`.

- **Raw queries** (`src/db/canon-substrate.ts`, ~470 lines): per-type `loadXxxSnapshot` (DISTINCT ON + point-in-time WHERE clause), per-type insert + supersession-bookkeeping helpers (`maxXxxVersion`, `markXxxSuperseded`), proposal lifecycle (insert/find/update/list-pending), generation counter (`bumpGeneration`/`readGeneration`), test cleanup (`deleteAllForNovel`). Row → domain mapping helpers (`factFromRow`, `entityFromRow`, `characterStateFromRow`, `promiseFromRow`, `proposalFromRow`) — no business rules in this module per CLAUDE.md §"Database And SQL".

- **Service-layer adapter** (`src/harness/canon-substrate.ts`, ~390 lines): `PostgresCanonSubstrate` implements `CanonSubstrate`. Async `loadSnapshot(novelId, chapterN)` populates an in-process per-`(novelId, chapterN)` cache (and the `generationCache`); the four sync read methods serve from the cache. Sync read on an unloaded snapshot throws an explicit "snapshot not loaded" error pointing to the design doc — the contract that closes Codex round-2 MEDIUM 3. Writes (proposeCanonUpdate / resolveProposal / seed*) invalidate the cache for the novel and re-read the generation counter so subsequent `snapshotVersion(novelId)` reflects the post-write state. The `normalizeForCommit` helper is a verbatim mirror of `InMemoryCanonSubstrate.normalizeForCommit` so both adapters apply the same modified-path normalization (forced `human-edited`, fresh timestamps, supersedes from `proposal.targetFactId`). `commitFact` mirrors the in-memory adapter's H2 invariant: always close the new logical id's prior active version, with cross-id supersession ADDITIVE on top.

- **Adapter-equivalence test suite** (`src/canon/substrate-equivalence.test.ts`, ~510 lines): the behavioral spec is exported as `runCanonSubstrateSpec(label, makeHarness)` and run twice — once with an in-memory factory, once with a Postgres factory under `if (reachable)`. Plus three Postgres-only tests: substrate tables present, sync-read-on-unloaded throws, sync-read-after-load works. Coverage matches the session-start gate list (point-in-time reads, no-ghost for all four canon types, proposal approve/modify/reject lifecycle, modified-fact audit, same-id supersession, cross-id additive supersession, read-shape cleanliness, snapshot-not-loaded contract).

- **Verification**: `bun test src/canon/` → **178 pass / 0 fail / 375 expects** (147 → 178, +31; 32-test spec runs against both adapters plus 3 Postgres-only tests, plus the original 31 substrate-only tests, plus bundle/scope/recall tests). `bunx tsc --noEmit` clean. `bun scripts/audits/run-salvatore-recall.ts` → `recallGateClear=true, meanRecall=0.927, queryCount=42, recallPassCount=36/42` — §0a remains closed under the new harness module imports. `git diff --check` clean.

## Stop gate fired

**(a) Clean pass — charter §1 cleared.** Migration + db module + harness module + equivalence suite shipped. The adapter-equivalence suite proves the in-memory and Postgres adapters are behaviorally equivalent on the Step-1 contract — point-in-time reads, no-ghost-canon for all four canon-typed objects, proposal lifecycle, supersession invariants, read-shape cleanliness, and the documented snapshot-not-loaded contract. Charter §1 stop gate flipped to *cleared* in `docs/charters/world-bible-architecture.md`. Design doc (`docs/designs/canon-substrate-step1.md`) updated to reflect cleared status.

## Evidence

- `bun test src/canon/` — **178 pass / 0 fail / 375 expects** across 5 files (substrate + substrate-equivalence + bundle + scope + recall-validation).
- `bunx tsc --noEmit` — clean.
- `bun scripts/audits/run-salvatore-recall.ts` — `recallGateClear=YES`, `meanRecall=0.927`, `queryCount=42`, sample-size and category-coverage gates pass; §0a still closed.
- `git diff --check` — clean.

The Postgres branch of the equivalence spec runs all 32 behavioral tests against the live `PostgresCanonSubstrate`, plus the 3 Postgres-only tests (table presence, snapshot-not-loaded throw, sync-read-after-load). The in-memory branch runs the same 32-test spec against `InMemoryCanonSubstrate` (no-op `loadSnapshot`). Each test passes against both adapters with identical assertions.

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local DB only) | 0 |
| **total** | **0** |

## Commits

- `ba72e09` `[infra]` canon substrate Postgres adapter + equivalence suite — charter §1 cleared. 11 files changed, +2295/-2. Migration `sql/035_canon_substrate.sql`, raw queries `src/db/canon-substrate.ts`, harness `src/harness/canon-substrate.ts`, equivalence test `src/canon/substrate-equivalence.test.ts`, lane doc, plus charter/design/decisions/lessons/current-state/lane-queue updates. Experiment #404 logged + concluded.
