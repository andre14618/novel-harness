---
status: shipped (R6 v1 implementation landed 2026-04-29 commit `31f26b4`; R7 confirms second-probe-shape promotion gate fired and works as designed without schema changes)
kind: subsystem-design
name: eval-testing-module-v1
owner: andre
date: 2026-05-01 (R7 update)
revision: 7
parent-context: docs/todo.md "Three-bucket forward plan", docs/eval-infrastructure.md, docs/charters/corpus-structural-decomposition-v1.md (sibling — Bucket 1)
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent aff15da9fb18060ec, 2026-04-29) — 5 blockers, 6 warnings, named cheapest counterfactual: "planning-scenes-only migration v1." Recommended action: RUN CHEAPER COUNTERFACTUAL.
  R2: RED (codex:codex-rescue gpt-5.5 effort=high, agent a5219c7acd0f457fb, 2026-04-29) — pivot landed cleanly (R1 issues 2/3/4 closed); 2 partial-closures + 3 warnings. Recommended action: ITERATE-R3.
  R3: RED (codex:codex-rescue gpt-5.5 effort=high, agent a8d5abb7dd78315fd, 2026-04-29) — R3 materially closed both R2 blockers. 1 remaining blocker: variant-keyed gate input. Recommended action: ITERATE-R4.
  R4: RED (codex:codex-rescue gpt-5.5 effort=high, agent af3ba587dd7f32694, 2026-04-29) — R4 fully closed the R3 core shape bug (evaluator is variant-keyed; G4 binds to loud). 1 remaining blocker: `phase-variant-screen-v1` evaluator throws on broken paths instead of returning `SCREEN-FAIL (broken)` cleanly — fix is 3-4 lines (total-function guard before metric dereference). 3 warnings (config_hash misses code identity; mirror/bootstrap/numeric wording sweep partial; ensureBootstrapped not single-flight under concurrent races) + 2 suggestions (parity-test 4-decimal string compare; tl;dr rename typo). Recommended action: ITERATE-R5.
  R5: RED (codex:codex-rescue gpt-5.5 effort=high, agent a1be2e9cb25a0eaab, 2026-04-29) — R5 closed R4's total-function blocker, BUT after 5 polish rounds Codex flagged two NEW blockers that revealed the design is over-instrumented for the current need. (1) Axis 3 cheapest-first: `decisions.md` records the probe as "the canonical first instrument before committing to harness changes," and there's no stated promotion gate for graduating from probe to module — module is a higher-cost lever per `experiment-design-rules.md §11.1`. (2) Axis 7 parity invariant too weak: §6 requires only one-seed verdict + 3 metric-string matches, but §4.7 requires request-construction parity when rewriting code around a production LLM path. Plus 3 warnings (verdict storage singular vs per-(run,seed) plural; missing 4th G-metric `state_changes_median`; broken-path metric population contract implicit). Named cheapest counterfactual: "Keep `scripts/phase-eval/probe-planning-scenes.ts` as the runner and store/report its JSON outputs directly via a tiny append-only result index — ~$0 engineering, expected ~100% of the immediate directional signal." Recommended action: RUN CHEAPER COUNTERFACTUAL.
related:
  - docs/eval-infrastructure.md (existing eval_briefs/eval_results layer this design composes with — v2 territory)
  - docs/designs/phase-variant-comparison.md (the one-off precedent the result index reads from)
  - docs/designs/autonomous-context-loop.md (sibling subsystem; v2 schema readiness consideration)
  - scripts/phase-eval/ (the canonical first instrument; v1 keeps it as-is and only adds a result index)
  - sql/024_eval_briefs_and_results.sql (existing tables; v1 does NOT compose with these)
  - docs/decisions.md (probe-as-canonical-first-instrument decision; promotion-gate criteria)
  - docs/experiment-design-rules.md §4.7 (request-construction parity rule that v1 sidesteps via "no production code path rewritten" exemption)
---

# Durable Eval / Testing Module — Design Sketch (Revision 7)

## R7 update — 2026-05-01: promotion gate trigger 1 fired, helper supports it as-is

The R6 §0 promotion-gate trigger 1 ("a second probe shape needs the same persistence + query surface") fired naturally during the §2 checker calibration cycle (2026-05-01). The session produced 3 new probe shapes:

1. **halluc-ungrounded-prompt-ab** (`scripts/hallucination/ab-halluc-prompt.ts`) — re-invokes halluc-ungrounded with a candidate system prompt against a labeled current-surface panel, produces a TP/FP/FN/TN calibration matrix + recall/precision/F1.
2. **halluc-synthetic-fire-rate** (`scripts/hallucination/run-synthetic-checkers.ts`) — invokes halluc-ungrounded + adherence-events on the 10 synthetic candidate-score fixtures, compares to expected_pass.
3. **adherence-per-event-prototype** (`scripts/hallucination/probe-obligation-aware-adherence.ts`) — runs an experimental per-event variant of adherence-events on the labeled panel, produces per-event recall/precision plus binary calibration.

**The R6 design's prediction held up.** All three probe shapes use the existing `persistPhaseEvalRun` helper without schema or helper changes:

- `probe_name` discriminates the shape (planner-probe vs checker-A/B vs synthetic-fire-rate vs per-event-prototype).
- `summary_json` JSONB carries the shape-specific payload (planner has `g_metrics`; checker-A/B has `calibration_matrix` + `recall_pct` + `precision_pct` + `f1` + `per_row_results`).
- `verdict` is a free-text string covering both shapes (`SCREEN-PASS`/`SCREEN-FAIL` for planner; `PROMOTE-CANDIDATE`/`REGRESS`/`NO-DATA` for checker-A/B).
- `seeds_used` and `variant_labels` are top-level filters that work for both.

**Acceptance evidence (commit `e41c8ce`):** ab-halluc-prompt with `--persist --exp-id 303 --variant-label v3-live` produces phase_eval_runs.id=14 alongside the existing planner-probe rows, queryable via `SELECT verdict, summary_json -> 'recall_pct' FROM phase_eval_runs WHERE probe_name = 'halluc-ungrounded-prompt-ab'`.

### What R7 explicitly does NOT change

R6 said: "v2.1 = small shared write helper; v2.2 = service-layer module IF AND ONLY IF a third probe materializes." A literal reading would graduate to v2.2 now (3 probe shapes exist). R7 declines:

- The shared helper (`scripts/phase-eval/persist-run.ts`) ALREADY serves all 4 probes (1 planner + 3 checker). The "small shared write helper" of v2.1 is the existing `persistPhaseEvalRun` — it was generic enough from R6 because the design constrained the shape to (probeName, gitCommit, expId, seedsUsed, variantLabels, summaryJson, verdict, notes), which is checker-shape-tolerant by accident-of-good-narrowing.
- The "service-layer module IF a third probe materializes" trigger was a contingency for the case where each probe needed its own custom persistence. In practice, the helper's narrow signature is sufficient — 3 of 4 probes use it without touching it. There is no service-layer module to write because there is no orchestration to centralize.
- The R6 retrospective at git commit `3a1effd` (pre-pivot R5 design) remains the starting point if a future trigger requires it. R7 does not pre-design that.

### Remaining R7 follow-ups

