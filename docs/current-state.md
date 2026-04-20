---
status: active
updated: 2026-04-19
role: canonical-current-truth
---

# Current State

This is the canonical current-state document for the novel harness.

If another document disagrees with this one about the live architecture, active pipeline, or retired components, this file wins.

## How To Use This Doc

Read this file first when you need to understand the system as it exists today.

Use the rest of the doc set like this:

- `README.md`: onboarding and quick-start
- `docs/context-engineering.md`: detailed current context/planner strategy
- `docs/experiment-design-rules.md`: experiment methodology and evaluation rules
- `docs/decisions.md`: historical decision log and rationale
- `docs/lessons-learned.md`: accumulated empirical findings
- `docs/todo.md`: backlog, not source of truth

## Operating Model

The harness is explicitly **context-engineering-forward**.

The split is:

- Planner and beat context decide what to write.
- Writer model weights decide how to write it.
- Checkers stay narrow and only police failures that plans cannot prevent reliably.

This means:

- craft is treated as a model problem, not a prompt-rules problem
- planner expressiveness and context assembly are primary quality levers
- post-hoc craft checkers are not the main path to improving prose quality

Reference:

- `docs/decisions.md` — "Context-engineering-forward architecture"

### Tracked work taxonomy

Tracked work taxonomy: all work items (tickets, training runs, evals, infra) are recorded as `tuning_experiments`.
The canonical types are defined in `src/db/ops.ts` as `TrackedWorkType`; use `'ticket'` as the default for standard engineering commits.

## Active Pipeline

### Planning and generation

- Concept and planning remain on smart frontier-style models, not an all-14B stack.
- Writer routing is genre-aware.
- For fantasy seeds, the active default is the Salvatore voice LoRA route.
- For non-matching genres, the default writer path is DeepSeek.
- **Phase-2 planner output carries structured payoff links (V1a, 2026-04-18).** Each `establishedFact` gets a stable kebab-case `id`; per-beat `requiredPayoffs: [{fact_id, payoff_beat}]` links setups to the later beat that realizes them. The writer sees resolved "SEEDS (this beat must set up…)" and "PAYOFFS DUE (this beat must realize…)" sections in beat context. The chapter-plan-checker receives the same structured links. Pilot measurement is gated on an adversary-GREEN verdict on `docs/charters/planner-phase2-contract.md`. V1b (`speaker_directives`) and V1c (`subplot_id` + `thematic_focus`) are explicitly gated on V1a results.

Primary code references:

- `src/models/roles.ts`
- `src/agents/writer/`
- `src/agents/writer/beat-context.ts` — SEEDS / PAYOFFS DUE rendering
- `src/agents/planning-beats/` — Phase-2 output producing the structured links
- `src/schemas/shared.ts` — `sceneBeatSchema.requiredPayoffs` + `payoffLinkSchema`
- `docs/context-engineering.md`
- `docs/charters/planner-phase2-contract.md`

### Active quality controls

The active narrow checkers are:

