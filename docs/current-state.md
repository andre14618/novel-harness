---
status: active
updated: 2026-04-30
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
- **All DeepSeek-using slots route to V4 Flash** (V3.2 → V4 Flash swap landed 2026-04-29, commit `eb2993d`). Single API model; thinking mode is a per-agent toggle. **Thinking ON only on three slots**: `planning-beats` (per-chapter beat sequencing + state-flow tracking), `chapter-plan-checker` (cross-beat coherence judgment), `chapter-plan-reviser` (minimal-edit plan diff). Decision rule + rationale in the comment block above `deepseekV4Flash` in `src/models/roles.ts`. V4 Pro exists in the registry as a reasoning-tier escalation but is NOT routed by default (~12× output cost vs Flash at base rate; reserved for cases where Flash thinking proves insufficient).
- Writer routing is no longer genre-swapped. All genres use the base `beat-writer` assignment: DeepSeek V4 Flash non-thinking with the base beat-writer prompt and rich/default beat context.
- Fantasy seeds still receive Salvatore-derived **structural priors** in planning, but those priors no longer imply a writer LoRA, compact context, route-specific system prompt, or corpus-leak checker.
- Writer-layer LoRA routing is retired from runtime. Historical Salvatore/tonal adapters remain only as archived experiment artifacts, not active workflow dependencies.
- **Phase-2 planner output carries structured payoff links (V1a, 2026-04-18).** Each `establishedFact` gets a stable kebab-case `id`; per-beat `requiredPayoffs: [{fact_id, payoff_beat}]` links setups to the later beat that realizes them. The writer sees resolved "SEEDS (this beat must set up…)" and "PAYOFFS DUE (this beat must realize…)" sections in beat context. The chapter-plan-checker receives the same structured links. **Pilot not yet run.** The original `docs/charters/planner-phase2-contract.md` received a RED adversary verdict on 2026-04-18 and was superseded by `docs/charters/planner-phase2-payoff-floor.md` (status: `proposed`, adversary-verdict: `pending`). The payoff-floor charter asks the cheaper causal question from `pre-planner-phase2-v1a`: does an aggressive prompt-only floor recover most of the V1a lift? Pilot gate: 3-arm paired ablation, novels named `pp2-floor__<arm>__<seed>__<timestamp>`. V1b (`speaker_directives`) and V1c (`subplot_id` + `thematic_focus`) remain gated on the pilot result.

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

- **adherence** — `adherence-events` runs inside the beat drafting retry loop on DeepSeek V4 Flash non-thinking. It combines deterministic character-presence checks with a bounded event-enactment JSON call.
- **entity grounding** — `halluc-ungrounded` runs on every beat on DeepSeek V4 Flash non-thinking. It checks named entities against the writer-visible evidence surface. The Salvatore/Forgotten-Realms corpus-leak checker is retired because it was coupled to the removed writer-LoRA route.
- **functional story-state checks** — `src/harness/enforce.ts` sanitizes invalid optional payoff scaffolding during planning so empty/missing/non-forward payoff links do not survive into drafting. `src/phases/functional-checks.ts` still blocks deterministic payoff graph failures that remain after enforcement, such as duplicate fact IDs or invalid links on manually edited outlines. `functional-state-checker` then uses bounded DeepSeek V4 Flash non-thinking to judge whether planned facts/knowledge/state are semantically grounded in the chapter prose; those semantic findings are warning-class until oracle calibration.
- **checker blocker policy** — unresolved beat-check blocker issues accepted after retry exhaustion, continuity `blocker` issues, and deterministic functional blockers halt chapter approval through the existing plan-assist exhaustion gate instead of being appended to the approved draft. Continuity location findings based only on previous-chapter state are warning-class because characters can move plausibly between chapters; knowledge impossibilities can still block. Word-count overshoot remains warning-class.
- **lint/prose integrity guard** — after deterministic/LLM lint fixes run, `src/lint/integrity.ts` rejects malformed post-fix prose before `saveChapterDraft()` overwrites the raw draft. Before human/auto approval, the same deterministic guard blocks malformed final prose with fused boundaries, dropped-space camel fusions, adjacent duplicate sentences, nearby duplicate fragments, and quote-integrity failures. Failures emit `lint-fix-rejected` or `prose-integrity-check` trace events and retry the chapter instead of approving corrupted prose.
- **chapter-plan-checker** — runs per chapter, currently **DeepSeek V4 Flash base, thinking mode ON** (V3.2 → V4 Flash swap landed 2026-04-29; was V3.2 base swapped from the retired W&B `chapter-plan-checker-v2` SFT adapter on 2026-04-18 after a dual-oracle audit found ~92% false-positive rate on real fantasy plans). Emits beat-indexed `deviations` that route to **beat-targeted rewrites** inside the chapter attempt, not full-chapter restart. On targeted-rewrite budget exhaustion (`pipeline.maxChapterPlanRewritePasses=2`), escalates **once per chapter** to the `chapter-plan-reviser` agent (**DeepSeek V4 Flash thinking ON** @ temp 0.3, 6144 maxTokens) which produces the smallest plan-edit that would make the issues satisfiable. Revised outlines are persisted to `chapter_outlines` so a state-machine re-dispatch picks up the revision. Sanity-checked for beat-floor and character-drift before acceptance.
- **validation** — deterministic checks for word count and POV presence. Blockers route to **beat-targeted rewrites** (shortest-beat expand for word count, smallest-cast-beat-that-plans-POV for pov-missing) via the same targeted-rewrite loop as plan-check. Falls back to blind chapter restart only after targeted-rewrite budget exhaustion.

