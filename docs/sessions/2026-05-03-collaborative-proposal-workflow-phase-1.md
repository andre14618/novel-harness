---
status: cleared
updated: 2026-05-03
role: lane
session: 2026-05-03-collaborative-proposal-workflow-phase-1
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
parent-lane: docs/sessions/2026-05-03-collaborative-proposal-workflow-plan.md
---

# Lane — Collaborative Proposal Workflow Phase 1: Planner Source Items → Pending Canon Proposals

## Session-Start Contract

### 1. Goal + component

Land Phase 1 of `docs/designs/collaborative-proposal-workflow.md`: a `src/harness/` service that converts mechanically-valid planner source items (`fact`, `knowledge`, `state` rows on `ChapterOutline`) into pending `CanonUpdateProposal` rows via the existing `PostgresCanonSubstrate`, with idempotency keyed on `(novelId, sourceItemId, schemaVersion)` and no-ghost-canon enforcement proven by tests.

Component scope:

- `src/harness/planner-canon-proposals.ts` (new) — public service `generatePlannerCanonProposals(novelId, outlines, opts)` that:
  1. Runs `runPlannerCanonDeltaAudit` from `src/canon/planner-canon-delta.ts` as the mechanical gate. If `idGraphGateClear === false`, returns the gate report and writes no proposals.
  2. Walks every source item across every chapter; converts `fact`/`knowledge`/`state` rows to `CanonUpdateProposal` payloads.
  3. Computes a deterministic proposal id from `(novelId, sourceItemId, schemaVersion)` so re-runs are idempotent.
  4. Inserts via a new `insertProposalIfAbsent` helper (`ON CONFLICT (id) DO NOTHING`) so a re-run of the same outlines is a no-op write.
  5. Returns `{ created, skipped, gateReport, gateClear }`.
- `src/db/canon-substrate.ts` — add `insertProposalIfAbsent` (atomic insert-or-skip; preserves the existing `insertProposal` for callers that want a hard error on duplicate).
- `src/canon/api.ts` — extend `Provenance` only as required: a `schemaVersion?: string` flag is *not* added at this layer; the schema version lives in proposal-id construction and in `data.schemaVersion` on the CanonFact, so it round-trips through canon without changing the core type.
- `src/harness/planner-canon-proposals.test.ts` (new) — fixture + DB-integration tests (skipIf-unreachable Postgres branch). Covers:
  - Mechanical gate fails → no proposals written.
  - Each `fact`/`knowledge`/`state` source item produces exactly one pending proposal with the right `proposedFact.id`, `proposedFact.kind`, `data.sourceItemId`, and provenance.
  - Pending proposals are absent from `factsAsOfChapter` reads (no-ghost-canon).
  - Approving a planner proposal → committed canon includes the fact.
  - Rejecting a planner proposal → canon stays clean.
  - Re-running the service is idempotent: same input produces 0 new rows on the second call.

Out of scope this session: review API endpoints, Studio review UI, autonomous policy engine, artifact-patch proposals, prose-edit proposals, editorial flag proposals, generic proposal-table migration. Phase 2+ work per the design doc.

### 2. Why

Plan rationale (`docs/designs/collaborative-proposal-workflow.md`): the smallest useful tracer-bullet for the proposal-flow architecture is converting planner source items into pending Canon proposals. It exercises the existing substrate (Step 1 cleared), preserves the work of Step 2C semantic labeling without making auto-commit a prerequisite, and unlocks the review path for human-confirmed Canon — the immediate user direction after Step 2C ("collaborative ideation/editing with reliable mechanics" > "evaluate planner direct auto-commit").

The recommended-next-lane block in the design doc names this exact slice and pins the stop gate: clean pass if one existing novel produces pending proposals idempotently, approval/rejection works through the substrate, and no-ghost-canon tests pass.

### 3. What is measurable

Work is complete when:

- `bun test src/harness/planner-canon-proposals.test.ts` — passes against InMemory + Postgres adapters (skipIf-unreachable for Postgres).
- `bun test src/canon/` — all 182 prior tests still green plus the new harness tests.
- `bunx tsc --noEmit` — clean.
- `bun scripts/audits/run-salvatore-recall.ts` — `recallGateClear=true, meanRecall=0.927` (no §0a regression).
- The new service handles a real outline shape: a fixture-driven test reads a small synthetic outline (3 chapters, ~30 source items) and verifies the expected proposal count + per-source provenance + idempotency.
- Re-running `generatePlannerCanonProposals` against the same outlines on the same novel-id is a no-op write — 0 new rows.
- Mechanical gate fails close: a fixture with duplicate IDs (or invalid IDs) refuses to write proposals and returns `gateClear=false` + the audit report.

### 4. Validated gates

- **(a) Clean pass:** service ships; harness + DB tests pass against both adapters; no-ghost-canon proven by test; mechanical-gate fail-closed proven by test; idempotency proven by test; tsc + recall clean.
- **(b) New dominant blocker:** fact-only `CanonUpdateProposal` cannot represent knowledge/state without misleading semantics (the design doc's stop-gate condition). If, while wiring this, it becomes obvious that storing knowledge/state as `kind="character_state"` / `"knowledge_change"` corrupts later read paths, stop and decide whether to expand `CanonUpdateProposal` first. (Working hypothesis: `FactKind` already covers all three, so this won't fire — but the test should explicitly assert reads come back with the right `kind`.)
- **(c) Regression:** existing canon equivalence tests fail, or §0a recall drops. Stop, fix, re-verify.
- **(d) Infrastructure failure:** Postgres unreachable → harness tests skip Postgres branch via `describe.skipIf(!reachable)`. In-memory branch still gives signal.
- **(e) Budget cap:** no LLM/API cost. Local DB only. $0.

### 5. Cost-threshold autonomy

Local code + tests only; no LXC deploy, no LLM calls, no shared infra. Per CLAUDE.md §"Cost-threshold autonomy", proceed.

## Command Plan

1. Read current surfaces — `runPlannerCanonDeltaAudit`, `ChapterOutline` schema, `CanonUpdateProposal` shape, `PostgresCanonSubstrate.proposeCanonUpdate`/`resolveProposal`, the `canon_proposals` row shape. **(done — exploration phase)**
2. Add `insertProposalIfAbsent` to `src/db/canon-substrate.ts` (`ON CONFLICT (id) DO NOTHING RETURNING id` — returns whether it inserted).
3. Implement `src/harness/planner-canon-proposals.ts`:
   - Public `generatePlannerCanonProposals(novelId, outlines, opts)`.
   - Constant `PLANNER_PROPOSAL_SCHEMA_VERSION = "v1"`.
   - Deterministic id template: `planner:${novelId}:${sourceItemId}:${schemaVersion}`.
   - Per-kind mapping: `fact → kind="established_fact"`, `knowledge → kind="knowledge_change"` (`data.characterId`, `data.characterName`), `state → kind="character_state"` (`data.characterId`, `data.characterName`, `data.location`, `data.emotionalState`, `data.knows`, `data.doesNotKnow`).
   - `provenance.source`: `planner-output` for facts; `planning-state-mapper` for knowledge/state.
   - `provenance.origin = "planned"`.
   - `provenance.chapter = item.chapterN`.
   - `provenance.extractorVersion = "planner-${schemaVersion}"`.
4. Tests — fixture builder + harness scenarios:
   - Synthetic 3-chapter outline; 12 facts + 9 knowledge + 9 state; 30 total source items.
   - InMemory + Postgres branches.
5. Verification: bun test src/canon/ + bun test src/harness/planner-canon-proposals.test.ts + tsc + recall + docs sweep.
6. Docs sweep: lane Results, design-doc cleared marker, decisions entry, lessons-learned (if applicable), todo close-out for the "human-confirm Step 2C" line in lane-queue (this work supersedes part of it — the proposal queue is the way human-confirm becomes reviewable; precision/recall/F1 still pending).

## Results