- **adherence** — `adherence-events` runs inside the beat drafting retry loop.
- **hallucination** — the beat drafting retry loop now runs `halluc-ungrounded-v2` on every beat and `halluc-leak-salvatore-v1` on Salvatore-routed beats; any fired adapter contributes blocker issues to the same targeted rewrite prompt. Leak gating is by `WRITER_GENRE_PACKS` label (`salvatore-fantasy`), not by inference model URI. OR-aggregation across checkers — one blocker from any checker forces retry. Per-adapter telemetry via `llm_calls.agent`. **2026-04-20 (exp #254 / commit `ff555bc`)**: `halluc-ungrounded` now receives a `Beat-entities:` sub-line in the WORLD BIBLE block derived at check-time from `outline.establishedFacts` + prior-beat `description` via `src/phases/beat-entity-list.ts:deriveBeatEntities`. Default is `BEAT_ENTITY_LIST_VARIANT=v1`; set `=v0` to opt out. Dropped the on-seed fire rate 44.9% → 28.9% (−16 pts; ch2+3 clean: −22.8 pts), precision 87.5% via 10-fire Sonnet adjudication, all 5 charter gates cleared. See `docs/charters/beat-entity-list-v1.md` and `docs/decisions.md` "beat-entity-list V1 shipped." Every call writes `groundedSources` provenance (`bible` / `from_brief` / `derived_outline_fact` / `derived_prior_beat` / `planner_emitted`) into `llm_calls.request_json` as nested JSONB — queryable via `#>` path operators after the concurrent fix to `logLLMCall` that stopped double-encoding.
- **chapter-plan-checker** — runs per chapter, currently **DeepSeek V3.2 base model** (swapped from the retired W&B `chapter-plan-checker-v2` SFT adapter on 2026-04-18 after a dual-oracle audit found ~92% false-positive rate on real fantasy plans). Emits beat-indexed `deviations` that route to **beat-targeted rewrites** inside the chapter attempt, not full-chapter restart. On targeted-rewrite budget exhaustion (`pipeline.maxChapterPlanRewritePasses=2`), escalates **once per chapter** to the `chapter-plan-reviser` agent (DeepSeek V3.2 @ temp 0.3, 6144 maxTokens) which produces the smallest plan-edit that would make the issues satisfiable. Revised outlines are persisted to `chapter_outlines` so a state-machine re-dispatch picks up the revision. Sanity-checked for beat-floor and character-drift before acceptance.
- **validation** — deterministic checks for word count and POV presence. Blockers route to **beat-targeted rewrites** (shortest-beat expand for word count, smallest-cast-beat-that-plans-POV for pov-missing) via the same targeted-rewrite loop as plan-check. Falls back to blind chapter restart only after targeted-rewrite budget exhaustion.

Continuity remains part of the system, but the architectural direction is that checkers stay narrow and load-bearing rather than expanding into a large craft-checker zoo.

### Retry / escalation flow (2026-04-19)

For every chapter attempt, failure paths are ordered from most-targeted to least-targeted:

1. **Per-beat adherence / hallucination** — `runBeatChecks()` in `src/phases/beat-checks.ts` aggregates checker output into `BeatIssue[]`; any blocker triggers a targeted beat rewrite with the specific issue descriptions. Budget: `pipeline.maxBeatRetries=2` per beat.
2. **Chapter-plan-checker fail** — deviations route to beat-targeted rewrites (up to `maxChapterPlanRewritePasses=2`). If the chapter plan still fails, escalate once to `chapter-plan-reviser`; restart the chapter attempt with the revised plan.
3. **Validation fail** — word-count + pov-missing blockers route to beat-targeted rewrites (same budget). Blind restart only if targeted exhaust.
4. **Continuity error (transport throw)** — blind restart. Deliberately kept as blind by design; a transient checker outage doesn't need planner intervention.

Every reviser invocation is logged to `chapter_revisions` with outcome (accepted / rejected_beat_floor / rejected_new_characters / error / skip_*), issue signature hash, and pre/post beat snapshots. Surfaced via `GET /api/novel/:id/revisions` and the Studio pipeline view's `RevisionsPanel`.

**Exhaustion-handler architecture (shipped 2026-04-19, see `docs/exhaustion-handler-design.md`):**

- Plan-check + reviser both exhausted → **`plan-assist` human gate** in web mode (`PlanAssistPanel`: override / edit-plan / abort); **`PipelineBailError`** in auto-mode (run halts loudly, `lastRunError` written to novel state).
- Validation targeted-rewrites exhausted → **validation-driven reviser escalation** (`buildContextForValidation` path, path C). If reviser rejects, falls through to the same `plan-assist` gate.
- Reviser output rejected by sanity checks → **`plan-assist` gate** with `kind="reviser-rejected"` payload.

Exhaustion events are recorded in `chapter_exhaustions` table. Query via `GET /api/novel/:id/exhaustions`; surfaced in Studio via `ExhaustionsPanel` (SSE-refreshed).

### Validation and retry shape

- Chapter-level rewriter is removed.
- Tonal pass is not auto-run.
- On-demand tonal pass remains available for comparison and archival workflows.
- Retry pressure should route through drafting / targeted issue handling, not chapter-wide rewrite passes.

Primary code references:

- `src/phases/validation.ts`
- `src/phases/drafting.ts` — beat-targeted rewrite + reviser escalation paths
- `src/phases/beat-checks.ts` — BeatIssue aggregator
- `src/agents/chapter-plan-reviser/` — planner-escalation agent
- `src/db/chapter-revisions.ts` + `sql/028_chapter_revisions.sql` — reviser telemetry
- `src/db/chapter-exhaustions.ts` + `sql/029_chapter_exhaustions.sql` — exhaustion-gate telemetry
- `src/gates.ts` — plan-assist gate type + auto-mode PipelineBailError path
- `ui/src/components/ExhaustionsPanel.tsx` — Studio SSE-refreshed exhaustion timeline
- `src/config/pipeline.ts`
- `src/orchestrator/novel-routes.ts`

## Retired Or Rejected Methodologies

These are not current strategy, even if older docs discuss them at length.

- Universal Howard-primer-style methodology as a default writing strategy: retired
- Craft encoded as large prompt-rule bundles: rejected
- Chapter-level rewriter as a core quality mechanism: removed
- Auto tonal-pass as part of the normal production pipeline: off

If a historical doc describes one of the above as current, treat that as historical context rather than live guidance.

## Current Improvement Philosophy

Systematic improvement should prefer these levers in order:

1. Planner output quality and expressiveness
2. Beat-context delivery and constraint clarity
3. Narrow checker calibration on real failure modes
4. Writer model / LoRA upgrades

Improvement should not default to:

- adding new craft checkers
- encoding style theory into long system prompts
- multiplying post-hoc quality passes

## Canonical Verification Gates

When the runtime, orchestration, or type surfaces change, these are the core checks:

```bash
./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit
./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
bun build --target bun src/index.ts --outfile /tmp/index.js
bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js
bun test
```

If a change affects model cost accounting, also verify representative `getTokenCost()` calls stay finite.

If a change affects eventing or orchestration, verify the backend event contract and process supervision path explicitly.

## Preflight Invariants

Structural-property checks that run as blocking preflight gates — the shift-left layer between tests and Codex review. Canonical invocation: `bun scripts/preflight.ts`. Five invariants are live (exp #243 shipped the initial slate; exp #244 widened #5; exp #246 tightened the baseline; exp #245 subsumed by #244); each targets a recurring bug class previously caught only by Codex. See `docs/invariants.md` for the canonical registry (assertion text, pattern docs, allowlist policy) — that file is the source of truth.

Live checks:

- **#1 revisionUsed restart persistence** (runtime) — reviser hard-cap holds across mid-run process restart. `src/phases/drafting-revision-used-persistence.test.ts`.
- **#2 Seam-recheck symmetry** (syntactic, AST) — every `chapter-plan-checker` / `chapter-plan-reviser` / `validateChapterDraft` call site inside `src/phases/drafting.ts` has a matching `inject.forceXxx` guard within ±50 source lines, including settle-loop rechecks. `scripts/lint/invariants-check.ts` `checkSeamRecheckSymmetry()`.
- **#3 Trace-seeded watcher** (syntactic, AST) — any test file that references SSE/trace event shapes must route through `watchForExpectations` / `watchForTerminal` (which seed from `GET /trace` before attaching the live stream). `scripts/lint/invariants-check.ts` `checkTraceWatcher()`.
- **#4 Branch-symmetric event emission** (runtime, narrow) — auto-mode and web-mode both emit `gate:plan-assist` with matching payload; drives through real `src/gates.ts` without mocking. `src/phases/drafting-reviser-escalation.test.ts`.
- **#5 Body-already-used detection** (syntactic, AST) — widened from template-literal regex to a TypeScript compiler API walk (exp #244, 2026-04-19). Groups body-consuming calls (`.text()` / `.json()` / `.arrayBuffer()` / `.blob()`) by `(enclosingFunction, receiverDeclaration)` and flags any source-ordered pair whose branch-containing-first does NOT unconditionally terminate (throw / return / continue / break, including try-blocks where both try-last and catch-last return; `switch` default-arms recognized). Default run scans ~112 sites repo-wide; `.claude/invariants-allowlist.yaml` `entries: []` (all 4 prior short-circuit-error-throw entries retired — reachability heuristic handles them natively). Loop-statement terminators and receiver-alias tracking deferred as conservative false negatives (flagged in `docs/invariants.md` known limitations). Regression belt: template + sequential + json-first fixtures under `tests/invariants-fixtures/`. `scripts/lint/invariants-check.ts` `checkBodyAlreadyUsed()`.

Baseline at ship time: `BASELINE_TEST_FAILURES = 0` in preflight (tightened 2026-04-19, exp #246) — the cross-file `bun:test` mock-pollution issue was fixed by extending the `mock.module("./beat-checks", ...)` factories in `drafting-reviser-escalation.test.ts` and `drafting-revision-used-persistence.test.ts` to re-export the full module shape (`aggregateIssues` + `formatRetryLine` + `summarizeIssues`). `bun test src/` now 71/0; any new failure fails preflight immediately.

## Documentation Contract

To keep the repo from drifting:

### Canonical source rule

For live architecture and runtime behavior, this file is the canonical source of truth.

### Same-commit update rule

If a commit changes current runtime behavior, architecture, or active methodology, it must do one of the following:

- update `docs/current-state.md` in the same commit, or
- include `docs-impact: none` in the commit body

`docs-impact: none` means the author explicitly checked and concluded that the change does not alter the current-state contract.

### Document roles

Use these categories consistently:

- **Current truth**: `docs/current-state.md`
- **Onboarding**: `README.md`
- **Method/rules**: `docs/experiment-design-rules.md`
- **Historical notebook**: `docs/decisions.md`, `docs/lessons-learned.md`, experiment reports
- **Backlog/drafts**: `docs/todo.md`, charters, in-flight planning docs

Do not treat historical notebook docs as canonical current-state references.

## Update Checklist

When changing the live system, check these questions:

- Did the active writer route change?
- Did the active checker set change?
- Did a component move from active to retired, or vice versa?
- Did the retry/validation path change?
- Did the canonical verification gates change?
- Did the methodology change at the architecture level, not just as an experiment?

If yes, update this file.

## Current Session (2026-04-19)

- **Exhaustion-handler architecture fully shipped.** All five design-memo steps are live: plan-check escalation to chapter-plan-reviser, validation-path reviser escalation (path C), `plan-assist` human gate (web mode: `PlanAssistPanel` override/edit-plan/abort; auto-mode: `PipelineBailError`), `chapter_exhaustions` telemetry table + `GET /api/novel/:id/exhaustions` + `ExhaustionsPanel` in Studio.
- **Debug-injection MVP live.** `src/config/debug-injection.ts` with `DEBUG_FORCE_PLAN_CHECK`, `DEBUG_FORCE_VALIDATION`, `DEBUG_FORCE_REVISER` env flags. Campaign tests R0/R1/R5/R6/R7 all passing; R2/R3/R4 in flight with 15-minute web-mode timeouts.
- **Preflight invariants shipped (exp #243).** Five blocking preflight checks live via `bun scripts/preflight.ts` — covers restart persistence, seam-recheck symmetry, trace-seeded SSE watcher discipline, branch-symmetric event emission, and body-already-used detection. Commits `ce6452c`, `10ce979`, `7afe4dd`, `dedc0b6`, `2c29b91`. Registry at `docs/invariants.md`. Codex final verdict PASS after two fix-pass iterations.
- **Next pending work (from Codex follow-on reviews):** V2 transport-interceptor (Codex ae23f96a5f5cf8247) as the durable replacement for scattered env-flag injection seams; `src/invariants/debug.ts` centralized assertion module; historical-superseded doc pass across decisions.md + adapter-changelog.md + lessons-learned.md + fine-tuning-strategy.md + adapter-training-reference.md + retry-surface-audit.md (Codex ac11a277b179df8b0).

## Current Session (2026-04-20)

- **beat-entity-list V1 shipped (exp #254).** `halluc-ungrounded` now receives a `Beat-entities:` sub-line derived at check-time from `outline.establishedFacts` + prior-beat `description` via `src/phases/beat-entity-list.ts:deriveBeatEntities`. On-seed fire rate dropped 44.9% → 28.9% (−16 pts), precision 87.5% on 10-fire Sonnet adjudication, all 5 charter gates cleared. `BEAT_ENTITY_LIST_VARIANT=v1` is now the default. See hallucination bullet above (line 76) for full detail + commit SHAs.
- **Cross-genre smoke (exp #255) confirmed safe.** Non-Salvatore seeds show no regression with the V1 default.
- **`logLLMCall` double-encoding fix (commit `ff555bc`).** `llm_calls.request_json` was being stored as a double-encoded string; now stored as proper JSONB. Grounded-sources provenance is queryable via `#>` path operators.

## Current Known Gaps

These are known cleanup items, not contradictions in the operating model:

- Root TypeScript still has a bounded set of implicit-`any` row-mapping errors.
- Historical docs still contain valid context mixed with stale current-tense statements.
- The repo still needs discipline around classifying docs as current-truth vs historical notes.

Those are documentation/process debt items, not a reason to fork the methodology again.