Continuity remains part of the system, but the architectural direction is that checkers stay narrow and load-bearing rather than expanding into a large craft-checker zoo.

### Retry / escalation flow (2026-04-19)

For every chapter attempt, failure paths are ordered from most-targeted to least-targeted:

1. **Per-beat adherence / entity grounding** — `runBeatChecks()` in `src/phases/beat-checks.ts` aggregates checker output into `BeatIssue[]`; any blocker triggers a targeted beat rewrite with the specific issue descriptions. Budget: `pipeline.maxBeatRetries=2` per beat.
2. **Accepted beat-check blocker after retry exhaustion** — the beat may still be kept so the chapter can finish assembling, but the unresolved blocker is retained as a chapter-level approval blocker and routes to the plan-assist exhaustion gate before approval.
3. **Chapter-plan-checker fail** — deviations route to beat-targeted rewrites (up to `maxChapterPlanRewritePasses=2`). If the chapter plan still fails, escalate once to `chapter-plan-reviser`; restart the chapter attempt with the revised plan.
4. **Validation fail** — word-count + pov-missing blockers route to beat-targeted rewrites (same budget). Blind restart only if targeted exhaust. Word-count overshoot is warning-only.
5. **Functional story-state blocker** — deterministic payoff graph blockers route to the plan-assist exhaustion gate before approval. Semantic grounding findings from `functional-state-checker` are displayed in approval content but do not block.
6. **Continuity blocker** — continuity issues with severity `blocker` route to the plan-assist exhaustion gate before approval. Previous-state location findings are normalized to warning-class; the previous chapter's location is a starting hint, not an immovable constraint. Continuity transport errors still blind-restart because they are checker availability failures, not story findings.
7. **Prose-integrity blocker** — malformed final prose (duplicate adjacent spans, fused boundaries, malformed quotes) retries the chapter before approval.

Every reviser invocation is logged to `chapter_revisions` with outcome (accepted / rejected_beat_floor / rejected_new_characters / error / skip_*), issue signature hash, and pre/post beat snapshots. Surfaced via `GET /api/novel/:id/revisions` and the Studio pipeline view's `RevisionsPanel`.

**Exhaustion-handler architecture (shipped 2026-04-19, see `docs/exhaustion-handler-design.md`):**

- Plan-check + reviser both exhausted → **`plan-assist` human gate** in web mode (`PlanAssistPanel`: override / edit-plan / abort); **`PipelineBailError`** in auto-mode (run halts loudly, `lastRunError` written to novel state).
- Validation targeted-rewrites exhausted → **validation-driven reviser escalation** (`buildContextForValidation` path, path C). If reviser rejects, falls through to the same `plan-assist` gate.
- Reviser output rejected by sanity checks → **`plan-assist` gate** with `kind="reviser-rejected"` payload.

Exhaustion events are recorded in `chapter_exhaustions` table. Query via `GET /api/novel/:id/exhaustions`; surfaced in Studio via `ExhaustionsPanel` (SSE-refreshed).

### Validation and retry shape

- Chapter-level rewriter is removed.
- Tonal/voice LoRA generation is retired from runtime.
- Historical tonal-pass chapter versions can still be displayed for comparison, but new tonal-pass generation returns `410 Gone`.
- Retry pressure should route through drafting / targeted issue handling, not chapter-wide rewrite passes.

Primary code references:

- `src/phases/validation.ts`
- `src/phases/drafting.ts` — beat-targeted rewrite + reviser escalation paths
- `src/phases/beat-checks.ts` — BeatIssue aggregator
- `src/phases/functional-checks.ts` — deterministic payoff graph checks
- `src/agents/functional-state-checker/` — bounded semantic planned-state grounding check
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
- Writer-layer voice LoRA routing: retired from runtime
- Route-specific Salvatore corpus-leak checker: retired with the writer-LoRA route
- Craft encoded as large prompt-rule bundles: rejected
- Chapter-level rewriter as a core quality mechanism: removed
- Tonal/voice LoRA generation: retired from runtime