Phase 1 cleared. The new harness service `src/harness/planner-canon-proposals.ts`
turns mechanically-valid planner source items (`fact`/`knowledge`/`state`
rows on `ChapterOutline`) into pending `CanonUpdateProposal` rows backed by
the existing `PostgresCanonSubstrate`. Highlights:

- **Mechanical gate fail-closed** — `runPlannerCanonDeltaAudit` runs first;
  on `idGraphGateClear=false` the service writes nothing and returns the
  audit report. Test `gate failure → no proposals written` proves the
  property end-to-end (duplicate id across chapters → 0 rows in
  `canon_proposals`).
- **Per-kind FactKind mapping** — `fact → established_fact`,
  `knowledge → knowledge_change`, `state → character_state`. Per-kind
  `ProvenanceSource`: `fact → planner-output`, knowledge/state →
  `planning-state-mapper`. Validated by `each kind maps to the right
  CanonFact.kind + ProvenanceSource`.
- **Idempotency** — deterministic id template
  `planner:<novelId>:<sourceItemId>:<schemaVersion>` + `INSERT … ON
  CONFLICT (id) DO NOTHING` via `insertProposalIfAbsent`. First run
  creates 30 / skips 0; second run on the same outlines creates 0 / skips
  30. DB row count stays at exactly 30. An operator's `rejected` /
  `approved` resolution survives reruns (the deterministic id collides;
  ON CONFLICT refuses to overwrite).
- **No-ghost-canon** — pending proposals are absent from
  `factsAsOfChapter` / `entitiesAsOfChapter` /
  `characterStatesAsOfChapter` / `promisesAsOfChapter` reads. The
  property is enforced by the substrate (proposals live in
  `canon_proposals`; reads come from `canon_facts` etc.); the new tests
  exercise it end-to-end through the new write path.
- **Approve / reject lifecycle** — approving one proposal commits a
  `CanonFact` with `approvalStatus="human-approved"` and the fact
  appears at and after the source-item chapter. Rejecting another
  removes it from pending without writing canon. Both paths verified
  against the live `PostgresCanonSubstrate.resolveProposal`.

The harness exposes both a pure mapping function
(`buildPlannerCanonProposals` — gate + payload, no DB) and the writer
(`generatePlannerCanonProposals` — same plus `insertProposalIfAbsent`).
The pure layer is what tests assert against without a database, and
review-preview / dry-run UIs in Phase 2 will use the same surface.

Test count delta: +18 harness tests (all green). Canon suite stays at
196/196.

## Stop gate fired

Gate (a) — clean pass. Service ships with the documented acceptance:
mechanical-gate fail-closed, no-ghost-canon, approve/reject through the
substrate, and idempotent rerun. tsc clean, recall audit clean.

## Evidence

- `bun test src/harness/planner-canon-proposals.test.ts` — **18 pass / 0 fail / 440 expect() calls / 3.44s**
- `bun test src/canon/` — **196 pass / 0 fail / 446 expect() calls / 3.85s**
- `bunx tsc --noEmit` — clean (no output)
- `bun scripts/audits/run-salvatore-recall.ts` — `meanRecall=0.927, recallGateClear=YES` (no §0a regression)
- Commit SHA: `acf67c2` ([feat] collaborative proposal workflow Phase 1 — planner source items become pending Canon proposals)
- Experiment: `406` (charter world-bible-architecture, status=shipped)

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local only) | 0 |
| **total** | **0** |

## Commits

- `acf67c2` — `[feat] collaborative proposal workflow Phase 1 — planner source items become pending Canon proposals`. Includes the new harness service + 18 tests, the `insertProposalIfAbsent` DB helper, the `runPlannerCanonDeltaAudit` strict dep (`src/canon/planner-canon-delta.ts` + tests), this lane doc, the design doc + parent lane doc, plus targeted docs sweep entries (decisions §"Collaborative proposal workflow Phase 1 cleared", lessons-learned ×2 in Substrate Adapter Design, current-state latest comment, todo Phase 2 line + Step 2C downgrade, lane-queue advance).
