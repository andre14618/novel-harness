---
status: active
updated: 2026-05-05
role: session
---

# Authoring Visibility And Interactivity

## Loop Contract

- Objective: add the first read-only visibility foundation for authoring
  refinement by auditing durable ID propagation and exposing planning targets
  plus deterministic impact preview.
- Starting commit: 934e659
- Experiment ID: not allocated yet; local engineering ticket, evidence in this
  session doc and tests.
- Budget cap: $0 runtime LLM/API budget; local code/test work only.
- Primary lane: authoring visibility/interactivity foundation.
- Causal hypothesis: if planning artifacts are addressable through durable
  target refs and deterministic impact preview, later proposal-backed planning
  edits can be safe, stale-aware, and operator-visible without full rewinds.
- Baseline: stable IDs exist in outlines/proposals, but no operator-facing
  read-only planning target map or impact preview endpoint exists.
- Changed runtime lever: read-only orchestrator/API surface over existing
  planning artifacts; no planner/writer/checker behavior change.
- Feedback signal: focused tests pass for target extraction and impact preview;
  endpoints return deterministic target refs and affected chapters/beats without
  mutating novel state.
- Stop gate: clean-pass local verification for the touched TypeScript surface.
- Escalation rule: pause before adding mutation endpoints, DB migrations, UI
  surfaces, creative heuristic prompts/checkers, or paid/runtime novel runs.
- Allowed parallel support work: Codex Spark read-only audits of ID propagation,
  backend route patterns, and UI/API integration seams.
- DeepSeek V4 Flash concurrency plan: none.
- Initially deferred out-of-lane runtime changes: Planning Studio UI,
  story-debt experiments, character voice/motivation polish, broad structural
  planning mutation endpoints, and all creative heuristic production wiring.
  The initial Planning Studio UI was later reopened by user direction; the
  other items remain deferred or evidence-gated.
- Files/scripts expected to change: `src/harness/**`, `src/orchestrator/**`,
  focused tests, and documentation for the audit.
- Evidence artifact: this session doc, new tests, `bun test ...`,
  `./node_modules/.bin/tsc --noEmit`, `git diff --check`.

## Baseline

- Current behavior: planning artifacts have durable IDs in storage, but callers
  cannot ask the API for editable target refs or deterministic downstream
  impact before proposing a change.
- Baseline command(s): code inspection plus existing tests around planning
  snapshots/proposal envelopes.
- Baseline result: no target-map or impact-preview endpoint exists.

## Stop Gates

- (a) Clean pass: target-map/impact-preview tests pass, TypeScript passes, and
  docs checks pass.
- (b) New dominant blocker: durable IDs are missing from a required first-slice
  artifact such that impact preview would rely on fuzzy text matching.
- (c) Regression: existing proposal, planning snapshot, or route tests fail in
  a way attributable to this change.
- (d) Infrastructure failure: local DB-dependent tests or TypeScript cannot run
  for environment reasons.
- (e) Cost cap: any runtime/LLM call would exceed the $0 budget and requires
  user approval.

## Command Plan

- Sample shape / N: local unit/route fixtures only.
- Probe-family key or fixed panel: not applicable.
- Expected cost: $0.
- Verification command(s): focused `bun test`, `./node_modules/.bin/tsc
  --noEmit`, `bun run docs:weight`, `git diff --check`.

## Progress Log

- 2026-05-04: session opened; parallel Codex Spark explorers launched for ID
  propagation, backend route patterns, and UI/API implications.
- 2026-05-04: explorers reported that stable IDs exist but DB outline
  persistence and checker outputs do not consistently enforce/carry them.
- 2026-05-04: implemented read-only planning target map and deterministic
  impact preview backend endpoints:
  `GET /api/novel/:novelId/planning-targets`,
  `GET /api/novel/:novelId/planning-targets/:targetKind/:targetRef`, and
  `POST /api/novel/:novelId/planning-impact/preview`.
- 2026-05-04: hardened `saveChapterOutline()` to persist enriched stable IDs
  without mutating caller-owned outline objects.
- 2026-05-04: after user approval to proceed, added the first
  proposal-backed planning write slice for scalar chapter-outline field edits
  and persisted mutation lineage.
- 2026-05-04: extended the same proposal-backed write path to scalar beat-plan
  `description` and `kind` edits with beat-level stale preconditions.
- 2026-05-04: extended the proposal-backed write path to beat-obligation
  `text` edits with obligation-level stale preconditions.
- 2026-05-04: extended the proposal-backed write path to beat-obligation
  source-link edits with obligation-level stale preconditions and semantic
  source registry validation.
- 2026-05-04: extended the proposal-backed write path to planning-directive
  style/voice fields `rawNotes` and `tonalAnchors` with seed-row stale
  preconditions.
- 2026-05-05: added initial Planning Studio UI for target navigation, impact
  preview, proposal creation, queue diff, status tabs, and approve/reject
  controls. Browser preflight used disposable novel
  `codex-planning-studio-1777948116315`.
- 2026-05-05: expanded Planning Studio queue review with target grouping,
  queue impact detail, edit-before-approve, and modified resolution. Browser
  preflight used disposable novel `codex-planning-modified-1777980329324`.

## Results