If a historical doc describes one of the above as current, treat that as historical context rather than live guidance.

## Current Improvement Philosophy

Systematic improvement should prefer these levers in order:

1. Planner output quality and expressiveness
2. Beat-context delivery and constraint clarity
3. Narrow checker calibration on real failure modes
4. Writer model upgrades

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

## Current Session (2026-04-21)

- **Quality-redraft gate shipped (behind flag, default OFF).** Commit `893bb26`. Two quality detectors live in `src/lint/quality-detectors.ts` (repetition-loop + underlength, 24 unit tests). `detectSyncDefects()` is wired into `src/phases/drafting.ts`; when detectors fire, the beat is redrafted from scratch (no V1 prose in context, no critique) rather than retried with critique. Flag: `pipeline.qualityRedraftEnabled` (default `false`); per-novel override via `seed.pipelineOverrides.qualityRedraftEnabled` (commit `e8b2bb6`). **Measurement (novel PID 315593) completed 2026-04-21: 0 redraft fires** despite flag on — detector thresholds likely too strict to trigger on real Salvatore-route production prose. Flag stays default OFF. Counted as signal #3 in the 2026-04-21 LoRA-track-evidence retrospective. See `docs/retrospectives/2026-04-21-lora-track-evidence.md` and `docs/decisions.md` "Salvatore v4 LoRA cannot rewrite with critique."
- **`src/agents/writer/retry-context.ts` extracted** (commit `3c5313d`). `buildRetryPrompt()` logic moved from inline drafting.ts to this dedicated module. Canonical source for retry-prompt construction — future probe harnesses and test fixtures should import from here.
- **`src/lint/quality-detectors.ts` is a new production module** (commit `ea74d90`). Repetition-loop detector + underlength detector, 24 unit tests. Future per-beat quality signals go here before wiring into the gate.
- **Salvatore conditioning-floor KILLED** (commit `639712e`, exp #258). Per-beat exampleLines rotation lost 7/20 to fixed preset-a on blind Sonnet pairwise distinctness judgment. Three auto-resolved pairs due to underlength (<50 words). Rotation also showed repetition-loop degeneration. Conditioning tricks are a closed chapter. Next lever: `salvatore-v5-corpus-expansion` (separate charter, pre-gated on PDF acquisition).
- **Parity harness SOP formalised** (commit `edb630a`). §4.7 added to `docs/experiment-design-rules.md`; new bullet in experiment charter template; pre-run checklist item. Canonical implementation: `scripts/evals/conditioning-floor-parity-check.ts`. Codex SOP-audit confirmed the rule and scope language as written.
- **Three-layer doctrine: Codex challenge noted.** Codex independent evaluation (jobs `bre6gu89b`, `bsbwl0v3g`) pushed back on "voice lives only in weights, editors can't add craft" as unproven and architecturally inconsistent — the quality-redraft gate is itself a cross-layer intervention. Doctrine not retracted but the absolute "don't cross streams" framing is softened: the layer assignments describe default optimization strategy, not a hard prohibition on context-engineering interactions across layers.
- **Rewrite-capability-probe charter: round-1 RED, not yet re-reviewed.** Commits `ca76090` + `d36bfae`. The rigorous probe (`eb3e7c8`) provided the decisive empirical evidence; charter needs a round-2 pass or formal withdrawal per `docs/todo.md`.

### Late 2026-04-21 — voice-LoRA track pivot + voice-shaping ablation

- **LoRA-track pivot committed.** Commit `1af5189` froze new LoRA investment; exp #272 later retired writer-LoRA runtime routing entirely. The current runtime writer path is DeepSeek V4 Flash for all genres, with fantasy structural priors feeding planning only.
- **2026-04-21 retrospective doc.** `docs/retrospectives/2026-04-21-lora-track-evidence.md` — first entry in the new `docs/retrospectives/` directory class per Codex consult doc-scope correction (retrospectives capture evidence arcs; decisions.md captures decisions; lessons-learned.md captures distilled rules; current-state captures live truth). Status: draft until voice-shaping-ablation-v1 resolves.
- **Three new lessons-learned rules** (commit `1af5189`): (1) N≥3-round step-back rule from the 9-round arm-b-preflight arc; (2) AI-judge pairwise bias-confound when length correlates with arm identity; (3) 14B-voice-fine-tune failure mode is scale-specific, not thesis-wide.
- **Charter lineage through the 2026-04-21 arc:**
  - `docs/charters/arm-b-detector-preflight.md` — 9 rounds, eventually superseded by arm-b-direct-pairwise per meta-consult
  - `docs/charters/arm-b-direct-pairwise.md` (revision 2) + results memo — CAUTION 11-9
  - `docs/charters/arm-d-writer-upgrade.md` (revision 3) + results memo — formal adjudication skipped per Codex design consult; pivot committed on directional evidence
  - `docs/charters/voice-shaping-ablation-v1.md` (revision 2) — first experiment under the post-pivot architecture
- **New infrastructure under the pivot** (commit `34898d3`):
  - `scripts/evals/voice-shape-metrics.ts` — 5-feature voice-shape extraction (mean sentence length, sentence-length std, dialogue ratio, clause complexity, sensory density), per-feature standardized distance to a reference, `countImprovedFeatures` for charter's "≥3 of 5" rule. 16 unit tests.
  - `scripts/evals/voice-shape-reference.json` + `voice-reference-passages.json` — frozen 10-passage Salvatore reference distribution (stratified 3/3/2/2 across kinds) + 5 few-shot excerpts. Deterministic via seed `voice-shape-reference-v1-2026-04-21`.
  - `src/agents/writer/voice-shaping-prompts.ts` — prompt fragments for D1 (style guide), D2 (few-shot reference passages), D3 (character voice directives). NOT imported from production paths.
  - `scripts/evals/run-voice-shaping-ablation.ts` — 4-arm runner with inline parity assertions.
- **React UI: pairwise adjudication page** at `/app/pairwise/:bundle`. Commit `41df605` + `d9536cf`. Server-side packet parsing, one-at-a-time review with keyboard shortcuts (1/2/3 → label+advance; ←/→ step), auto-save on click, "Compute verdict" button appears when all packets labeled. Used for arm-b-direct-pairwise-v1 (completed) and arm-d-writer-upgrade-v1 (skipped per consult); generalized to any `set_name` in `eval_results` with two distinct cell_labels.
- **Post-Codex-consult process discipline.** After the arm-b preflight hit 9 rounds, meta-consult became the canonical "is this the right instrument" check. Three meta-consults in the 2026-04-21 arc (`a738b4bb2879c39d0` shape; `acc1b47d14ce265f4` strategic pivot; `ae0e768d3292eb256` decomposed-audit design) each redirected material work — documented as a repeatable pattern in lessons-learned.

### Late 2026-04-21 — autonomous-loop roadmap revision 2 + tier-ordering-validation killed

- **Autonomous-loop roadmap revision 2 landed** (commit `db9d8f6`, `docs/autonomous-loop-roadmap-2026-04-21.md`). Applied Codex adversarial review of revision 1: tier reorder, Tier 1.5 concept named, prerequisites enumerated, exit criteria tightened, 2×2 counterfactual design added.
- **`tier-ordering-validation-v1` charter fully killed.** Full lineage: draft charter (commit `76a7667`) → Opus `experiment-adversary` RED verdict recorded (commit `cca9f57`, 7 blockers + 4 warnings + a $0.60 cheapest-untried-counterfactual probe) → terrain survey killed the v1 lever (commit `9956f62`) → pivot to v2 lever + probe driver (commit `8b89638`) → probe FLAT within noise (commit `b4426fb`, exp #264, actual $0.028 = 21× under budget). Matched-pairs McNemar p ≈ 0.68 at n=26/cell; writer IS responding to the lever but effect sits within sampling noise. Results doc: `docs/charters/tier-ordering-validation-v1-results.md`.
- **New architectural knowledge — writer-visible state surface is narrower than outline schema.** Terrain survey established that `outline.establishedFacts` reaches the writer ONLY via `beat.requiredPayoffs` links (SEEDS / PAYOFFS DUE blocks rendered at `src/agents/writer/beat-context.ts:255-281`); orphan facts are used only to build a `factById` lookup. `outline.characterStateChanges` is never rendered to the writer at all. Future planner-side state work must check this render surface before assuming a field is writer-visible.
- **3-tier sequential ordering is now a working hypothesis**, not a validated assumption. Revisit only if Tier 1 winners collapse under Tier 2 writer swaps.
- **Next direction: Tier 1B writer-visible threading.** Bulk `establishedFacts` injection into `beat-context.ts`, `worldExpansionBudget` wiring, `priorBeatEstablishedFacts` via `getFactsUpToChapter`. Requires production code change; measurement via decomposed audit at full-novel scale, not chapter-probe.

## Current Session (2026-04-20)

- **beat-entity-list V1 shipped (exp #254).** `halluc-ungrounded` now receives a `Beat-entities:` sub-line derived at check-time from `outline.establishedFacts` + prior-beat `description` via `src/phases/beat-entity-list.ts:deriveBeatEntities`. On-seed fire rate dropped 44.9% → 28.9% (−16 pts), precision 87.5% on 10-fire Sonnet adjudication, all 5 charter gates cleared. `BEAT_ENTITY_LIST_VARIANT=v1` is now the default. See hallucination bullet above (line 76) for full detail + commit SHAs.
- **Cross-genre smoke (exp #255) confirmed safe.** Non-Salvatore seeds show no regression with the V1 default.
- **`logLLMCall` double-encoding fix (commit `ff555bc`).** `llm_calls.request_json` was being stored as a double-encoded string; now stored as proper JSONB. Grounded-sources provenance is queryable via `#>` path operators.
- **halluc-leak-salvatore Rung 0 shipped, then retired with the writer-LoRA route.** Commit `cc57752` is historical evidence that regex-first was cheaper than SFT for corpus-leak detection. Exp #272 removed the runtime leak checker because no active writer route is trained on the Salvatore corpus.
- **V1a payoff-floor mini-pilot (exp #256) ran 2 of 4 arms → ITERATE.** Baseline vs aggressive-prompt-only on 3 seeds × 5 chapters. Mean paired Δ retry_ratio = −0.0309; prompt did NOT recover V1a lift, consistent with "V1a schema is the causal lever." But `extractor` + `mainv1a` arms missing (scoping error at launch); V1b/V1c still gated on the complete 4-arm pilot. Next-session action + 6 novel IDs + full table in `docs/pp2-floor-pilot-results.md`.
- **salvatore-v5-stripped ablation scoped and parked** (commit `15843a4`). Training data stripping script already ran successfully on the 777-pair corpus (zero residual corpus tokens in stripped prose). 4 design gates pending user decision before SFT submission. Sequencing: run conditioning-floor charter (`docs/charters/salvatore-distinctness-conditioning-floor.md`) first; v5-stripped go/no-go after its verdict. See `docs/ablation/salvatore-v5-stripped.md`.
- **Conditioning-floor scorer implementation in flight.** Codex CLI job running in background — implementing the 4 TODOs in `scripts/evals/run-salvatore-distinctness-v1.ts` + arm-config JSONs. Session closed before Codex reported; work is uncommitted on `main` and needs the session-end review (listed in `docs/next-session-plan.md`).
- **Component-isolation testing methodology proposed** (commit `7794735`). `docs/component-isolation-testing.md` — framework for when to test harness components offline (replay against existing `llm_calls`, plan-diff, beat-rewriter) vs e2e. Status: proposed. Motivated by observing that recent charters (including the V1a pilot above) could have been cheaper with replay harnesses.

## Current Session (2026-04-23)

- **Drift detector skeleton shipped (Phase 0 prereq #2).** `scripts/autonomous-loop/drift-detector.ts` + migration `sql/032_drift_checks.sql`. It remains useful for archived adapter baselines, but adapter drift is no longer the active runtime checker strategy after exp #272 moved active checks to DeepSeek V4 Flash + deterministic guards.
- **Migration 032 is next.** `sql/032_drift_checks.sql` adds the `drift_checks` table (run_id, adapter, frozen_run_id, precision/recall/F1 frozen+current+delta, trips_gate, gate_reason, brief_count, error_text, ran_at).

## Current Session (2026-04-28)

- **Drafting-layer deepenings landed (D1–D4a).** Per `docs/plans/2026-04-28-drafting-deepenings.md` (Codex GREEN round 4): D1 typed `BeatContext` slots + pure renderer + 20-fixture byte-parity gate (`b2669f9`); D2 `attemptRevision` policy module owning the reviser dispatch + sanity checks + `revisionUsed` write-before-call guard (`a16f72d`); D3 generic `runSettleLoop<T>` shell consolidating both plan-check and validation rewrite loops behind one shape (`2688f28`); D4a migrates the `DEBUG_FORCE_PLAN_CHECK` / `DEBUG_FORCE_REVISER` env-var seams from inline guards in `drafting.ts` to V2 transport-interceptor rules registered at orchestrator boot via `src/debug/v1-bridge.ts`. `DEBUG_FORCE_VALIDATION` stays at V1 until D4b lands the deterministic-check interception layer. Invariant #2 (Seam-recheck symmetry) stays live; the three plan-check/reviser call sites now carry `// @noninjectable` markers (transport handles it).

## Current Session (2026-04-29)

- **DeepSeek V3.2 → V4 Flash swap shipped (commit `eb2993d`).** Removed legacy `deepseek-chat` and `deepseek-reasoner` registry entries entirely (no aliases). Added `deepseek-v4-flash` ($0.14/$0.28, $0.0028 cache hit; thinking optional; maxOutput 64K) and `deepseek-v4-pro` ($1.74/$3.48 base, currently 75% off until 2026-05-31; thinking always-on; reserved as escalation, NOT routed in `roles.ts`). All DeepSeek-using slots in `src/models/roles.ts` now route to V4 Flash; thinking ON only on `planning-beats`, `chapter-plan-checker`, `chapter-plan-reviser`. `thinking: boolean` plumbed through `src/llm.ts` makeRequest into the request body as `thinking: { type: "enabled" }` for the deepseek provider. 22+ scripts string-replaced from `deepseek-chat` → `deepseek-v4-flash`.
- **CLAUDE.md rule 6 augmented (commit `09bbf7a`).** Explicit list of required-rsync stages added: `src/models/roles.ts`, `src/models/registry.ts`, `src/agents/**`, `sql/**`, `src/config/pipeline.ts`, `src/phases/**`, `src/llm.ts` / `src/transport.ts`, `src/lint/**`. Doc-only commits and local-only scripts (`scripts/phase-eval/**` parents, `scripts/variant/**`) do NOT require deploy.
- **`record-fixture.ts` autoMode + auto-resolver fix (commit `cd55f0f`).** `tests/phase-parity/record-fixture.ts` now calls `setAutoMode(true)` + `setResolverMode("auto")` before `runNovel`, fixing a hang where the recorder blocked on the world-bible approval prompt because autoMode defaulted to false. Parity fixture P0b is RUNNING on LXC at session close (`bun tests/phase-parity/record-fixture.ts fantasy-system-heretic` PID 823157, log `/tmp/parity-record-fantasy-system-heretic.log`); fixture artifacts not yet committed.
- **Phase-eval probe scaffold (Slice 0a + Slice 1, commits `a031980` + `c6ef9a5`).** Cheap-probe instrument from `docs/designs/phase-variant-comparison.md` charter (R5 — converged after 4 rounds of Codex `gpt-5.5 effort=high` adversarial review). Components:
  - `scripts/variant/clone-for-variant.ts` — `--target-phase=concept-done` flag added. Defines `COMMON_CLONE_TABLES`, `DRAFTING_ONLY_CLONE_TABLES`, `CONCEPT_DONE_ONLY_CLONE_TABLES`, `CONCEPT_DONE_MUST_BE_ABSENT`. Concept-done mode lands the cloned target at `phase=planning, current_chapter=1` and asserts post-concept tables are empty after clone.
  - `src/agents/planning-beats/index.ts` — `PLANNING_BEATS_PROMPT_OVERRIDE` env-var seam (read at module load, absolute path required). Used by per-variant child processes to inject a different beat-expansion prompt without rebuilding the agent registry.
  - `scripts/phase-eval/run-variant.ts` — child entry: takes `--novel-id` (cloned concept-done state) + `--output-dir`, runs planning ONLY via `runPlanningPhase`, dumps `chapter_outlines.outline_json` to disk.
  - `scripts/phase-eval/probe-planning-beats.ts` — parent driver: concept once → `clone-for-variant` per variant → spawn `run-variant.ts` per variant (each with `PLANNING_BEATS_PROMPT_OVERRIDE` pre-set) → aggregate outlines into `summary.json`. Each variant gets its own bun process for fresh module graph (top-level await on the prompt file caches forever in-process; child processes are mandatory).
  - `scripts/phase-eval/print-screen-verdict.ts` — pure deps-free verdict computer; reports G1-G4 directional metrics (median facts/chapter, mean knowledge/chapter, mean beats/chapter, mean state-changes/chapter) with test-minus-control deltas. Charter R5 framing — directional, not compliance.
  - `scripts/phase-eval/variants/planning-beats/{default,loud}.md` — default = verbatim production prompt; loud = same body with explicit numerical floors (beats `ceil/100` target vs `ceil/150` floor, ≥6 facts/chapter, ≥3 knowledge transfers, state-changes for every active character).
  - **Charter:** `docs/designs/phase-variant-comparison.md` (R5, committed `42ae810`). 5-chapter planner-only A/B with directional G1-G4 gates.
  - **Status:** Slice 1 implementation landed; Codex review pass queued; first end-to-end probe run pending parity-fixture P0b completion.
- **Character-arcs LTWN harness integration shipped.** First corpus-derived structural prior to land in the runtime pipeline. `src/agents/character-agent/schema.ts` adds 5 optional fields — `lie`, `truth`, `want`, `need`, `arc_resolution` (`z.enum(["fulfilled", "partial", "tragic_inversion", "static"])`) — to `characterProfileSchema`. Optional so legacy novels round-trip. `character-profile-system.md` documents the LTWN structure with examples + the corpus-derived distribution target (≥1 tragic_inversion, ≤50% fulfilled for a 5–8 character cast). `planning-plotter/context.ts` renders the LTWN block when populated; static or partially-populated characters render only the fields they have. Calibration evidence: Crystal Shard CELL PASS F1=1.00 on character identification + LTWN structure (2026-04-29, Phase A 2×2). Mapped via [`docs/structural-dims-to-harness-mapping.md`](structural-dims-to-harness-mapping.md). Tests pass (writer enriched-context unchanged), no typecheck regressions in changed files.

## Current Session (2026-04-30)

Corpus pattern mining session on the Salvatore Icewind Dale 3-book bundle. Branch: `phase-variant-screen`. Theme: closing the gap between the chat narration of subagent findings and the `docs/harness-tuning-roadmap.md` cross-pattern view, plus codifying the rules that prevent the gap from re-opening.

- **Corpus mining maturity step-up.** `docs/harness-tuning-roadmap.md` now carries roadmap rows for ~30 measured patterns under the directional-gate methodology (PASS / DIVERGE / NEG / WATCH per row), each with cross-references to the JSON artifact under `novels/salvatore-icewind-dale/structure-calibration/` and the commit hash that landed it. Catch-up wave landed P22–P41 in commit `4ede0f4`; punctuation (P42) and dialogue tags (P48) added in `e225589`. Per-pattern data commits across the session: `351ec9d`, `d7df7cf`, `47ba480`, `670a1f1`, `c0ff3c7`, `86d4998`, `7e5de0f`. Six measurement subagents are in flight at session-pickup time (P49 chapter-opener / P50 chapter-closer / P51 scene-break cadence / P52 POV distribution / P53 sensory-mode density / P54 time-skip markers); their landings will append additional roadmap rows + conclusions sections once the orchestrator does the commit sweep.
- **CLAUDE.md Rule 14 (capture lessons at moment of surprise)** committed in `d492d61`. Codifies same-commit `docs/lessons-learned.md` entry whenever a session produces a methodology surprise, calibration finding, or process correction. Trigger surface enumerated in CLAUDE.md (low-prevalence multi-axis verdict, calibration pass/fail, methodology hop, > 10-min tool gotcha, "we already had this lesson somewhere" moment).
- **CLAUDE.md Rule 15 (findings must land in tracked docs, not just chat)** committed in `11a8178`. Per-finding cadence — when 5+ subagents land in parallel, each landing produces a roadmap row in the same or immediate-follow-up commit, not an end-of-session batch. Distinct from Rule 14: Rule 14 captures *generalized rules*, Rule 15 captures *specific findings*. Both are structural, not aspirational — chat is the most ephemeral persistence layer in the system.
- **Schema-prompt sync fix landed (commit `0c8457d`).** `src/agents/planning-beats/beat-expansion-system.md` now matches the production `sceneBeatSchema` enums after an LXC probe surfaced the planner emitting invalid `miceActive=['E','C']` against the new `MICE_ACTIVE_THREADS=["I"]` / `MICE_OPENS_THREADS=["M","I"]` constraints. Class-of-bug pattern: when a schema field constraint is tightened in a `feat`-class commit, the corresponding agent prompt must be synced in the same commit (or a same-day follow-up) — otherwise the next pipeline run validates against the new schema with the old prompt and emits structurally invalid output.
- **Lessons-learned wave** appended this session (already committed):
  - **Cross-model F1 ≠ anchor stability** (`97190b2`) — they measure different things; both gates must pass before a dim ships.
  - **Granularity rotation** (`cd4347a`) — fields validated at scene-level can degrade at beat-level (or vice versa); confirm at the production-emit granularity.
  - **Binary-collapse-before-relabel** (`b061779`, `c48a232`) — cheapest counterfactual on a FAILED gold-stability check is data-only re-aggregation; relabel only if collapse fails.
  - **Aggregate-only patterns can survive while per-book patterns fail** (`ad33e98`) — for cross-book/cross-corpus claims, gate per-book, not on aggregate.
  - **Parallel subagents on append-only docs need atomic write-then-rename** (`474585b`, `7e5de0f`, `11cafad`, `37f297f`) — the naive read→edit→add→commit pattern doesn't survive concurrency on shared narrative docs; the operational fix is per-pattern conclusions stubs gathered later.
  - **Findings narrated in chat die without crossing into tracked documentation** (`c0ff3c7`) — Rule 15's structural justification.
  - **Small-sample anchor Jaccard is a screening tool, not a ship gate** (`d492d61`) — n=50 gives false confidence on rare-event subfields; full-population validation is the load-bearing check.
  - **Hand-spot LLM probe verdicts on low-prevalence multi-axis dimensions** (`d492d61`) — Pattern 26 false-negative finding (DeepSeek 2.5% vs Sonnet 10.1% on compositional title axis) is the cite.
- **Patterns 72–75 sweep landed (commit `788b7a2`) — interaction patterns + magic lexicon.** Cumulative pattern count is now ~75 patterns probed across the IWD trilogy under the directional-gate methodology. P72-75 covered unique territory the earlier waves had not exercised: P72 per-PAIR dialogue voice (PASS_PARTIAL, 3/7 pairs PASS — Bruenor is the voice-pulling anchor in all 3, harness lever is per-pair `interactionMode` planner prior + per-pair fewshot block layered above P65 per-character fewshots + pair-context lints); P73 gesture-vs-tag ratio (DIVERGE, top-kind shuffles 3/3 books, surviving axis is action consistently top-2 + BARE-rate clusters for books 2-3); P74 character-pair scene affinity (DIVERGE, top-3 intersection 0/3, stuck-together-in-2-books at lift≥1.5 for Drizzt+Wulfgar and Bruenor+Catti-brie, universal book1→book2 affinity rise 10/10 as series-progression prior); P75 magic invocation (KILL, climax-spike reproduces only in CS, 8-token shared core, magic-antagonist 2× elevation real WITHIN book but per-book localized).
- **Mining surface approaching saturation; pivot to synthesis.** Concrete composite-prior bundles emerging from the cumulative wave: chapter-CLOSE narrator-seam (P50+P54+P55), action-beat assembly (P64+P53+P56+P66), voice-shaping bundle (P29+P39+P57+P65+P67), and now per-pair `interactionMode` (P72 layered over P65). The next priority is composite-prior synthesis → variant prompts → phase-eval probe through the existing `phase-variant-screen` instrument, NOT additional single-pattern measurements. Single-pattern coverage is high enough that the marginal pattern row is unlikely to produce a new harness lever; the marginal probe-variant arm is the higher-leverage spend.
- **Methodology surprise — `atomic_append_section` lost 3 of 4 sections under N=4 parallel subagents.** Recovery was manual (compact reconstruction from each subagent's verdict report, all 4 sections present in `crystal_shard-conclusions.md` post-recovery, all 4 roadmap rows + JSONs landed correctly through the row/JSON helpers). The flock-protected append helper is the SECOND parallel-write failure mode the project has hit — first was raw `>>` appends with merge conflicts (Patterns 28/32/33/37), now `flock + O_APPEND` with silent loss under high parallelism. Lesson committed in this same sweep — see `docs/lessons-learned.md` "atomic_append_section is not safe under N≥3 concurrent subagent processes." Practical mitigation until the conclusions-stubs flow lands: post-run `grep -c "^## Pattern N:" target.md` against the number of parallel subagents, OR cap parallel pattern subagents at 2 when they share an append target.
- **Three-layer architecture status updated by exp #272.** Planning layer: fantasy structural priors remain available to planner prompts. Writing layer: all genres route to base DeepSeek V4 Flash, not Salvatore v4 LoRA. Checker layer: active runtime checkers are deterministic guards plus bounded DeepSeek V4 Flash calls; route-specific leak and tonal-pass code is retired.
- **Planner status — phase-eval probe instrument matured.** `phase-variant-screen` branch carries the SCREEN-PASS verdict on the `loud` planning-beats variant against `fantasy-system-heretic` (Slice 1 end-to-end, retrospective at `docs/sessions/2026-04-29-phase-eval-probe.md`, Codex review integrated in `28c2e57`). LXC probe of the corpus-v1 plotter variant came in mixed (Pattern 1 PASS — targetWords + beat-floor lift; Pattern 3a opener stable; Pattern 3b closer REGRESSED — 0/3 vs 2/3 action; Pattern 16 facts density dropped on n=3, unstable). Two follow-ups queued: revise the plotter's closer-kind guidance to fix the P3b regression before re-probing; re-measure P16 facts density on a 5-chapter sample.

## Current Known Gaps

These are known cleanup items, not contradictions in the operating model:

- Root TypeScript still has a bounded set of implicit-`any` row-mapping errors.
- Historical docs still contain valid context mixed with stale current-tense statements.
- The repo still needs discipline around classifying docs as current-truth vs historical notes.

Those are documentation/process debt items, not a reason to fork the methodology again.