- [ ] Wire `--persist` into `run-synthetic-checkers.ts` and `probe-obligation-aware-adherence.ts` (each ~15 LOC, mirroring the ab-halluc-prompt shape).
- [ ] Update `list-runs.ts` to display `summary_json -> 'recall_pct'` and `'verdict'` columns for checker-A/B probes (~5 LOC delta — currently shows generic columns that work but don't surface checker-specific signal).
- [ ] (Defer) UI surface for cross-run calibration deltas. Belongs to the original §0 trigger 4 (LLM-judge / human-rating consumer); not needed yet.

### Promotion-gate triggers status (R7)

| Trigger | R6 status | R7 status |
|---|---|---|
| 1. Second probe shape needs same persistence | Pending | **FIRED** — 3 new shapes; helper handles all 3 with zero schema change. R7 does NOT trigger v2.2 because the helper is sufficient. |
| 2. Autonomous-context-loop needs immutable per-iteration snapshots | Pending | Pending — context engineering direction (memory `project_context_engineering_priority`) deprioritized the autonomous loop; trigger may not fire. |
| 3. Cross-run JSONB query painful at production volume | Pending | Pending — at 14 rows total, ergonomics fine; `summary_json -> 'recall_pct'` syntax handles checker-A/B drilldowns cleanly. |
| 4. LLM-judge / human-rating consumer | Pending | Pending — no concrete consumer yet. |

Net: R7 confirms the R6 design works for its intended scope and the cheapest counterfactual (no v2 module) remains correct.

## 0. Tl;dr (R6 — pivot to probe + tiny result index per Codex R5 cheapest counterfactual)

**Five rounds of Codex review (R1–R5) progressively shrank the module from 6 slices and 4 tables to 5 slices and 4 tables, but the R5 verdict revealed a more fundamental problem: after polishing the harness for 5 rounds, Codex re-attacked the instrument-question fit and flagged that the heavier instrument was never actually justified vs the existing probe. R6 takes Codex's named cheapest counterfactual: keep `scripts/phase-eval/probe-planning-scenes.ts` as the runner and add a tiny append-only result index so probe outputs are queryable without re-running the script.**

The R5 verdict's two blockers were:

1. **Axis 3 — cheapest-first not justified.** `decisions.md` records the probe as "the canonical first instrument for ANY planner-prompt change going forward." After 5 rounds polishing the heavier instrument, no entry in this design names a promotion gate for when probe results graduate to harness work (e.g., N planned reruns, cross-run analysis the probe+JSON cannot answer, a concrete consumer that needs DB queryability now).
2. **Axis 7 — parity invariant too weak.** v1 (R5) rewrites the runner/orchestrator around `runPlanningPhase` but only requires one-seed verdict + three metric-string matches as parity. Per `experiment-design-rules.md §4.7`, code rewrites around production LLM paths require request-construction parity (byte-diff of outgoing request bytes) or a named skip-category exemption. R5 named neither.

R6 sidesteps both: don't rewrite the runner. Keep the probe. Make probe output queryable via a single new table (`phase_eval_runs`) plus a thin write-helper invoked by the existing probe at the END of its run. No service-layer module, no gate evaluator code path, no bootstrap edge, no canonical-config hashing, no parity-test CI guard. The probe stays the source of truth; the table is a queryable mirror of its `summary.json` + verdict line.

The original goal — "make the existing probe durable, rerunnable, and queryable" — is satisfied:

- **Durable**: probe + `phase_eval_runs` row.
- **Rerunnable**: probe is unchanged; rerunning produces a new row.
- **Queryable**: `SELECT verdict, summary_json -> 'g_metrics' -> 'facts_median' FROM phase_eval_runs WHERE probe_name='phase-variant-comparison' AND git_commit='...'` answers "what was loud variant's facts_median on the 2026-04-29 run?" in one query.

What R6 does NOT do (deliberate non-scope, deferred to v2):

- No `test_suites` / `test_runs` / `test_run_cells` / `test_metric_results` tables. v2 introduces these IF AND ONLY IF a concrete second consumer materializes (a second probe shape, an autonomous-loop integration, an LLM-judge composition). Until then, one table is enough.
- No service layer at `src/harness/eval-tests.ts`. v2 introduces it WHEN a second probe needs the same shape.
- No gate evaluator registry. The probe's existing `print-screen-verdict.ts` keeps writing the verdict line.
- No suite definitions in code, no canonical-config hashing, no bootstrap edge. None of those infrastructure pieces is justified by one probe.
- No request-construction parity test. R6 doesn't rewrite production code paths, so `experiment-design-rules.md §4.7` doesn't apply (the "Pure evaluation task" exemption — see §4.7 explicit not-applicable categories).
- No CI-required parity test. There's nothing to compare; the probe IS the runner.

R6 acceptance: `bun scripts/phase-eval/probe-planning-scenes.ts ... --persist` produces the SAME `summary.json` + verdict the existing probe always produced AND ALSO inserts one row into `phase_eval_runs` with `(probe_name, git_commit, experiment_id, seeds_used, summary_json, verdict, ran_at)`. The probe's stdout/exit-code is unchanged. Without `--persist`, behavior is identical to today.

**Promotion gate (R5 B1 fix).** Defer the heavier module unless one of these triggers fires:

1. A second probe shape (not planning-scenes) needs the same persistence + query surface. (One probe = no abstraction needed; two probes = candidate for a small shared helper, NOT necessarily the full module.)
2. The autonomous-context-loop (`docs/designs/autonomous-context-loop.md`) reaches a stage where it needs immutable per-iteration parameter snapshots that the probe's flat row doesn't capture cleanly.
3. A cross-run analysis question lands that requires joining on metric values per (seed, variant) — i.e., something `summary_json -> 'g_metrics'` JSONB queries cannot answer ergonomically in production-traffic volume.
4. An LLM-judge or human-rating consumer needs to attach to per-cell artifacts (Codex R1 issue 3 territory).

If none of these fire over the next 2–3 probe runs, the module stays deferred — that IS the canonical signal that the cheap instrument is sufficient.

**v1 scope: ~0.5 working day** — one migration file (1 table), one ~40-line write helper invoked by the probe behind a `--persist` flag, one ~20-line CLI reader (`bun scripts/phase-eval/list-runs.ts`). No new src/ module. No service layer. No tests beyond a smoke test that the row lands.

## Pivot history

- **R1 (RED):** Codex (`aff15da9fb18060ec`, gpt-5.5 effort=high) flagged 5 blockers + 6 warnings. Named cheapest counterfactual: "planning-scenes-only migration; cut M3 broad codegen, cut M4/M5 UI, cut human ratings, cut `eval_results` composition." Recommended action: RUN CHEAPER COUNTERFACTUAL.
- **R2 (RED, ITERATE-R3):** Codex (`a5219c7acd0f457fb`, gpt-5.5 effort=high) confirmed R1 issues 2/3/4 closed. Two partial-closures + 3 warnings. Recommended action: ITERATE-R3.
- **R3 (RED, ITERATE-R4):** Codex (`a8d5abb7dd78315fd`, gpt-5.5 effort=high) confirmed both R2 blockers genuinely closed AND most R3 attack surfaces SAFE (1, 2, 3, 5, 6, 9). 1 remaining blocker: gate evaluator signature is singular `cell` but verdict over `{default, loud}` needs variant-keyed input — G4 must bind explicitly to the loud cell. 4 warnings + 2 suggestions. Named cheapest counterfactual: "variant-keyed gate-input patch (~45-60 min)." Recommended action: ITERATE-R4.
- **R4 (RED, ITERATE-R5):** Codex (`af3ba587dd7f32694`, gpt-5.5 effort=high) confirmed the R3 variant-keyed blocker fully closed. 1 remaining blocker: `phase-variant-screen-v1` reads `cellsByVariant.loud.seed_key` and `metricsByVariant.*.loud/default` BEFORE the broken-path guard. 3 warnings + 2 suggestions. Named cheapest counterfactual: "make `phase-variant-screen-v1` a total function (3-4 line change)." Recommended action: ITERATE-R5.
- **R5 (RED, RUN CHEAPER COUNTERFACTUAL):** Codex (`a1be2e9cb25a0eaab`, gpt-5.5 effort=high) confirmed R4's total-function blocker closed but flagged TWO NEW blockers that revealed the design was over-instrumented for the current need. (1) Axis 3 cheapest-first: `decisions.md` records the probe as "the canonical first instrument before committing to harness changes," and after 5 polish rounds no entry justifies the module vs probe-as-instrument. (2) Axis 7 parity invariant too weak: §6 acceptance is one-seed verdict + 3 metric-string matches, but §4.7 requires request-construction parity for code rewrites around production LLM paths. Plus 3 warnings (verdict-storage singular vs per-(run,seed); 4th G-metric `state_changes_median` missing from migration; broken-path metric population contract implicit). Named cheapest counterfactual: "Keep `scripts/phase-eval/probe-planning-scenes.ts` as the runner and store/report its JSON outputs directly via a tiny append-only result index — ~$0 engineering, ~100% of the immediate directional signal." Recommended action: RUN CHEAPER COUNTERFACTUAL.
- **R6 (this revision):** Took the R5 cheapest counterfactual. Module deferred. Probe stays the source of truth. One new table (`phase_eval_runs`) holds an append-only mirror of probe `summary.json` + verdict per run. ~0.5 day implementation. Promotion gate explicitly named (§0): defer the heavier module until a second probe shape, an autonomous-loop integration, a cross-run analysis JSONB cannot answer, or an LLM-judge consumer materializes. §4.7 doesn't apply (probe is unchanged; "Pure evaluation task" exemption). All four G-metrics (facts_median, know_median, state_changes_median, total_scenes) carry through verbatim from probe summary.json. Verdict-storage shape collapsed from per-cell to per-run because the probe already produces a single per-run verdict line.

## 1. Goal (R6)

Make the existing `scripts/phase-eval/probe-planning-scenes.ts` durable, rerunnable, and queryable — without rewriting any production code path. Store its `summary.json` + verdict output in an append-only DB table so future runs are queryable in SQL.

**v1 acceptance test:** running the existing probe with a new `--persist` flag produces (a) IDENTICAL stdout/exit-code/file output as today AND (b) one new `phase_eval_runs` row containing `(probe_name, git_commit, experiment_id, seeds_used, summary_json, verdict, ran_at)`. Without `--persist`, behavior is byte-identical to today.

**Why:** the existing probe IS the canonical first instrument per `docs/decisions.md`. Running it again later already works — it's a 200-line bun script, and re-running just produces a fresh `summary.json`. The ONLY missing piece is "queryability" — the question "what was loud variant's `facts_median` on the 2026-04-29 run?" today requires re-reading commit logs and re-running scripts. One table answers it in SQL. That is the core value, narrowly isolated.

**Why NOT a heavier module (per Codex R5 verdict):** five rounds of review polished a 4-table service-layer module without anyone confirming the probe couldn't already answer the standing question. Per `experiment-design-rules.md §11.1`, building a higher-cost lever without a stated promotion gate is anti-pattern. R6's promotion gate (see §0) explicitly defers the module until a concrete second consumer materializes. Until then, one table and one write helper are enough.

**v2 (roadmapped, NOT in v1) — ONLY when a promotion-gate trigger fires:**

- Second probe shape needs the same persistence + query surface → introduce a small shared write helper (NOT necessarily the full module).
- Autonomous-context-loop needs immutable per-iteration parameter snapshots beyond what the flat row captures → design `test_runs.resolved_snapshot` shape with the loop's actual usage in front of it.
- Cross-run JSONB query becomes ergonomically painful at production volume → normalize metric values into a per-(run, metric) table.
- Human-rating widget or LLM-judge consumer needs to attach to per-cell artifacts → design the artifact-set abstraction with that consumer in front of it (Codex R1 issue 3 territory).

v2 work happens via separate design docs. R6 explicitly does NOT pre-design v2 — every Codex review round (R1–R5) confirmed pre-designed generalization is the failure mode.

## 2. Scope (R6)

### In scope (v1)

- **One new table**: `phase_eval_runs` — append-only mirror of probe `summary.json` + verdict per run. See §3.
- **One ~40-line write helper**, invoked at the end of `scripts/phase-eval/probe-planning-scenes.ts` behind a `--persist` flag. Reads the in-memory `summary` object the probe already builds and the verdict line from `print-screen-verdict.ts`, INSERTs one row.
- **One ~20-line CLI reader**: `bun scripts/phase-eval/list-runs.ts [--probe=<name>] [--limit=<N>]` — `SELECT` from `phase_eval_runs` ordered by `ran_at DESC`, prints a compact tabular summary.
- **Probe is otherwise UNCHANGED.** No new agent, no service layer, no gate evaluator code path, no new entry point in `src/`.

### Out of scope (v1, defer to v2 — gated by §0 promotion criteria)

- `test_suites` / `test_runs` / `test_run_cells` / `test_metric_results` tables. Not justified by one probe.
- Service layer at `src/harness/eval-tests.ts`. Not justified by one probe.
- Code-registered suite registry / canonical-config hashing / write-through mirror / bootstrap edge / single-flight `ensureBootstrapped()`. All R3–R5 polish addressed problems that don't exist in this scope.
- Variant-keyed gate evaluator + total-function broken-path semantics. The probe's existing `print-screen-verdict.ts` already produces the verdict line; v1 just persists it as a string.
- Code-registered metric impls. The probe already computes metrics into `summary.json`; v1 just persists the JSONB.
- Request-construction parity test (`experiment-design-rules.md §4.7`). v1 doesn't rewrite any production code path — the probe IS the runner. The "Pure evaluation task" exemption applies (the persistence helper reads probe outputs and writes a row; it constructs no LLM requests).
- CI parity test (`tests/eval-test-parity.test.ts`). There's nothing to compare; the probe IS the source of truth. The smoke test in §6 checks "row landed with expected fields"; that's sufficient.
- Cross-novel diff UI / leaderboard UI / human-rating widget / LLM-judge integration / `eval_briefs`–`eval_results` composition / autonomous-context-loop integration. All v2 (each gated by §0 criteria).
- "Any harness experiment" framing — Codex R1 warning 5 still applies.

## 3. Data model (R6)

```sql
-- New: sql/033_phase_eval_runs.sql

-- Append-only mirror of scripts/phase-eval/probe-planning-scenes.ts output.
-- One row per probe invocation. Probe `summary.json` is stored verbatim in
-- summary_json; the verdict line from `print-screen-verdict.ts` is stored
-- in `verdict`. NO normalization of metrics, NO per-cell rows, NO suite
-- registry — the probe IS the source of truth, this table is just a
-- queryable mirror.
CREATE TABLE IF NOT EXISTS phase_eval_runs (
  id                  SERIAL PRIMARY KEY,
  -- The probe's logical name. Today: 'phase-variant-comparison'. If a
  -- second probe shape ships with a different verdict contract, it picks
  -- a different probe_name (e.g. 'chapter-plan-screen').
  probe_name          TEXT NOT NULL,
  -- Captured at probe entry. Used to disambiguate two runs of the same
  -- probe across different code-paths in the harness (e.g. before vs
  -- after a writer change). Also satisfies §4.7 code-identity provenance.
  git_commit          TEXT NOT NULL,
  -- Optional FK to the tuning_experiments row this run is part of. NULL
  -- when probe runs ad-hoc without an experiment id.
  experiment_id       INT REFERENCES tuning_experiments(id),
  -- The seeds used in this probe run. For phase-variant-comparison this
  -- is a single-element array today (`["fantasy-system-heretic"]`); the
  -- probe could grow to multi-seed without schema change.
  seeds_used          TEXT[] NOT NULL,
  -- Variant labels used. Today: ["default", "loud"]. Stored as a small
  -- JSONB rather than a flat array because each variant carries its
  -- prompt path, which the probe already records in summary.json.
  -- Redundant with summary_json -> 'variants' but kept as a dedicated
  -- column so cheap "which variants did this run cover" queries don't
  -- need JSONB extraction.
  variant_labels      TEXT[] NOT NULL,
  -- The probe's summary.json verbatim. Carries everything the probe
  -- already records: per-variant outlines, g_metrics
  -- (facts_median, know_median, state_changes_median, total_scenes),
  -- per-(seed, variant) outline counts, etc. v1 readers tolerate
  -- additive fields (Codex R2 suggestion 4 still applies even at this
  -- scope — when the probe gains a new metric, old readers should
  -- silently skip it).
  summary_json        JSONB NOT NULL,
  -- The verdict line produced by print-screen-verdict.ts. Today this is
  -- one of: 'SCREEN-PASS' | 'SCREEN-FAIL (broken)' | 'SCREEN-FAIL (non-compliant)'.
  -- Stored as a free-text TEXT column (not an enum) because the probe's
  -- verdict contract may evolve and a free-text column is forward-compat.
  verdict             TEXT NOT NULL,
  ran_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Free-text notes the operator can pass via --note='...'. NULL if not
  -- provided. Useful for ad-hoc context ("first run after V4 Flash swap"
  -- etc.).
  notes               TEXT
);
CREATE INDEX idx_phase_eval_runs_probe ON phase_eval_runs(probe_name);
CREATE INDEX idx_phase_eval_runs_exp ON phase_eval_runs(experiment_id);
CREATE INDEX idx_phase_eval_runs_ran ON phase_eval_runs(ran_at DESC);
```

### Why this shape

- **Probe is the source of truth (R5 cheapest counterfactual).** The probe already builds an in-memory `summary` object and writes it to disk as `summary.json`. The persistence helper reads that same object from memory at the END of the probe's run and INSERTs one row. There is NO second computation, NO normalization, NO re-parsing of probe output — the row is byte-for-byte the probe's own output.

- **Why `summary_json` is JSONB, not normalized columns.** Three reasons. (1) The probe is the contract; if it adds a 5th G-metric tomorrow, the row reads the new metric for free without a schema migration. (2) Cross-run JSONB queries are ergonomic at this volume — single-digit rows per week. (3) When/if cross-run analysis becomes painful, that IS the §0 promotion-gate trigger to normalize into a per-(run, metric) table.

- **Why `verdict` is free-text, not enum.** The probe's verdict contract may evolve. A free-text column lets the probe add a verdict variant ("SCREEN-MARGINAL" etc.) without a migration. Today the contract is `{SCREEN-PASS | SCREEN-FAIL (broken) | SCREEN-FAIL (non-compliant)}`; tomorrow it may differ.

- **Why `git_commit` (Codex R5 W1 fix).** Code-identity provenance. Two runs of the same probe at different commits may produce different metric values; the row pins both to the row. This satisfies `experiment-design-rules.md §4.7`'s code-identity hook even though §4.7 doesn't strictly apply (probe is unchanged; "Pure evaluation task" exemption — see §6).

- **Why `seeds_used` and `variant_labels` are dedicated columns despite being also in `summary_json`.** Cheap top-level filter without JSONB extraction. `SELECT * FROM phase_eval_runs WHERE 'fantasy-system-heretic' = ANY(seeds_used)` beats a JSONB navigation by a non-trivial multiplier and is more readable.

- **No suite registry, no canonical-config hash, no bootstrap edge.** The probe's prompt-override paths are passed at the CLI; if the operator changes them, that's a different invocation that produces a different `summary_json`. There is no second runtime that needs to know "what is the canonical config for this probe at commit X" — the answer is "read the probe's source at commit X." Code IS the source of truth without a registry.

- **No `test_run_cells`, no per-(seed, variant) normalized rows.** The probe today uses a single seed and produces ONE verdict line. If that grows to N seeds × M variants with per-cell verdicts, the §0 promotion-gate trigger fires (specifically: "test_runs.verdict singular vs per-(run, seed) plurality" — Codex R5 W1). Until then, JSONB navigation handles cross-cell drilldown for free.

### Why NOT pretend to compose with `eval_briefs` / `eval_results`

`eval_briefs` is per-beat single-shot generation. v1 is full-pipeline variant comparison persistence. Different problem. Codex R1 issue 3: composition between them needs an artifact-set abstraction; v1 doesn't pretend to compose. The §0 promotion-gate trigger for that consumer (LLM-judge or human-rating attaching to per-cell artifacts) explicitly defers it.

### Why §4.7 doesn't apply (Codex R5 B2 fix)

`experiment-design-rules.md §4.7` requires a request-construction parity harness when an experiment "modifies code that produces the request bytes a live production LLM call also emits." R6 modifies NO production code. The probe stays as-is; the persistence helper reads the probe's existing in-memory output and writes a row. No agent prompt, no `callAgent` wrapper, no transport layer is touched.

The §4.7 explicit-not-applicable category that applies here: **"Pure evaluation task — experiment only reads existing data / runs offline scoring; no new production-shape request is constructed."** R6 lands strictly inside that exemption.

If a future v2 reintroduces a service-layer module that REWRITES `runSuite()` orchestration around `runPlanningPhase` (the R5 design's actual production-code rewrite), THAT future v2 design must add a §4.7 request-construction parity harness. R6 does not, because R6 doesn't.

## 4. Probe runner (R6 — UNCHANGED)

The probe at `scripts/phase-eval/probe-planning-scenes.ts` is unchanged in v1. It still:

- Spawns concept once → clones per variant → spawns child process per variant with the env var pre-set → aggregates per-variant `outlines.json` into `summary.json` (per `docs/decisions.md` 2026-04-XX entry).
- Uses the existing `src/agents/planning-scenes/index.ts:6-8` env-var seam UNCHANGED.
- Produces the same stdout, the same `summary.json` file, the same exit code as today.

The ONLY change to the probe is a single new flag — `--persist` — which (when set) calls a small write helper at the END of the probe's run, AFTER `summary.json` has been written and the verdict line has been printed. See §5.

### Process-isolation rationale (carried over from prior revisions)

Unchanged: module-level prompt cache + global `currentRunId` + global transport mean each variant runs in its own child process. The phase-variant-comparison charter §"Why child processes" already established this; v1 doesn't touch any of it.

## 5. Persistence helper (R6 — minimal, in-tree)

The persistence helper lives in `scripts/phase-eval/persist-run.ts` (NOT under `src/harness/` — there is no service-layer module in v1; see §0). It exports one function:

```ts
import { sql } from "../../src/db"

type PersistRunInput = {
  probeName: string
  gitCommit: string
  experimentId?: number | null
  seedsUsed: string[]
  variantLabels: string[]
  summaryJson: unknown                            // the probe's in-memory summary object
  verdict: string                                 // the verdict line print-screen-verdict.ts produced
  notes?: string | null
}

export async function persistPhaseEvalRun(input: PersistRunInput): Promise<number> {
  const [{ id }] = await sql`
    INSERT INTO phase_eval_runs (
      probe_name, git_commit, experiment_id,
      seeds_used, variant_labels,
      summary_json, verdict, notes
    ) VALUES (
      ${input.probeName}, ${input.gitCommit}, ${input.experimentId ?? null},
      ${input.seedsUsed}, ${input.variantLabels},
      ${JSON.stringify(input.summaryJson)}::jsonb,
      ${input.verdict},
      ${input.notes ?? null}
    )
    RETURNING id
  `
  return id
}
```

The probe entry point (`scripts/phase-eval/probe-planning-scenes.ts`) gains a flag:

```ts
// At the END of probe execution, after summary.json + verdict are produced:
if (args.persist) {
  const { persistPhaseEvalRun } = await import("./persist-run")
  const runId = await persistPhaseEvalRun({
    probeName: "phase-variant-comparison",
    gitCommit: await currentGitCommit(),         // existing helper or `git rev-parse HEAD`
    experimentId: args.expId ?? null,
    seedsUsed: [args.seed],                      // single-element today
    variantLabels: variants.map(v => v.label),   // already in scope
    summaryJson: summary,                         // the in-memory object that was just written to disk
    verdict: verdictLine,                         // the line printed by print-screen-verdict.ts
    notes: args.note ?? null,
  })
  console.error(`[probe] persisted as phase_eval_runs.id=${runId}`)
}
```

That is the entire service layer. Three things to note:

1. **No new src/ module.** The helper is colocated with the probe under `scripts/phase-eval/` because it serves exactly one caller. If a second probe materializes (the §0 promotion-gate trigger), the helper moves to `src/harness/eval-tests.ts` AT THAT MOMENT — not pre-emptively.
2. **No bootstrap edge.** `persistPhaseEvalRun()` is called explicitly at probe end. Nothing imports it as a side-effect; nothing needs to be "registered."
3. **No verdict computation here.** The helper takes `verdict` as a free-text string — `print-screen-verdict.ts` already produced it. There is no gate evaluator in v1.

### CLI reader (`scripts/phase-eval/list-runs.ts`)

```ts
const args = parseArgs()                            // --probe=... --limit=...
const rows = await sql`
  SELECT id, probe_name, git_commit, experiment_id,
         seeds_used, variant_labels, verdict, ran_at, notes
  FROM phase_eval_runs
  WHERE (${args.probe ?? null}::text IS NULL OR probe_name = ${args.probe ?? null})
  ORDER BY ran_at DESC
  LIMIT ${args.limit ?? 20}
`
console.table(rows)
```

That is the CLI reader. ~20 lines. Detailed-row inspection uses the DB directly (`bun -e "..."` or `psql`) — no need for a richer CLI in v1.

### What's explicitly NOT in the v1 service layer

- `defineSuite()` / suite registry / `runSuite()` orchestrator. v2 only.
- Gate evaluator registry / `phase-variant-screen-v1` total function. The probe's `print-screen-verdict.ts` already produces the verdict; v1 stores it as a string. The R3-R5 polish around variant-keyed signatures, broken-path guards, and total-function semantics is moot at this scope.
- `canonicalizeSuiteConfig()` / `config_hash` / `last_config_hash_change_commit`. There IS no canonical config to hash — the probe's prompt-override paths are CLI args, recorded verbatim in `summary_json`. R3-R5 polish moot.
- `ensureBootstrapped()` / single-flight promise / `assertBootstrapped()`. There IS no bootstrap to enforce. R5 polish moot.
- `compareRuns()` / `submitHumanRating()` / LLM-judge orchestration / `eval_results` composition. v2 only, gated by §0.

### R5→R6 retrospective (preserved for audit trail)

R1–R5 polished a service-layer module under `src/harness/eval-tests.ts` with: a code-registered suite registry (`defineSuite()` / `SUITE_REGISTRY`); a write-through mirror in `test_suites` with `config_hash` drift detection; a `runSuite()` orchestrator that built a `resolved_snapshot` and fanned out cells; a per-`(run, seed)` variant-keyed gate evaluator (`phase-variant-screen-v1`) that ran a total-function broken-path guard before computing G1/G2/G3 ratios; an `ensureBootstrapped()` helper memoizing an in-flight bootstrap promise; a `canonicalizeSuiteConfig()` pure-data-shape sorter; a parity test comparing `Number(x).toFixed(4)` strings.

Every piece of that machinery was justified internally — but Codex R5 attacked the LEVEL not the SHAPE: against the criterion in `decisions.md` ("the probe is the canonical first instrument before committing to harness changes"), the entire module was a higher-cost lever without a stated promotion gate. The cheapest counterfactual was to keep the probe as the runner and add a tiny result index. R6 takes that.

The R5 design sketch is preserved at git commit `3a1effd` (one revision back) for the day a §0 promotion-gate trigger fires.

## 6. Acceptance test (R6)

Step-by-step:

1. Run the existing probe end-to-end with `--persist`:
   ```sh
   bun scripts/phase-eval/probe-planning-scenes.ts \
     --seed=fantasy-system-heretic \
     --variants=default,loud \
     --persist \
     --note="R6 acceptance run"
   ```
2. Verify the probe's stdout, exit code, and `summary.json` file output are byte-identical to a baseline run WITHOUT `--persist`. Specifically: the verdict line in stdout reads `SCREEN-PASS`, the `summary.json` matches the 2026-04-29 known-good values (`facts_median=8`, `know_median=5`, `state_changes_median=...`, `total_scenes=43` — all four G-metrics, NOT the three the R5 design migrated; Codex R5 W2 fix).
3. Verify exactly one row landed in `phase_eval_runs`:
   ```sql
   SELECT id, probe_name, git_commit, seeds_used, variant_labels, verdict
   FROM phase_eval_runs
   ORDER BY ran_at DESC
   LIMIT 1;
   ```
   The row's `probe_name='phase-variant-comparison'`, `seeds_used={fantasy-system-heretic}`, `variant_labels={default,loud}`, `verdict='SCREEN-PASS'`, `summary_json -> 'g_metrics' -> 'facts_median' = '8'::jsonb`.
4. Run the CLI reader and verify it returns the row:
   ```sh
   bun scripts/phase-eval/list-runs.ts --probe=phase-variant-comparison --limit=1
   ```

If acceptance passes, no further migration work is needed. The probe stays the source of truth; the row stays as a queryable mirror.

**Why no §4.7 parity harness:** R6 doesn't rewrite any production code path. The persistence helper reads the probe's existing in-memory `summary` object and writes a row. Per `experiment-design-rules.md §4.7` "Pure evaluation task" exemption, no request-construction parity harness is required. (The earlier R5 design DID rewrite the runner around `runPlanningPhase`; that design's missing parity harness was a Codex R5 blocker. R6 sidesteps the rewrite, so the harness is moot.)

**Smoke test (in tests/):** `tests/persist-phase-eval-run.test.ts` (~30 lines) — calls `persistPhaseEvalRun()` with a fixture summary, then `SELECT`s the row back and asserts every column round-tripped. NOT required at PR-level CI (cost zero — no LLM call); runs via `bun test`. Catches DB-schema drift if anyone touches `sql/033_phase_eval_runs.sql` or `persist-run.ts` later.

## 7. v1 implementation slices (R6 — collapsed)

| Slice | Files | Effort | Acceptance |
|---|---|---|---|
| M0 | `sql/033_phase_eval_runs.sql` (1 table) | ~30 min | Table created on local + LXC; smoke test inserts + reads a fixture row. |
| M1 | `scripts/phase-eval/persist-run.ts` (~40 lines) + `--persist` flag wiring in `probe-planning-scenes.ts` | ~1.5h | Probe with `--persist` produces same stdout/exit-code/`summary.json` AND inserts one `phase_eval_runs` row. Without `--persist`, behavior unchanged. |
| M2 | `scripts/phase-eval/list-runs.ts` (~20 lines) | ~30 min | `bun scripts/phase-eval/list-runs.ts` returns recent rows in tabular form. |
| M3 | `tests/persist-phase-eval-run.test.ts` smoke test | ~30 min | `bun test tests/persist-phase-eval-run.test.ts` passes on local + LXC. |
| M4 | Acceptance run on `fantasy-system-heretic` + verify row landed | ~30 min | Acceptance step 3 above passes — row visible via SQL + CLI reader. |

**Total v1: ~0.5 working day** (was R5's ~3 working days). Drop in scope = one of the largest single deltas in this design's history; that IS the value of taking the cheapest counterfactual.

(R1 had M0–M6 = 5 days; R2/R3/R4/R5 had M0–M5 = ~3 days; R6 = M0–M4 = ~0.5 day.)

## 8. v2 roadmap — gated by §0 promotion criteria

R6 explicitly defers the entire heavier module. v2 starts only when one of §0's promotion-gate triggers fires:

1. **Second probe shape**. A non-planning-scenes probe (e.g. chapter-plan-screen or a writer-arm screen) needs the same persistence + query surface. v2.1 = small shared write helper; v2.2 = service-layer module IF AND ONLY IF a third probe materializes.
2. **Autonomous-context-loop integration** (`docs/designs/autonomous-context-loop.md`). The loop reaches a stage where it needs immutable per-iteration parameter snapshots that the flat `phase_eval_runs.summary_json` doesn't capture cleanly. v2 introduces the `test_runs.resolved_snapshot` shape with the loop's actual usage in front of it.
3. **Cross-run JSONB query becomes painful at production volume.** v2 normalizes a per-(run, metric) table for ergonomic SQL-level analytics. Today's volume is single-digit rows per week; today this is moot.
4. **LLM-judge or human-rating consumer** wants to attach to per-cell artifacts. v2 designs the artifact-set abstraction with that consumer in front of it (Codex R1 issue 3 territory).
5. **Cross-novel diff UI** / leaderboard UI. v2.

Each of these gets its own design doc that cites this v1 + the R5 retrospective at commit `3a1effd`. The R5 design IS pre-designed work for trigger 1+2 — when a trigger fires, that design is the starting point, not blank. The R6 pivot just declines to ship pre-designed work without a confirmed consumer.

**Anti-pattern guard**: Codex R1's refrain across 5 issues was "stop generalizing before one concrete use lands." R5's verdict added a meta-version: "stop polishing the heavier instrument when the cheaper instrument is already shipped." R6 reflects both rules.

## 9. Constraints + non-goals (R6)

1. **No production code path is rewritten.** The probe stays exactly as-is; only the `--persist` flag wiring at the end is added. `experiment-design-rules.md §4.7` "Pure evaluation task" exemption applies.
2. **One probe, one table.** No suite registry, no service-layer module, no gate evaluator code path. Per Codex R5: defer the heavier module until §0 promotion-gate triggers fire.
3. **Probe output is the source of truth.** The `phase_eval_runs` row mirrors the probe's `summary_json` + verdict line verbatim. There is NO secondary computation, NO normalization, NO re-parsing.
4. **All four G-metrics carry through verbatim.** `facts_median`, `know_median`, `state_changes_median`, `total_scenes` — the 4-metric set the probe actually produces (Codex R5 W2 fix). The R5 design's 3-metric subset was an over-narrowing.
5. **No `eval_briefs` / `eval_results` composition.** Codex R1 issue 3 still applies; v2 only.
6. **No agent module touched in v1.** Existing `planning-scenes/index.ts` env-var seam stays as-is. The probe already uses it; the persistence helper doesn't touch it.
7. **No UI in v1.** Codex R1 warning 4.
8. **No "any harness experiment" claim.** Codex R1 warning 5.
9. **`summary_json` is additive-tolerant.** v1 readers MUST tolerate unknown fields the probe may add later. Codex R2 suggestion 4.
10. **Atomic commits per CLAUDE.md rule 5.** M0–M4 = up to 5 commits.
11. **Promotion gate is explicit (§0).** Defer the heavier module until a concrete second consumer materializes. `docs/decisions.md` records the probe as "the canonical first instrument before committing to harness changes"; this design honors that.

## 10. Budget (R6)

### Implementation cost

- M0 (1-table migration): ~30 min.
- M1 (persist-run.ts + `--persist` flag wiring): ~1.5h.
- M2 (list-runs.ts CLI reader): ~30 min.
- M3 (smoke test): ~30 min.
- M4 (acceptance run + row verification): ~30 min.

**v1 total: ~0.5 working day. ~1 calendar day.** R6 cut everything outside the cheapest counterfactual.

### Runtime cost

Zero new LLM cost. The probe's existing run cost (~$0.10/run for 2 variants × 1 seed × planner phase) is unchanged. The persistence helper is a single SQL INSERT.

### Risk surface

- **Probe's in-memory `summary` object shape may not be a clean ground-truth representation.** Mitigation: M1 reads the SAME object the probe already writes to `summary.json`. If the disk file is a faithful artifact (it is — operators have been reading it for two weeks), the row is too. Smoke test in M3 round-trips the JSONB to catch any silent encoding loss.
- **`summary_json` grows over time as the probe gains metrics.** Today it's a few hundred bytes; even at 100× growth a JSONB column handles it.
- **A future second probe shape ships before §0 promotion gate is honored.** Mitigation: §0 explicitly names the trigger (a concrete second probe). The risk is operator-discipline-driven; the gate is policy, not technical enforcement. If the discipline lapses, the worst case is one duplicated `persist-run.ts`, easily refactored at promotion time.
- **§4.7 parity harness is genuinely needed and v1 punted incorrectly.** Mitigation: §6 "Why no §4.7 parity harness" documents the exemption. If the exemption is wrong, the row mirror gives no false signal; the probe IS the runner, so the row reflects whatever the probe produces. There is no alternative implementation to drift from.

## 11. Linked context

- `docs/decisions.md` — records the probe as "the canonical first instrument for ANY planner-prompt change going forward." R6 honors that decision; the heavier module (R1–R5 design) is deferred via §0 promotion gate.
- `docs/experiment-design-rules.md` §4.7 — request-construction parity rule. R6 sidesteps via "Pure evaluation task" exemption (no production code rewritten); §11.1 cheapest-first lever rule. R6 is the cheapest first lever per Codex R5.
- `docs/eval-infrastructure.md` — existing per-beat eval surface; v2 composition target only (gated by §0).
- `docs/designs/phase-variant-comparison.md` — the precedent the probe implements. R6 leaves it unchanged.
- `scripts/phase-eval/{probe-planning-scenes,run-variant,print-screen-verdict}.ts` — the canonical first instrument. R6 adds a `--persist` flag wiring at the end of `probe-planning-scenes.ts`; nothing else changes.
- `scripts/variant/clone-for-variant.ts` — concept-done clone helper. Unchanged in v1.
- `src/agents/planning-scenes/index.ts:6-8` — env-var seam. Unchanged in v1; the probe already uses it.
- `sql/024_eval_briefs_and_results.sql` — existing tables v1 does NOT touch; v2 composes (gated by §0).
- `docs/designs/autonomous-context-loop.md` — sibling subsystem; §0 promotion-gate trigger 2.
- `docs/todo.md` "Three-bucket forward plan" — v1 is Bucket 2.
- `docs/charters/corpus-structural-decomposition-v1.md` — sibling Bucket 1 charter; v1 explicitly does NOT compose with corpus-decomp output.
- Git commit `3a1effd` — R5 design sketch preserved for the day a §0 promotion-gate trigger fires.

## 12. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R1 RED** | `aff15da9fb18060ec` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R2 RED (ITERATE)** | `a5219c7acd0f457fb` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R3 RED (ITERATE)** | `a8d5abb7dd78315fd` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R4 RED (ITERATE)** | `af3ba587dd7f32694` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R5 RED (RUN CHEAPER)** | `a1be2e9cb25a0eaab` |
| (R6 pending) | (pending) | (pending) | (pending) |

### R1 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> BLOCKING ISSUES:
> 1. The persisted suite definition is not executable as specified. `test_suites.definition_json` is JSONB, but `MetricSpec.impl` is a function and `verdictGates[].predicate` is a free-form string over symbols like `G1`/`G4`; `runSuite()` is then supposed to load that definition back from the DB and execute it. That round-trip is undefined.
> 2. The run-level novel-id shape breaks as soon as a suite has more than one seed. `runSuite()` creates one cloned novel per `(seed, variant)`, but `test_runs.variant_novel_ids` is documented as `{variant_label: novel_id}`.
> 3. The proposed `artifact_ref` seam is too thin for the existing eval surface it claims to compose with. `eval_results` is one row per beat, while a metric like voice-shape distance for one `(variant, seed)` is an aggregate over many `eval_results` rows.
> 4. M3 is scoped against the wrong code surface. The design assumes a regex/codegen pass over `src/agents/*/index.ts`, but the real prompt-loading sites are heterogeneous.
> 5. M6 cannot currently be "no behavior change." The shipped verdict depends on structural validity from parseable outline artifacts plus ordered G1-G4 gate evaluation.
>
> CHEAPEST UNTRIED COUNTERFACTUAL: Keep SQL persistence, a tiny `runSuite()` orchestrator, and the existing `planning-scenes` child-process seam, but scope v1 to one precedent only: migrate the current planning-scenes screen, persist its metrics and verdict, and stop there. Cut broad M3 codegen, cut M4/M5 UI, cut human ratings, and cut generic `eval_results` composition.
>
> RECOMMENDED NEXT ACTION: RUN CHEAPER COUNTERFACTUAL.

### R2 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> BLOCKING ISSUES:
> 1. R1 issue 5 (G4 hidden state) only partially closed. Schema carries `phase_result_kind`, `outline_parse_ok`, `outline_count`, but G4's normative definition still underspecified. Implementation could pass a partial-but-parseable cell. Parity target requires `phase_result_kind === "complete" && outline_parse_ok === true && outline_count === expected_chapter_count`, and design does not state where `expected_chapter_count` comes from.
> 2. R1 issue 1 (suite definition execution) only partially closed. Ambiguous source of truth between `test_suites.config_json` (declared data-only) and `defineSuite(id, def)` code registration that also carries variant lists, seed sets, thresholds, metric bindings. CI check only verifies row presence, not config equality.
>
> WARNINGS:
> 1. `_loader.ts` extraction is not load-bearing for v1 parity; reintroduces v2-shaped abstraction pressure into a "one-precedent-only" v1.
> 2. Acceptance language internally inconsistent on numeric parity ("same metric values" vs "byte-for-byte within numeric tolerance" vs `NUMERIC(12,4)`).
> 3. `defineSuite()` pattern relies on side-effect imports but design never names the bootstrap edge that guarantees registration before `runSuite()` executes.
>
> SUGGESTIONS:
> 1. Threshold parameterization is fine — verdict ordering belongs to the named evaluator identity.
> 2. R1 issues 2, 3, and 4 look genuinely closed.
> 3. Concept-cache scoping is not a real v1 problem.
> 4. `snapshot_version` not necessary if `resolved_snapshot` is opaque audit; state additive-tolerance.
> 5. Bespoke scripts: docstring pointer is sufficient.
>
> RECOMMENDED NEXT ACTION: ITERATE-R3.

### R3 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> BLOCKING ISSUES:
> 1. Run-level verdict contract still under-specified. `phase-variant-screen-v1` computes G1/G2/G3 from both variants but G4 from a singular `cell` and never binds that `cell` to `variant_label='loud'`. Shipped precedent is single run-level verdict over `{default, loud}` with G4 loud-specific. Current API can yield wrong verdict or two competing verdicts. Fix: variant-keyed evaluator input (`cellsByVariant.default/loud` + `metricsByVariant`); evaluate once per `(run, seed)` with G4 explicitly bound to `loud`.
>
> WARNINGS:
> 1. `expected_chapter_count` better grounded but design assumes `seed.chapterCount` exists; `SeedInput.chapterCount` is optional. G4 undefined for any seed lacking it. Fix: fail fast in `runSuite()` if any selected seed lacks finite `chapterCount`.
> 2. Numeric-parity still misstated. `facts_median` and `know_median` not guaranteed integer because precedent median averages middle pair on even chapter counts. `NUMERIC(12,4)` is fine; "exact integer equality" is not a correct general rule. Fix: "exact numeric equality at the metric's declared scale," or constrain v1 suites to odd chapter counts.
> 3. Mirror/bootstrap story has stale contradictions. Scope still mentions `_loader.ts`. §3 says `defineSuite()` writes `test_suites`; §5 says only `registerBuiltInSuites()` does. `last_registered_commit` only updates on hash change so name is misleading. Fix: one consistency sweep.
> 4. Old-vs-new parity test optional is too weak. Module's purpose is "same verdict on same input," and this subsystem already saw spec/implementation drift. Fix: required in PR or nightly CI.
>
> SUGGESTIONS:
> 1. Spell out `canonicalizeSuiteConfig()` concretely as a pure data shape; sorted-key JSON is sufficient (full RFC 8785 JCS unnecessary for internal hash surface).
> 2. Add a tiny shared bootstrap helper for non-CLI callers.
>
> ATTACK-SURFACE MAP (per Codex): surfaces 1, 2, 3, 5, 6, 9 = SAFE; surface 4 = WARNING; surfaces 7, 8 = SUGGESTION.
>
> CHEAPEST UNTRIED COUNTERFACTUAL: variant-keyed gate-input patch (~45-60 minutes) — keep the whole R3 shape but replace the singular `cell` input with explicit `{default, loud}` cell-state map and rewrite pseudocode/acceptance text around that single contract.
>
> RECOMMENDED NEXT ACTION: ITERATE-R4.

### R4 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> BLOCKING ISSUES:
> 1. `phase-variant-screen-v1` is not a total function on its declared inputs. The pseudocode reads `cellsByVariant.loud.seed_key`, `metricsByVariant.facts_median.loud`, `.default`, etc. BEFORE the `if (!G4) return 'SCREEN-FAIL (broken)'` short-circuit. If a variant cell crashed or a metric impl errored — exactly the broken paths G4 was designed to catch — the evaluator throws `TypeError: cannot read properties of undefined` instead of returning `SCREEN-FAIL (broken)` cleanly. R4 closed the variant-keyed core bug; this is a follow-on cleanup. Fix: 3-4 line change reordering the guard to run FIRST.
>
> WARNINGS:
> 1. `config_hash` claim "detects drift between commits" overstates what the hash covers. The canonical config excludes metric `impl` function bodies and gate evaluator source — the hash detects DATA-CONFIG drift (variants, seedSet, metric names + tolerances, gate id, thresholds) but not code-identity drift. Fix: narrow the claim to "data-config drift only" and document that code-identity provenance lives at `test_runs.git_commit`.
> 2. Mirror/bootstrap/numeric-wording sweep is partial. Stale references survived: §3 lines 230-234 still say "EXACT EQUALITY at integer scale" (contradicting §0); §7 line 496 says "`defineSuite()` UPSERTs" (contradicting §3 + §5); §9 line 524 says "exact integer equality" (contradicting §0/§6); §11 line 561 still mentions `_loader.ts`. Fix: one consistency sweep across §3, §7, §9, §11.
> 3. `ensureBootstrapped()` is not single-flight. Two concurrent callers (e.g., two unit tests) both pass `BOOTSTRAPPED === false`, both kick off `registerBuiltInSuites()`, both run the UPSERT batch — duplicated DB work + a brief inconsistent-state window. Fix: memoize an in-flight bootstrap promise; concurrent callers race to read the same promise.
>
> SUGGESTIONS:
> 1. The parity test should compare `Number(x).toFixed(4)` strings rather than raw JS numbers. NUMERIC(12,4) round-trips cleanly through `Bun.sql`, but string compare sidesteps any IEEE 754 hazard cheaply.
> 2. Tl;dr typo at line 32: "`last_config_hash_change_commit` is renamed `last_config_hash_change_commit`" — should read "renamed FROM `last_registered_commit` TO `last_config_hash_change_commit`".
>
> ATTACK-SURFACE MAP: surfaces 1 (variant-keyed signature), 2 (chapterCount fail-fast), 3 (canonicalize shape), 6 (CI cost), 8 (rename semantics), 9 (budget reality) = SAFE; surface 4 (ensureBootstrapped concurrency) = WARNING; surface 5 (numeric-parity Bun.sql round-trip) = SUGGESTION; surface 7 (mirror/bootstrap sweep) = WARNING.
>
> CHEAPEST UNTRIED COUNTERFACTUAL: Make `phase-variant-screen-v1` a total function: return `SCREEN-FAIL (broken)` before any `cellsByVariant.loud` or metric dereference. This is a 3-4 line change in the evaluator spec.
>
> RECOMMENDED NEXT ACTION: ITERATE-R5.

### R5 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> SUMMARY: R5 closes the R4 total-function bug, but the design still has not justified why a 4-table/module build is the next cheapest instrument after the already-shipped `scripts/phase-eval/` probe, and it still leaves §4.7 parity discipline under-specified for the runner rewrite.
>
> BLOCKING ISSUES:
> 1. Axis 3 — cheapest-first trigger missing. `decisions.md` records the probe as "the canonical first instrument … before committing to harness changes," while `eval-testing-module-v1 §1/§10` justifies the new subsystem mainly as future query convenience, not a measured decision need. After 5 adversary rounds, `lessons-learned.md` says to re-check instrument-question fit rather than keep polishing the heavier instrument. Per `experiment-design-rules.md §11.1`, this is still a higher-cost lever without a stated promotion gate. Fix: add an explicit trigger for when probe results graduate to harness work (e.g. N planned reruns/arms, cross-run analysis the probe+reports cannot answer, or a concrete consumer that needs DB queryability now), or defer the module and keep using `scripts/phase-eval/`.
> 2. Axis 7 — parity invariant too weak for a design whose sole success claim is "same verdict on same input." `eval-testing-module-v1 §6` requires only one-seed verdict + three metric-string matches, but `experiment-design-rules.md §4.7` requires request-construction parity or a named alternative invariant when code is rewritten around a production LLM path. `lessons-learned.md` cites two silent regressions that only request-byte parity caught. Because v1 rewrites the runner/orchestrator around `runPlanningPhase`, one-seed output parity is not a strong enough invariant unless the doc explicitly says why. Fix: add old-probe-vs-new-runner request-construction parity for the planner call shape, or explicitly name the §4.7 skip category / alternative invariant and tighten it beyond one-seed end-output matching.
>
> WARNINGS:
> - Axis 6 — `test_runs.verdict` is singular while the evaluator output is "per-(run, seed) verdict"; the first multi-seed suite will not have a canonical place to store two seed-level verdicts. Narrow the claim or normalize verdict storage before v2.
> - Axis 6 — The probe reports four G-metrics including state-changes/chapter; `phase-variant-comparison.md §Decision criteria` and `eval-testing-module-v1 §6` migrate only `facts_median`, `know_median`, `total_scenes` plus structural G4. Reconcile so "same metric values" is either literally true or explicitly narrowed to the verdict-driving metrics.
> - Axis 5 — broken-path population contract for `metricsByVariant` left implicit (whole metric omitted vs variant key omitted). Not a correctness bug but should be written once to avoid future suite-specific assumptions.
>
> CHEAPEST UNTRIED COUNTERFACTUAL: Keep `scripts/phase-eval/probe-planning-scenes.ts` as the runner and store/report its JSON outputs directly via a tiny append-only result index — ~$0 engineering, expected ~100% of the immediate directional signal the project designated as the first instrument before harness work.
>
> RECOMMENDED NEXT ACTION: RUN CHEAPER COUNTERFACTUAL

R6 takes Codex's named cheapest counterfactual. Submit R6 to Codex for follow-up review.

R6 attack surfaces for Codex:

- **§0 promotion-gate criteria.** R6 names 4 triggers for graduating from probe + result index to a heavier module: second probe shape, autonomous-loop integration needing immutable snapshots, cross-run JSONB query becoming painful, LLM-judge/human-rating consumer attaching to per-cell artifacts. Are these triggers concrete enough to operationalize? Specifically, what's "painful" in trigger 3 — cross-run JSONB scan time, query readability, both? Should there be a quantitative threshold (e.g., "when cross-run analysis requires >3 nested `->` operators on `summary_json`, normalize")?
- **§4.7 "Pure evaluation task" exemption.** R6 §6 + §11 cite `experiment-design-rules.md §4.7`'s "Pure evaluation task" exemption: "experiment only reads existing data / runs offline scoring; no new production-shape request is constructed." R6 reads the probe's in-memory output and writes a row — no LLM call. Verify this is the correct exemption category. (The other category that could apply: "Analysis-only — generates reports/statistics from `llm_calls` / `eval_results` without invoking any production code path." Both seem to fit; the doc cites Pure-evaluation-task because the persistence helper IS the experimental code path, even though it doesn't invoke production.)
- **`summary_json` JSONB shape contract.** R6 §3 says `summary_json` is the probe's `summary` object verbatim. The probe's actual shape includes `g_metrics` (4 metrics: facts_median, know_median, state_changes_median, total_scenes), per-variant outline arrays, per-(seed, variant) outline counts. Is "verbatim probe output" a stable enough contract for downstream queries, or should there be a thin `summary_version` field for forward-compat?
- **`variant_labels` redundancy with `summary_json`.** R6 §3 keeps `variant_labels` as a top-level column despite redundancy with `summary_json -> 'variants'`. Is a TEXT[] column the right shape vs a JSONB[]? When the probe gains a third variant (e.g., 'verbose'), does inserting `{default,loud,verbose}` work cleanly with the existing index?
- **Smoke test scope.** R6 M3 specifies a ~30-line smoke test for `persistPhaseEvalRun()`. Should the smoke test ALSO verify the probe's `--persist` flag wiring (i.e., end-to-end probe-with-flag → row landed)? That would cost ~$0.10 LLM (the probe runs the real planner) but catches the wiring bug in addition to the helper bug. R6 left this out to keep the smoke test fast; should it be optional/nightly instead?
- **Probe stays as truth across `--persist` / no-`--persist` paths.** R6 acceptance step 2 requires byte-identical probe stdout/exit-code/`summary.json` between `--persist` and no-`--persist` runs. Verify the persistence helper has no side effect on those outputs (e.g., the helper logs a `[probe] persisted as phase_eval_runs.id=N` line to stderr — is that "byte-identical" or a violation?). Stderr-vs-stdout split is the natural answer; pin it down.
- **R6 budget reality.** R6 says ~0.5 working day total. M0 is 30 min (single-table migration), M1 is 1.5h (helper + flag wiring), M2 is 30 min (CLI reader), M3 is 30 min (smoke test), M4 is 30 min (acceptance run). Verify nothing is missing — does the LXC deploy + LXC migration apply count toward the budget? Per CLAUDE.md rule 6, sql/** changes need deploy + apply on LXC.
- **R6 vs R5 retrospective fairness.** R6 §5 retrospective + §0 frame the R5 design as over-engineered. Is that fair? R5 was responding to genuine R1-R4 verdicts at each round, and the R5 design IS a coherent shape — Codex R5's verdict was that the LEVEL was wrong, not that the SHAPE was wrong. Verify the §0 framing doesn't undersell R5's design; the R5 commit `3a1effd` is preserved as starting point for the day a promotion gate trigger fires.