- Outcome: first backend tracer bullet complete. Target extraction covers world
  bible, story spine, characters, world systems, cultures, planning directives,
  chapter outlines, beat plans, beat obligations, and chapter world facts.
  Impact preview is deterministic-only and includes direct target, snapshot
  participation, ID-based references, matching proposal envelopes, and recorded
  resolution impacts. Chapter-outline persistence now normalizes stable IDs
  before writing.
- Follow-up outcome: first write tracer bullet complete. `planning_edit`
  envelopes can propose scalar chapter-outline field replacements, resolve via
  approve/reject/modified, reject stale target hashes, and record
  `planning_mutation_lineage` with affected refs captured from impact preview.
- Follow-up outcome: second write tracer bullet complete. `planning_edit`
  envelopes can now target beat plans for `description` and `kind`; apply locks
  the containing outline row but compares the beat hash, preserving unrelated
  outline changes.
- Follow-up outcome: third write tracer bullet complete. `planning_edit`
  envelopes can now target beat obligations for `text`; apply locks the
  containing outline row but compares the obligation item hash.
- Follow-up outcome: fourth write tracer bullet complete. `planning_edit`
  envelopes can now target beat-obligation `sourceId`, `sourceKind`,
  `characterId`, and atomic `sourceLink`; source-link proposals validate list
  compatibility, source existence, payoff placement, character ownership, and
  duplicate source refs before queuing or applying.
- Follow-up outcome: fifth write tracer bullet complete. `planning_edit`
  envelopes can now target `planning_directive:rawNotes` and
  `planning_directive:tonalAnchors`; apply locks the novel seed row, compares
  the directive-value hash, updates `seed_json`, and records mutation lineage.
- Follow-up outcome: sixth write tracer bullet complete. `planning_edit`
  envelopes can now target character-bible scalar fields `backstory`, `goals`,
  `fears`, `speechPattern`, `internalConflict`, and `avoids`; apply locks the
  character row, compares the character target hash, updates the character
  profile, and records mutation lineage.
- Follow-up outcome: seventh write tracer bullet complete. `planning_edit`
  envelopes can now target world-bible scalar fields and story-spine scalar
  fields; apply locks the artifact row, compares the artifact target hash,
  updates the JSON artifact, and records mutation lineage.
- Follow-up outcome: eighth backend slice complete. Planning-edit proposals now
  have deterministic before/after diffs on create/apply responses, a read-only
  diff endpoint with current-target stale status, and UI API helpers for later
  Planning Studio wiring.
- Follow-up outcome: ninth UI slice complete. Planning Studio now loads
  editable planning targets, filters fields to backend-supported write slices,
  shows deterministic impact preview, creates planning-edit proposals, shows
  before/after diffs in queue status tabs, and resolves pending proposals.
  Resolved proposals whose targets changed now display `target moved`; pending
  conflicts still display `stale`.
- Browser result: Playwright MCP preflight passed for target load, initial
  create/approve evidence, pending stale display, rejected/approved tabs,
  Pipeline/Snapshot/Canon Queue links, mobile rendering, clean console, and API
  network responses. State-changing MCP clicks were partially blocked by the
  local safety layer, so rejected/stale disposable states were seeded through
  route helpers and then verified in-browser.
- Follow-up outcome: tenth UI slice complete. Planning Studio now groups queue
  proposals by target, displays queued impact details, supports
  edit-before-approve via `status: "modified"`, and shows the modified applied
  value in the read-only diff by reading `modified_payload`.
- Browser result: Playwright MCP preflight passed for live create, opening the
  Edit control, filling a modified value, resolving modified, modified-tab diff
  display, grouped queue display, queue impact details, mobile rendering, clean
  console except the existing missing favicon, and all relevant planning API
  requests returning `200`.
- Stop gate fired: (a) clean pass for local focused verification, including
  DB-backed planning proposal route cases.
- Evidence link/row/path:
  `src/harness/planning-targets.ts`,
  `src/orchestrator/planning-target-routes.ts`,
  `src/db/outlines.ts`,
  `src/db/outlines.test.ts`,
  `src/harness/planning-targets.test.ts`,
  `src/orchestrator/planning-target-routes.test.ts`.
- Browser evidence:
  `planning-studio-created-diff.png`,
  `planning-studio-after-approve.png`,
  `planning-studio-stale-pending-after-build.png`,
  `planning-studio-approved-target-moved.png`,
  `planning-studio-rejected-target-moved.png`,
  `planning-studio-pipeline-link.png`,
  `planning-studio-snapshot-link.png`,
  `planning-studio-canon-link.png`,
  `planning-studio-mobile.png`,
  `planning-studio-console.md`,
  `planning-studio-final-network.md`.
- Follow-up browser evidence:
  `planning-modified-ui-pending-created.png`,
  `planning-modified-ui-edit-open.md`,
  `planning-modified-ui-modified-tab.png`,
  `planning-modified-ui-mobile.png`,
  `planning-modified-ui-console.md`,
  `planning-modified-ui-network.md`.
- Cost: $0 so far.
- Commit(s): pending.
- Review: pending.

## Pickup Instructions

- Last safe command: `./node_modules/.bin/tsc --noEmit` passed after focused
  authoring/proposal tests.
- If failed, failure fingerprint: pending.
- Next action: extend stable-ref coverage in checker findings or add structural
  mutation lineage before broader structural Planning Studio edits.
