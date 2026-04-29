---
status: draft (pending Codex R4 adversarial review)
kind: subsystem-design
name: eval-testing-module-v1
owner: andre
date: 2026-04-29
revision: 4
parent-context: docs/todo.md "Three-bucket forward plan", docs/eval-infrastructure.md, docs/charters/corpus-structural-decomposition-v1.md (sibling — Bucket 1)
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent aff15da9fb18060ec, 2026-04-29) — 5 blockers, 6 warnings, named cheapest counterfactual: "planning-beats-only migration v1." Recommended action: RUN CHEAPER COUNTERFACTUAL.
  R2: RED (codex:codex-rescue gpt-5.5 effort=high, agent a5219c7acd0f457fb, 2026-04-29) — pivot landed cleanly (R1 issues 2/3/4 closed); 2 partial-closures + 3 warnings. Recommended action: ITERATE-R3.
  R3: RED (codex:codex-rescue gpt-5.5 effort=high, agent a8d5abb7dd78315fd, 2026-04-29) — R3 materially closed both R2 blockers (R3 attack surfaces 1/2/3/5/6/9 SAFE per Codex). 1 remaining blocker: gate-evaluator signature is singular `cell` but verdict over `{default, loud}` needs variant-keyed inputs (G4 must bind explicitly to loud). 4 warnings + 2 suggestions. Named cheapest counterfactual: "variant-keyed gate-input patch (~45-60 min)". Recommended action: ITERATE-R4.
related:
  - docs/eval-infrastructure.md (existing eval_briefs/eval_results layer this design composes with — v2 territory)
  - docs/designs/phase-variant-comparison.md (the one-off precedent v1 migrates)
  - docs/designs/autonomous-context-loop.md (sibling subsystem; v2 schema readiness consideration)
  - scripts/phase-eval/ (the bespoke scripts being made durable)
  - sql/024_eval_briefs_and_results.sql (existing tables; v1 does NOT compose with these)
  - ui/src/components/NovelReadView.tsx:325-360 (paragraph-aligned diff renderer — v2 territory)
---

# Durable Eval / Testing Module — Design Sketch (Revision 4)

## 0. Tl;dr (R4 — variant-keyed gate evaluator)

**R3 closed both R2 blockers (Codex R3 confirmed surfaces 1/2/3/5/6/9 SAFE). R4 closes the remaining R3 blocker: the gate evaluator's signature was singular-cell but the verdict spans `{default, loud}`. Plus 4 fixable nits.**

R1 (RED) was generalized too far before any concrete use shipped. R2 (RED) collapsed scope to one-screen-only migration. R3 (RED) made code the source of truth, gave G4 a 3-condition spec, and named the bootstrap edge — but the gate-evaluator pseudocode took a singular `cell` while the verdict for `phase-variant-screen-v1` is over BOTH variants (G1/G2/G3 are inter-variant ratios; G4 is loud-specific). R4 fixes the verdict-input contract:

- **One precedent only**: v1 migrates `phase-variant-comparison-r5` to a durable shape. Same as R2/R3.
- **Code is the single source of truth (R2 blocker 2 + R3 W3 fix)**: `defineSuite()` in code is authoritative; `test_suites` is a write-through mirror updated ONLY by `registerBuiltInSuites()` (NOT by `defineSuite()` — clarification per R3 W3). `last_config_hash_change_commit` is renamed `last_config_hash_change_commit` to match what the column actually means. `test_runs.resolved_snapshot` is the immutable per-run audit artifact.
- **G4 parity semantics fully specified + variant-bound (R2 blocker 1 + R3 blocker 1 fix)**: `expected_chapter_count` is sourced from `test_runs.resolved_snapshot.per_seed.<seed_key>.chapter_count` (captured from `seed.chapterCount` at `runSuite()` entry; required-non-null per R3 W1 fix). The gate evaluator signature is `(cellsByVariant, run, metricsByVariant, thresholds)` — variant-keyed (R3 blocker 1 fix). G4 binds EXPLICITLY to `cellsByVariant.loud` (the rider-targeting variant).
- **Bootstrap edge specified + non-CLI helper (R2 warning 3 + R3 S2 fix)**: `src/harness/eval-tests.ts` imports `./suites/index.ts`, which imports each individual suite file. A shared `ensureBootstrapped()` helper lets non-CLI callers (tests, future server routes) trigger the bootstrap without re-implementing the sequence.
- **`_loader.ts` cut from v1 (R2 warning 1 + R3 W3 sweep)**: existing `planning-beats/index.ts` env-var seam is left UNCHANGED. R3's stale references in §2 (lines 80, 89) are removed in R4. v2 lifts it into a shared helper when a second agent needs it.
- **Numeric-parity contract corrected (R2 warning 2 + R3 W2 fix)**: v1 metrics are NOT all integer — `facts_median` and `know_median` can be non-integer when `chapter_count` is even (median of even-count list averages middle pair). Canonical rule: **exact numeric equality at the metric's declared scale** (`NUMERIC(12,4)` storage). v1 acceptance values (`facts_median=8`, `know_median=5`, `total_beats=43`) happen to be integer because the 2026-04-29 known-good run was on a 3-chapter seed (odd → no averaging). Future seeds with even chapter counts will produce halves; the equality rule still holds.
- **Parity test required (R3 W4 fix)**: `tests/eval-test-parity.test.ts` is REQUIRED in CI (PR-level, not nightly). Module's stated purpose is "same verdict on same input"; an optional parity test is too weak.
- **No UI, no human ratings, no LLM-judge integration, no `eval_results` composition.** All v2. Same as R2/R3.

R4 acceptance: `bun scripts/eval-test/run.ts phase-variant-loud-rider-v2 --seed=fantasy-system-heretic` produces the SAME `SCREEN-PASS` verdict and EXACT-NUMERIC-EQUAL metric values (at NUMERIC(12,4) declared scale) as `bun scripts/phase-eval/probe-planning-beats.ts` on the same inputs. (`facts_median=8`, `know_median=5`, `total_beats=43` — the 2026-04-29 known-good values.)

**v1 scope: ~3 working days + ~1h for the variant-keyed gate-input patch + parity-test scaffold.** Same as R3 modulo the variant-keyed fix.

## Pivot history

- **R1 (RED):** Codex (`aff15da9fb18060ec`, gpt-5.5 effort=high) flagged 5 blockers + 6 warnings. Named cheapest counterfactual: "planning-beats-only migration; cut M3 broad codegen, cut M4/M5 UI, cut human ratings, cut `eval_results` composition." Recommended action: RUN CHEAPER COUNTERFACTUAL.
- **R2 (RED, ITERATE-R3):** Codex (`a5219c7acd0f457fb`, gpt-5.5 effort=high) confirmed R1 issues 2/3/4 closed. Two partial-closures + 3 warnings. Recommended action: ITERATE-R3.
- **R3 (RED, ITERATE-R4):** Codex (`a8d5abb7dd78315fd`, gpt-5.5 effort=high) confirmed both R2 blockers genuinely closed AND most R3 attack surfaces SAFE (1, 2, 3, 5, 6, 9). 1 remaining blocker: gate evaluator signature is singular `cell` but verdict over `{default, loud}` needs variant-keyed input — G4 must bind explicitly to the loud cell. 4 warnings (chapterCount-may-be-null, integer-equality wording incorrect for even chapter counts, mirror/bootstrap residual contradictions, parity test should be required not optional) + 2 suggestions (canonicalize spec, ensureBootstrapped helper for non-CLI). Named cheapest counterfactual: "variant-keyed gate-input patch (~45-60 min)." Recommended action: ITERATE-R4.
- **R4 (this revision):** integrated the R3 blocker + all 4 warnings + both suggestions. Gate evaluator signature is now `(cellsByVariant, run, metricsByVariant, thresholds)`; G4 binds explicitly to `cellsByVariant.loud`. Numeric-parity rule corrected. Mirror/bootstrap inconsistencies swept in §2/§3/§5. Parity test promoted to required. `canonicalizeSuiteConfig()` shape spelled out. `ensureBootstrapped()` helper added for non-CLI callers.

## 1. Goal (R2)

Make ONE bespoke variant-comparison script (`scripts/phase-eval/probe-planning-beats.ts` + `print-screen-verdict.ts`) durable, rerunnable, and queryable — without changing what it does or what verdict it produces.

**v1 acceptance test:** for the same `(seed, variant prompts)` input, `runSuite("phase-variant-loud-rider-v2", {seed: "fantasy-system-heretic"})` produces the SAME `SCREEN-PASS` verdict as the existing probe script. Same metric values. Same gate evaluation. Same exit code.

**Why:** the existing probe is a 200-line one-off. Running it again later means re-implementing it. Persisting it once with code-registered metrics and an immutable run snapshot lets future Andre query "what was loud variant's `facts_median` on the 2026-04-29 run?" without re-reading commit logs and re-running scripts. That's the core value, isolated.

**v2 (roadmapped, NOT in v1):**
- Generalize to a second agent (e.g., chapter-plan-checker) by extracting a shared `loadPrompt(defaultPath, envVar)` helper.
- Add UI (cross-novel diff page + leaderboard).
- Add human-rating widget + LLM-judge integration.
- Compose with `eval_briefs` / `eval_results` for voice-shape-distance metrics.
- Schema additions for autonomous-context-loop integration (per-iteration parameter vectors).

v2 work happens via separate design docs that cite this v1 + extend the schema. R2 explicitly does NOT pre-design v2 — every Codex review round confirmed pre-designed generalization is the failure mode.

## 2. Scope (R2)

### In scope (v1)

- **3 new tables** (revised from R1's 4 — `test_human_ratings` deferred to v2):
  - `test_suites` — code-registered suite identifier + persisted data-only configuration.
  - `test_runs` — one row per execution; snapshots the fully resolved variant config at run time (Codex R1 issue 1 fix: round-trip is suite-id+resolved-snapshot, not JSONB-to-function).
  - `test_run_cells` — keyed by `(run_id, seed_key, variant_label)` (Codex R1 issue 2 fix); carries per-cell novel id, completion status, and runner-state validity flags (e.g., `outline_parse_ok`, `phase_result_kind`).
- **`test_metric_results`** stays simple: per-(cell, metric) numeric value + structured raw value. NO `artifact_ref` to `eval_results` (Codex R1 issue 3 fix — defer composition to v2).
- **Service layer module** at `src/harness/eval-tests.ts`:
  - Code-registered suite registry: `defineSuite(id, def) → registers in module-scope map`.
  - `runSuite(id, opts) → TestRunId` — orchestration only; metric impls live in code, looked up from registry.
  - `getRunResults(runId) → TestRunResults` — DB join over runs + cells + metrics.
  - NO `compareRuns()`, NO `submitHumanRating()` in v1.
- **One concrete suite registered**: `phase-variant-loud-rider-v2` migrating the existing planning-beats screen (Codex R1 issue 5 fix + warning 6: pick the SHIPPED probe shape as authoritative, not the chartered shape).
- **Concrete gate evaluator**: `applyGates(metrics, cellState, gates) → verdict` operates on (named metric values, named cell state fields like `outline_parse_ok`, ordered predicate table). Codex R1 issue 5 fix: G4 (structural validity) is now a first-class `test_run_cells.outline_parse_ok` column, not a hidden runner-state ghost.
- **Existing planning-beats env-var seam** (`src/agents/planning-beats/index.ts:6-8`) stays UNCHANGED in v1 (R3 W3 sweep — earlier R3 text mentioned a `_loader.ts` helper; that mention is removed in R4). v2 introduces a shared helper when a second agent needs an env-var seam — abstraction unjustified at one consumer.
- **CLI runner** at `scripts/eval-test/run.ts`:
  - `bun scripts/eval-test/run.ts <suite-id> --seed=<key> [--keep-novels] [--exp-id=<id>]`
  - One-suite-one-seed in v1; multi-seed is a v2 concern but the schema supports it from day 1 via `test_run_cells`.
- **Concept-cache scoping** (Codex R1 warning 2 fix): documented as PER-RUN (each `runSuite()` call mints a fresh concept-done snapshot novel id). No global cache. Matches the existing probe's behavior at `scripts/phase-eval/probe-planning-beats.ts:140-143`.

### Out of scope (v1, defer to v2)

- **Any second agent migration.** Only planning-beats in v1. Generalization happens after v1 ships and we have one durable suite to extend FROM.
- **Broad per-agent codegen.** No agent module is touched in v1 (R3 W3 sweep — earlier R3 mentioned a `loadPrompt()` helper; cut). Codex R1 issue 4 verified the other agents (writer, reference-resolver, halluc-*, continuity, tonal-pass) have heterogeneous prompt-loading patterns that need hand-care. Don't fight those in v1.
- **Cross-novel diff UI.** Defer. The existing phase-variant probe has no UI — migration proof doesn't need one. Codex R1 warning 4: "M5 is not load-bearing for the first proof."
- **Leaderboard UI.** Same reasoning.
- **Human-rating widget.** Same.
- **LLM-judge integration.** Same. (Codex R1 warning 3: existing transport already supports judge calls; v2 just needs the telemetry/agent-name plumbing.)
- **`eval_briefs` / `eval_results` composition.** v2. Codex R1 issue 3: the artifact-set abstraction needs design before this works; punt.
- **Autonomous-context-loop integration.** v2. Codex R1 warning 1: the schema needs immutable resolved-config snapshot for that to work; v1 schema lays the foundation but the loop integration is its own design.
- **"Any harness experiment" framing.** Codex R1 warning 5: this module is for full-pipeline variant comparisons of the phase-variant-screen shape. Corpus charter (Bucket 1) is read-only and outside; voice-shaping ablations need additional composition layers (also v2).

## 3. Data model (R2)

```sql
-- New: sql/033_eval_testing_module.sql

-- Suite identity. WRITE-THROUGH MIRROR of code-registered suites.
-- Code (src/harness/suites/<id>.ts files) is the single source of truth
-- (R2 blocker 2 + R3 W3 fix). The DB row is created/updated by the
-- explicit `registerBuiltInSuites()` call (NOT by `defineSuite()` —
-- `defineSuite()` is sync and only updates the in-memory registry).
-- config_hash detects drift between commits.
CREATE TABLE IF NOT EXISTS test_suites (
  id                  SERIAL PRIMARY KEY,
  suite_id            TEXT NOT NULL UNIQUE,                -- 'phase-variant-loud-rider-v2'
  description         TEXT,
  -- Mirror of the code-defined suite at last register-time. Audit purpose
  -- only; runSuite() reads from the in-memory registry, NOT this column.
  -- (R2 blocker 2 fix — config_json is data only, code is authoritative.)
  config_json         JSONB NOT NULL,
  -- SHA-256 of canonicalized config_json (R3 S1 fix — see
  -- canonicalizeSuiteConfig() in §5). registerBuiltInSuites() computes
  -- the hash; if the existing row has a different hash, the row is
  -- UPDATED + a console warning is emitted. (R2 blocker 2 fix.)
  config_hash         TEXT NOT NULL,
  -- (R3 W3 fix — column renamed from `last_registered_commit` because
  -- it only updates when the config_hash changes, not on every register.)
  -- Captures the commit at the most recent hash change for forensics.
  last_config_hash_change_commit TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id                  SERIAL PRIMARY KEY,
  suite_id            TEXT NOT NULL REFERENCES test_suites(suite_id),
  experiment_id       INT REFERENCES tuning_experiments(id),
  git_commit          TEXT NOT NULL,                       -- captured at runSuite() entry
  -- Snapshot of the fully resolved suite config + selected variant subset
  -- + selected seed subset + per-seed expected_chapter_count + git commit,
  -- at run time. v1 readers MUST be tolerant of additive fields (R2
  -- suggestion 4); a snapshot_version field will be added in v2 if a
  -- breaking change to the snapshot shape becomes necessary.
  --
  -- Required fields (v1):
  --   suite_id, suite_config_hash, variants, seeds[],
  --   per_seed: { seed_key, chapter_count, premise_hash, ... },
  --   gates: { evaluator_id, thresholds }
  resolved_snapshot   JSONB NOT NULL,
  status              TEXT NOT NULL,                       -- 'running' | 'complete' | 'failed' | 'cancelled'
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  verdict             TEXT,                                -- 'SCREEN-PASS' | 'SCREEN-FAIL (...)' | NULL
  notes               TEXT
);
CREATE INDEX idx_test_runs_suite ON test_runs(suite_id);
CREATE INDEX idx_test_runs_exp ON test_runs(experiment_id);

-- Per-cell row. Replaces R1's variant_novel_ids JSONB on test_runs,
-- which broke for multi-seed (Codex R1 issue 2). One row per
-- (run, seed, variant) cell. Carries first-class runner-state fields
-- the gate evaluator reads (R1 issue 5 + R2 blocker 1 fix — full G4
-- semantics).
CREATE TABLE IF NOT EXISTS test_run_cells (
  id                  SERIAL PRIMARY KEY,
  run_id              INT NOT NULL REFERENCES test_runs(id),
  seed_key            TEXT NOT NULL,                       -- 'fantasy-system-heretic'
  variant_label       TEXT NOT NULL,                       -- 'default' | 'loud' | ...
  novel_id            UUID NOT NULL,                       -- the cloned-from-concept-done novel for this cell
  cell_status         TEXT NOT NULL,                       -- 'pending' | 'running' | 'phase-complete' | 'phase-failed'
  -- G4 (structural validity) parity fields. v1 gate evaluator reads:
  --   G4 := phase_result_kind = 'complete'
  --       AND outline_parse_ok = TRUE
  --       AND outline_count = (test_runs.resolved_snapshot ->>
  --                             ('per_seed.' || seed_key || '.chapter_count'))::int
  -- (R2 blocker 1 fix — expected_chapter_count source is the per-seed
  -- snapshot field captured in resolved_snapshot at runSuite() entry.)
  phase_result_kind   TEXT,                                -- 'complete' | 'paused' | NULL on crash
  outline_parse_ok    BOOLEAN,                             -- did all chapter outlines schema-validate?
  outline_count       INT,                                 -- N produced (compared to expected_chapter_count)
  error_text          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  UNIQUE(run_id, seed_key, variant_label)
);
CREATE INDEX idx_test_cells_run ON test_run_cells(run_id);

-- Per-(cell, metric) row. NO artifact_ref to eval_results in v1.
-- v2 adds an artifact-set abstraction (Codex R1 issue 3 — needs design).
CREATE TABLE IF NOT EXISTS test_metric_results (
  id                  SERIAL PRIMARY KEY,
  cell_id             INT NOT NULL REFERENCES test_run_cells(id),
  metric_name         TEXT NOT NULL,                       -- registry-resolved name
  -- v1 metrics are integer counts (facts_median, know_median, total_beats
  -- — all from chapter_outlines.outline_json field counts). Stored as
  -- NUMERIC(12,4) for forward-compat; v1 gate evaluator compares with
  -- exact equality (acceptance contract — R2 warning 2 fix).
  -- Future non-integer metrics declare per-metric tolerance at metric
  -- definition time; the gate evaluator reads it from the metric registry.
  numeric_value       NUMERIC(12,4),
  raw_value           JSONB,                               -- structured detail (per-chapter breakdown etc.)
  error_text          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cell_id, metric_name)
);
CREATE INDEX idx_test_metric_cell ON test_metric_results(cell_id);
```

### Why this shape

- **Code is the single source of truth for suite definitions (R2 blocker 2 + R3 W3 fix).** Suite definitions live in `src/harness/suites/<suite-id>.ts` files. `defineSuite(id, def)` is **sync** — it ONLY updates the in-memory registry. The async write-through to `test_suites` table happens in `registerBuiltInSuites()` (see §5 bootstrap). `runSuite()` reads from the in-memory registry, NEVER `test_suites.config_json`. The DB row exists for audit/cross-machine inspection only.

- **`config_hash` detects drift.** `registerBuiltInSuites()` SHA-256s the canonicalized config (see `canonicalizeSuiteConfig()` in §5); if the existing DB row has a different hash, the row is UPDATED + a console warning is emitted ("suite phase-variant-loud-rider-v2 redefined since prior register; check git log for the suite file"). Future runs of `runSuite()` proceed with the new in-memory definition. The `last_config_hash_change_commit` column captures the git commit at the hash change for forensics; it does NOT update on no-op registration calls.

- **`test_runs.resolved_snapshot`** stores the full resolved config (all variant prompt paths copied verbatim, all metric impls resolved to their registry ID, all gate predicates resolved to their evaluator ID) at run-time, PLUS per-seed `chapter_count` (sourced from the seed's `chapterCount` field at `runSuite()` entry). This is the immutable record the autonomous-context-loop will eventually consume. v1 readers MUST be tolerant of additive fields (R2 suggestion 4); a `snapshot_version` field will be introduced in v2 if a non-additive shape change is ever needed.

- **`test_run_cells` normalizes the (seed, variant) matrix.** Multi-seed support is free — `test_run_cells` rows multiply across the matrix. v1 only uses one seed per run, but the schema doesn't constrain that. Codex R1 issue 2 fix.

- **`test_run_cells` runner-state fields fully specify G4 (R2 blocker 1 fix)**. The G4 predicate IS:
  ```
  G4(cell, run) := cell.phase_result_kind = 'complete'
                AND cell.outline_parse_ok = TRUE
                AND cell.outline_count = expected_chapter_count(cell, run)
  expected_chapter_count(cell, run) :=
    (run.resolved_snapshot -> 'per_seed' -> cell.seed_key ->> 'chapter_count')::int
  ```
  The gate evaluator reads `cell.outline_parse_ok = true` AND `cell.outline_count = expected_chapter_count` AND `cell.phase_result_kind = 'complete'`. All three conditions must hold. A partial-but-parseable run (e.g., 2 of 3 chapters complete) FAILS G4 because `outline_count = 2 ≠ expected = 3`.

- **No `artifact_ref`** in v1's `test_metric_results`. v2 adds an artifact-set abstraction when `eval_results` composition is actually needed. Codex R1 issue 3: don't ship a half-designed pointer that won't survive its first real use.

- **Numeric-parity contract (R2 warning 2 fix)**: v1 metrics are integer counts (`facts_median`, `know_median`, `total_beats` — all derived from `chapter_outlines.outline_json` field-count operations). The acceptance contract is **EXACT EQUALITY** at integer scale. NUMERIC(12,4) storage is for forward-compat; v1 gate evaluator compares integer-cast values. Future non-integer metrics (e.g., voice-shape distance) declare per-metric tolerance at definition time:
  ```ts
  { name: 'voice_shape_distance', impl: ..., tolerance: 0.0001 }
  ```
  The gate evaluator reads `tolerance` from the metric registry; if absent, exact equality is assumed.

### Why NOT touch `eval_briefs` / `eval_results` in v1

`eval_briefs` is per-beat single-shot generation. v1 is full-pipeline variant comparison. Different problem. Composition between them needs an artifact-set abstraction (Codex R1 issue 3 suggested fix). v2 designs that abstraction with concrete use cases in front of it (e.g., voice-shape-distance metric over an ablation arm's beats). v1 doesn't pretend to compose.

### Why no `test_human_ratings` in v1

v1 acceptance is "produce the same SCREEN-PASS verdict as the existing probe." That is a deterministic test, no human in the loop. Human ratings need a UI to be useful, which v1 doesn't have. Both are v2.

## 4. Variant runner (R3 — minimal, no new abstraction)

The phase-variant probe already works. v1's runner reuses its child-process pattern verbatim:

- Existing `src/agents/planning-beats/index.ts:6-8` env-var seam stays UNCHANGED. (R2 warning 1 fix — `_loader.ts` was v2-shaped abstraction pressure; cut from v1.)
- No agent module is touched in v1. Codex R1 issue 4: heterogeneous prompt-loading sites (writer's primer composition, halluc-*'s readFileSync, continuity/tonal-pass's outside-of-index loaders) are v2's problem when a second agent needs an env-var seam.
- v2 will introduce a shared `loadPrompt(defaultPath, envVar)` helper at the point where two or more agents need it; the abstraction is unjustified at one consumer.

`scripts/eval-test/run-variant.ts` is a thin wrapper over the existing `scripts/phase-eval/run-variant.ts` shape:
- Reads suite-resolved config from a temp file (parent → child handoff).
- Sets `PLANNING_BEATS_PROMPT_OVERRIDE` env var per variant.
- Calls `runPlanningPhase(novelId)`.
- Writes outline output + cell-status fields (`phase_result_kind`, `outline_parse_ok`, `outline_count`, `error_text`) to a JSON file the parent reads.

Per Codex R1 warning 6, the v1 runner adopts the SHIPPED probe shape (argv for novel/output + env for prompt override) as authoritative. The chartered "larger env-var bundle" version (per `phase-variant-comparison.md` §"Runner") is NOT implemented; the chartered text is updated post-v1 to reflect the actual shipped contract.

### Concept-cache scoping (Codex R1 warning 2 fix)

`runSuite()` mints a fresh concept-done snapshot per (run, seed) — same behavior as `scripts/phase-eval/probe-planning-beats.ts:140-143`. There is NO global cache. If a future suite wants to share concepts across runs, that's a v2+ optimization.

### Process-isolation rationale

Unchanged from R1 §4: module-level prompt cache + global `currentRunId` + global transport mean each variant runs in its own child process. The phase-variant-comparison charter §"Why child processes" already established this; v1 doesn't relitigate.

## 5. Service layer (R3 — code-authoritative + explicit bootstrap)

`src/harness/eval-tests.ts`:

```ts
type SuiteDefinition = {
  variants: { label: string; promptOverrides: { 'planning-beats': string } }[]
  seedSet: string[]                                 // v1: always single-element
  metrics: { name: string; impl: MetricFn; tolerance?: number }[]   // code-registered
  gates: GateDefinition                             // code-registered ordered predicate table
}

type MetricFn = (ctx: MetricCtx) => Promise<MetricResult>
type MetricCtx = { novelId: string; seedKey: string; variant: string; db: typeof Bun.sql }
type MetricResult = { numericValue?: number; rawValue?: any; errorText?: string }

type GateDefinition = {
  evaluator: 'phase-variant-screen-v1'              // named evaluator from a code registry
  thresholds: Record<string, number>                // e.g. { facts_median_floor: 8, facts_median_ratio: 1.5, ... }
}

// Module-scope registry. CODE IS THE SOURCE OF TRUTH (R2 blocker 2 fix).
// test_suites table is a write-through mirror; runSuite() reads from this
// in-memory registry, never from test_suites.config_json.
const SUITE_REGISTRY: Record<string, SuiteDefinition> = {}
let BOOTSTRAPPED = false

export function defineSuite(id: string, def: SuiteDefinition): void {
  SUITE_REGISTRY[id] = def
  // Async write-through to test_suites table happens in registerBuiltInSuites()
  // batch at bootstrap time, NOT here (defineSuite() is sync).
}

export function assertBootstrapped(): void {
  if (!BOOTSTRAPPED) throw new Error("eval-tests: registerBuiltInSuites() not called")
}
```

### Bootstrap edge (R2 warning 3 + R3 S2 fix — ensureBootstrapped helper for non-CLI callers)

`defineSuite()` registration is side-effect-import-driven, but the entry point is explicit:

```ts
// src/harness/suites/index.ts — the bootstrap edge
import "./phase-variant-loud-rider-v2"     // each suite file calls defineSuite() at top level
// Future v2 suites added here.

export async function registerBuiltInSuites(): Promise<void> {
  if (BOOTSTRAPPED) return                      // idempotent (R3 S2 fix)
  for (const [id, def] of Object.entries(SUITE_REGISTRY)) {
    const configJson = JSON.stringify(canonicalizeSuiteConfig(def))
    const configHash = sha256(configJson)
    await db`
      INSERT INTO test_suites (suite_id, description, config_json, config_hash, last_config_hash_change_commit)
      VALUES (${id}, ${def.description ?? null}, ${configJson}::jsonb, ${configHash}, ${currentCommitSha()})
      ON CONFLICT (suite_id) DO UPDATE SET
        config_json = EXCLUDED.config_json,
        config_hash = EXCLUDED.config_hash,
        last_config_hash_change_commit = EXCLUDED.last_config_hash_change_commit,
        updated_at = now()
      WHERE test_suites.config_hash != EXCLUDED.config_hash
      RETURNING (xmax = 0) AS inserted
    `
    // ON CONFLICT log a warning if config drifted; otherwise silent.
  }
  BOOTSTRAPPED = true
}

// R3 S2 fix — non-CLI helper. Tests, future server routes, and any other
// caller that doesn't go through scripts/eval-test/run.ts can call this
// to ensure the bootstrap has run. CLI runner can also call it; idempotent.
export async function ensureBootstrapped(): Promise<void> {
  if (!BOOTSTRAPPED) await registerBuiltInSuites()
}
```

### `canonicalizeSuiteConfig()` shape (R3 S1 fix)

Pure data shape. Sorted-key JSON serialization is sufficient for this internal hash surface; full RFC 8785 JCS is unnecessary.

```ts
function canonicalizeSuiteConfig(def: SuiteDefinition): CanonicalConfig {
  return {
    variants: def.variants
      .map(v => ({ label: v.label, promptOverrides: sortedKeys(v.promptOverrides) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    seedSet: [...def.seedSet].sort(),
    metrics: def.metrics
      .map(m => ({ name: m.name, tolerance: m.tolerance ?? null }))   // NO impl reference; metric impl resolution is a runtime concern
      .sort((a, b) => a.name.localeCompare(b.name)),
    gates: {
      evaluator: def.gates.evaluator,
      thresholds: sortedKeys(def.gates.thresholds),
    },
  }
}
```

Two suites with the same canonical config but different metric `impl` functions are treated as **the same suite for hashing purposes**. The metric registry resolves `name` → `impl` at runtime; if two source files register different impls under the same name, that's a bug caught by the metric registry's own duplicate check, NOT by `config_hash`.

`scripts/eval-test/run.ts` calls `ensureBootstrapped()` at startup. Tests and any future non-CLI callers do the same.

```ts
export async function runSuite(id: string, opts: RunOptions): Promise<TestRunId> {
  assertBootstrapped()                            // alternative: await ensureBootstrapped() if caller is willing to pay the once-per-process cost
  const def = SUITE_REGISTRY[id]
  if (!def) throw new Error(`eval-tests: unknown suite '${id}' — registered suites: ${Object.keys(SUITE_REGISTRY).join(', ')}`)

  // R3 W1 fix — fail fast if any selected seed lacks a finite chapterCount.
  // SeedInput.chapterCount is optional in the schema but G4 requires it;
  // refusing the run early is better than producing an undefined verdict.
  for (const seedKey of opts.seeds ?? def.seedSet) {
    const seed = await loadSeed(seedKey)
    if (!Number.isFinite(seed.chapterCount)) {
      throw new Error(`eval-tests: seed '${seedKey}' has no finite chapterCount; v1 suites require it for G4 evaluation`)
    }
  }

  // ... orchestration: build resolved_snapshot (incl. per-seed chapter_count),
  //     insert test_runs row, fan out cells, spawn child per (seed × variant),
  //     collect outputs, run metric impls, build cellsByVariant +
  //     metricsByVariant, evaluate gates per-(run, seed), write verdict.
}

export async function getRunResults(runId: number): Promise<TestRunResults> { ... }
```

Gate evaluators live in `src/harness/eval-test-gates.ts` as a registry. **R3 blocker 1 fix: signature is variant-keyed.** `runSuite()` calls each evaluator ONCE PER (run, seed), passing a `cellsByVariant` map and a `metricsByVariant` map (both keyed by variant label). Output is the per-(run, seed) verdict.

```ts
type CellState = { phase_result_kind: string | null; outline_parse_ok: boolean | null;
                   outline_count: number | null; seed_key: string }
type MetricByVariant = Record<string, number>   // { default: 5, loud: 8 }
type GateInputs = {
  cellsByVariant: Record<string, CellState>     // { default: <cell>, loud: <cell> }
  run: { resolved_snapshot: any }                // for expected_chapter_count
  metricsByVariant: Record<string, MetricByVariant>   // { facts_median: { default, loud }, ... }
  thresholds: Record<string, number>
}

export const GATE_EVALUATORS = {
  'phase-variant-screen-v1': ({ cellsByVariant, run, metricsByVariant, thresholds }: GateInputs) => {
    // R3 blocker 1 fix: G4 binds EXPLICITLY to cellsByVariant.loud
    // (the rider-targeting variant). The default cell's structural
    // validity is reported in run-level telemetry but does NOT gate
    // the verdict — phase-variant-comparison.md §"Decision criteria"
    // makes G4 loud-specific.
    const loudCell = cellsByVariant.loud
    const expected = run.resolved_snapshot.per_seed[loudCell.seed_key].chapter_count
    const G4 = loudCell.phase_result_kind === 'complete'
            && loudCell.outline_parse_ok === true
            && loudCell.outline_count === expected

    // G1/G2/G3: inter-variant ratios + floors. Read loud's metric value
    // and ratio against default's metric value. Both must be present
    // (asserted at runSuite() entry).
    const G1 = metricsByVariant.facts_median.loud >= thresholds.facts_median_floor
            && metricsByVariant.facts_median.loud >= thresholds.facts_median_ratio * metricsByVariant.facts_median.default
    const G2 = metricsByVariant.know_median.loud >= thresholds.know_median_floor
            && metricsByVariant.know_median.loud >= thresholds.know_median_ratio * metricsByVariant.know_median.default
    const G3 = metricsByVariant.total_beats.loud >= thresholds.total_beats_ratio * metricsByVariant.total_beats.default

    // Ordered predicate table (verdict ordering belongs to evaluator
    // identity; a different ordering = a different evaluator id):
    if (!G4) return 'SCREEN-FAIL (broken)'
    if (!(G1 && G2 && G3)) return 'SCREEN-FAIL (non-compliant)'
    return 'SCREEN-PASS'
  },
}
```

Future suites with different verdict-table ORDERING add their own evaluator to this registry (per R2 suggestion 1 — verdict ordering belongs to the evaluator identity, not parameterized). Future suites with the same ordering but different thresholds reuse `phase-variant-screen-v1` with different `config_json.thresholds` values.

### What's NOT in the service layer (R3 — same as R2)

- `compareRuns()` — v2.
- `submitHumanRating()` — v2.
- LLM-judge orchestration — v2.
- Resume support — v2.
- `eval_results` composition — v2.

## 6. Migration of phase-variant-comparison (the v1 acceptance test)

Step-by-step:

1. Define the suite in code (`src/harness/suites/phase-variant-loud-rider-v2.ts`):
   ```ts
   import { defineSuite } from '../eval-tests'
   import { factsMedian, knowMedian, totalBeats } from '../metrics/phase-variant'

   defineSuite('phase-variant-loud-rider-v2', {
     variants: [
       { label: 'default', promptOverrides: { 'planning-beats': 'scripts/phase-eval/variants/planning-beats/default.md' } },
       { label: 'loud',    promptOverrides: { 'planning-beats': 'scripts/phase-eval/variants/planning-beats/loud.md' } },
     ],
     seedSet: ['fantasy-system-heretic'],
     // R3: integer metrics only. No tolerance specified → exact equality.
     metrics: [
       { name: 'facts_median', impl: factsMedian },        // moved from print-screen-verdict.ts
       { name: 'know_median',  impl: knowMedian },
       { name: 'total_beats',  impl: totalBeats },
     ],
     gates: {
       evaluator: 'phase-variant-screen-v1',
       thresholds: { facts_median_floor: 8, facts_median_ratio: 1.5, know_median_floor: 3, know_median_ratio: 1.5, total_beats_ratio: 1.10 },
     },
   })
   ```
   Bootstrap edge: `src/harness/suites/index.ts` imports this file. `scripts/eval-test/run.ts` calls `registerBuiltInSuites()` at startup, which UPSERTs the row in `test_suites` (with hash drift detection).
2. Run via CLI:
   ```sh
   bun scripts/eval-test/run.ts phase-variant-loud-rider-v2 --seed=fantasy-system-heretic
   ```
3. Compare verdict + metric values against the existing probe's known good 2026-04-29 run output (preserved in `docs/sessions/2026-04-29-phase-eval-probe.md`).
4. **Acceptance — exact numeric equality at declared scale (R3 W2 fix)**: `verdict='SCREEN-PASS'` AND `facts_median=8` AND `know_median=5` AND `total_beats=43`. The canonical numeric-parity rule for v1 is **exact equality at the metric's declared scale** (`NUMERIC(12,4)` for all v1 metrics). The 2026-04-29 known-good run was on a 3-chapter seed (odd), so all v1 metric values land on integer boundaries — but this is incidental, not a general rule. Future seeds with even chapter counts produce halves (`facts_median = 7.5` is valid); the equality rule still holds at NUMERIC scale.

If acceptance passes, the bespoke `scripts/phase-eval/probe-planning-beats.ts` + `print-screen-verdict.ts` files are KEPT in place with a docstring header pointing to the new module (`src/harness/suites/phase-variant-loud-rider-v2.ts`). Per Codex R2 suggestion 5, docstring redirect is sufficient — no `archive/` move needed for v1.

**Required CI guard (R3 W4 fix)**: `tests/eval-test-parity.test.ts` runs both the old probe and the new module against `fantasy-system-heretic` and asserts equal verdict + equal numeric metrics at NUMERIC(12,4) scale. **REQUIRED at PR time** (was "optional" in R3 — the module's stated purpose is "same verdict on same input," and this subsystem already saw spec/implementation drift in R3's own pseudocode; an optional parity test is too weak). Cost: ~2× one probe run = ~$0.20 per CI invocation. Acceptable for PR-level CI; nightly is a fallback if PR cost is unacceptable.

## 7. v1 implementation slices (R3 — M1 cut)

| Slice | Files | Effort | Acceptance |
|---|---|---|---|
| M0 | `sql/033_eval_testing_module.sql` (4 tables, includes `config_hash` + `last_config_hash_change_commit` on `test_suites`) | ~1h | 4 tables created on local + LXC; canonical `expected_chapter_count` derivation from `resolved_snapshot.per_seed.<seed_key>.chapter_count` documented in migration comment. |
| M2 | `src/harness/eval-tests.ts` (registry + `runSuite()` orchestration + `registerBuiltInSuites()` write-through) + `src/harness/eval-test-gates.ts` (`phase-variant-screen-v1` evaluator with full G4 semantics) | ~1d | `runSuite()` callable in unit test against a fixture. `assertBootstrapped()` errors loudly when `registerBuiltInSuites()` not called. Gate evaluator unit-tested against synthetic SCREEN-PASS, SCREEN-FAIL (broken), SCREEN-FAIL (non-compliant) inputs. |
| M3 | `scripts/eval-test/run.ts` (calls `registerBuiltInSuites()` at startup) + `run-variant.ts` (child process, sets `PLANNING_BEATS_PROMPT_OVERRIDE`, writes cell-status JSON for parent) | ~0.5d | CLI runs end-to-end on `fantasy-system-heretic`; persists rows in 4 tables (`test_runs` + `test_run_cells` + `test_metric_results` + experiment row). |
| M4 | Suite file: `src/harness/suites/phase-variant-loud-rider-v2.ts` (calls `defineSuite()`) + `src/harness/suites/index.ts` (re-exports) | ~0.5d | Suite resolves at module load; metrics + gates wired. `defineSuite()` UPSERTs the row in `test_suites` with current `config_hash`. |
| M5 | Acceptance run + parity proof | ~0.5d | New module's verdict EXACTLY EQUALS the 2026-04-29 known-good probe output: `verdict='SCREEN-PASS'`, `facts_median=8`, `know_median=5`, `total_beats=43`. Integer metrics → exact equality. |

**Total v1: ~3 working days.** R3 cut M1 (`_loader.ts` deferred to v2 — R2 warning 1 fix). 5 slices instead of 6.

(R1 had M0–M6 = 5 days; R2 had M0–M5 = 3.5 days; R3 = ~3 days.)

## 8. v2 roadmap (NOT in this design — explicit non-scope)

Each v2 item has named open questions that v1 doesn't pretend to answer:

- **Second agent migration** (e.g., chapter-plan-checker). Open: how does the shared `loadPrompt()` helper extend to agents with non-uniform prompt-loading patterns (`writer`'s primer composition, `halluc-*`'s `readFileSync`)? Likely needs a small per-agent shim in addition to the helper.
- **UI** (`/app/eval-tests/<runId>/...` cross-novel diff page + leaderboard). Open: does the existing `NovelReadView` paragraph-aligned diff renderer survive cross-variant alignment when paragraph counts differ materially? Existing tonal-pass already tolerates this; verify on a real cross-novel run before designing the UI.
- **Human-rating widget**. Open: rubric definition shape (suite-level config? per-metric? per-rater?). Inter-rater κ implementation.
- **LLM-judge integration**. Open: per-judge prompt registration (`src/agents/judges/<rubric-id>/`?). Telemetry plumbing so judge calls land with the right `agent` and `phase` fields in `llm_calls`.
- **`eval_results` composition** via artifact-set abstraction. Open: is the right shape a join table (`test_metric_results_artifact_sets` join), a structured ref keyed by `(experiment_id, set_name, cell_label)`, or something simpler?
- **Autonomous-context-loop integration**. Open: does the loop want per-iteration parameter vectors stored as `test_runs.resolved_snapshot` rows it walks, or does it want a separate `loop_iterations` table that joins to `test_runs`?

Each of these gets its own design doc that cites this v1. Don't pre-design them now — Codex R1's refrain across 5 issues was "stop generalizing before one concrete use lands."

## 9. Constraints + non-goals (R3)

1. **One precedent in v1.** Planning-beats screen migration only. No second migration before v1 ships.
2. **Code is the single source of truth.** Suite definitions live in code (`src/harness/suites/<id>.ts`). `test_suites` is a write-through mirror with `config_hash`. `runSuite()` reads from the in-memory registry, never from the DB row. Codex R2 blocker 2 fix.
3. **No multi-novel `variant_novel_ids` JSONB.** `test_run_cells` is the per-cell normalized table. Codex R1 issue 2.
4. **No `eval_results` composition pointer.** v2. Codex R1 issue 3.
5. **No agent module touched in v1.** Existing `planning-beats/index.ts` env-var seam stays as-is. `_loader.ts` is v2 (R2 warning 1 fix). Codex R1 issue 4 also satisfied: no broad codegen.
6. **First-class runner state with full G4 spec.** G4 := `phase_result_kind = 'complete' AND outline_parse_ok = TRUE AND outline_count = expected_chapter_count`, where `expected_chapter_count` is sourced from `resolved_snapshot.per_seed.<seed_key>.chapter_count` captured at `runSuite()` entry. Codex R1 issue 5 + R2 blocker 1 fix.
7. **Numeric parity is exact integer equality** in v1. Non-integer metrics declare per-metric tolerance at definition time. Codex R2 warning 2 fix.
8. **Bootstrap is explicit.** `registerBuiltInSuites()` is called by `scripts/eval-test/run.ts` at startup. `assertBootstrapped()` errors loudly if `runSuite()` is called before. Codex R2 warning 3 fix.
9. **No UI in v1.** Codex R1 warning 4.
10. **No "any harness experiment" claim.** Codex R1 warning 5: this module is for full-pipeline variant comparisons of the phase-variant-screen shape.
11. **`resolved_snapshot` is additive-tolerant.** v1 readers MUST tolerate unknown fields. Codex R2 suggestion 4. v2 introduces `snapshot_version` if a non-additive shape change is needed.
12. **Atomic commits per CLAUDE.md rule 5.** Each M-slice = one commit.
13. **MVP is parity-grade, not exhaustive.** The acceptance test is "same verdict on same input." Skip everything that doesn't directly support that test.

## 10. Budget (R3 — M1 cut)

### Implementation cost

- M0 (4-table migration with `config_hash` + `last_config_hash_change_commit`): ~1h.
- M2 (service layer + gate evaluator with full G4 semantics + bootstrap helper): ~1d.
- M3 (CLI runner + child variant + `registerBuiltInSuites()` call): ~0.5d.
- M4 (suite file + `suites/index.ts` bootstrap edge): ~0.5d.
- M5 (acceptance + exact-equality parity proof): ~0.5d.

**v1 total: ~3 working days. ~1 week calendar.** R3 cut M1 (`_loader.ts` deferred to v2).

### Runtime cost

The module is zero-cost orchestration. v1's only suite is the existing planning-beats screen which costs ~$0.10/run. v2 suites budget themselves.

### Risk surface

- **Parity proof might reveal silent drift between bespoke and module verdict logic.** Mitigation: M5's acceptance test compares numeric values + verdict against the 2026-04-29 known-good output, recorded in `docs/sessions/2026-04-29-phase-eval-probe.md`. Discrepancies block M5 acceptance; resolve before declaring v1 done.
- **The phase-variant probe scripts already drifted from their charter.** Codex R1 warning 6: the shipped probe uses argv + one env var, the chartered version describes a "larger env-var bundle." v1 picks the shipped shape as authoritative; the charter is updated post-v1 with a note that the shipped contract is the source of truth.
- **`test_runs.resolved_snapshot` JSONB grows unbounded as future suites get larger.** Mitigation: v1 has 1 suite with ~2 variants × 1 seed × 3 metrics. Snapshot rows are KB-scale. v2 with multi-seed × multi-variant × multi-metric needs a size budget but that's v2's concern.
- **Code registry diverges from DB suite_id over time.** Mitigation: `runSuite()` errors loudly on a `suite_id` not in the registry. CI test asserts every registered suite has a corresponding `test_suites` row + vice versa.

## 11. Linked context

- `docs/eval-infrastructure.md` — existing per-beat eval surface; v2 composition target only.
- `docs/designs/phase-variant-comparison.md` — the precedent v1 migrates. Specifically R5's verdict computation (§"Decision criteria") is the parity target for `phase-variant-screen-v1` gate evaluator.
- `scripts/phase-eval/{probe-planning-beats,run-variant,print-screen-verdict}.ts` — the bespoke scripts v1 makes durable. NOT deleted; kept as parity reference.
- `scripts/variant/clone-for-variant.ts` — concept-done clone helper v1 reuses unchanged.
- `src/agents/planning-beats/index.ts:6-8` — the env-var seam pattern v1 generalizes via `_loader.ts`.
- `src/harness/index.ts` — service-layer entry point v1 extends with `eval-tests`.
- `sql/024_eval_briefs_and_results.sql` — existing tables v1 does NOT touch; v2 composes.
- `docs/designs/autonomous-context-loop.md` — sibling subsystem; v1 lays the immutable-snapshot foundation that v2 will integrate.
- `docs/todo.md` "Three-bucket forward plan" — v1 is Bucket 2.
- `docs/charters/corpus-structural-decomposition-v1.md` — sibling Bucket 1 charter; v1 explicitly does NOT compose with corpus-decomp output.

## 12. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R1 RED** | `aff15da9fb18060ec` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R2 RED (ITERATE)** | `a5219c7acd0f457fb` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R3 RED (ITERATE)** | `a8d5abb7dd78315fd` |
| (R4 pending) | (pending) | (pending) | (pending) |

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
> CHEAPEST UNTRIED COUNTERFACTUAL: Keep SQL persistence, a tiny `runSuite()` orchestrator, and the existing `planning-beats` child-process seam, but scope v1 to one precedent only: migrate the current planning-beats screen, persist its metrics and verdict, and stop there. Cut broad M3 codegen, cut M4/M5 UI, cut human ratings, and cut generic `eval_results` composition.
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

R4 integrates the R3 blocker + all 4 warnings + both suggestions. Submit R4 to Codex for follow-up review before implementation begins.

R4 attack surfaces for Codex:

- **Variant-keyed gate evaluator signature.** R4 §5 changed signature to `(cellsByVariant, run, metricsByVariant, thresholds)`. Verify G4 binds correctly to `cellsByVariant.loud` for the phase-variant-screen-v1 evaluator and is NOT also reading default's runner state implicitly. Are there race conditions when one variant's cell has crashed (no `loud` cell exists; G4 evaluator should return `SCREEN-FAIL (broken)` cleanly).
- **`runSuite()` chapterCount fail-fast.** R4 §5 added preflight that throws if any selected seed has non-finite `chapterCount`. Are there seeds that legitimately don't have one but should still be runnable in v1? Should `--chapter-count=N` CLI override be supported in v1, or is "use a different seed" sufficient?
- **`canonicalizeSuiteConfig()` shape.** R4 §5 spells out the canonical config: `{variants[label, promptOverrides], seedSet[], metrics[name, tolerance], gates[evaluator, thresholds]}`. `MetricFn` references survive only by `name`. Is this enough, or does the hash need to capture more (e.g., the metric registry's commit SHA at register time)?
- **`ensureBootstrapped()` helper.** R4 §5 added it for non-CLI callers. Is it idempotent under concurrent calls (e.g., two unit tests racing to bootstrap)? Should it be wrapped in a mutex?
- **Numeric-parity wording.** R4 §0/§6 changed to "exact numeric equality at the metric's declared scale" (NUMERIC(12,4)). Verify `Bun.sql` round-trips NUMERIC(12,4) without IEEE 754 precision loss. If it does, is the right fix to compare via SQL `=` operator (server-side comparison) rather than reading both values into JS and comparing?
- **CI parity test promotion to required.** R4 §6 says PR-level CI runs `tests/eval-test-parity.test.ts`. Cost ~$0.20 per PR. Is that acceptable, or should we use the CI nightly window instead? Check the existing CI cost budget if known.
- **Mirror/bootstrap consistency sweep.** R4 swept §2 (lines 80, 89), §3 (`last_registered_commit` → `last_config_hash_change_commit`), §5 (`registerBuiltInSuites()` is the sole writer). Verify no remaining contradictions. Particularly check whether `_loader.ts` is fully gone from §0/§2/§7.
- **`last_config_hash_change_commit` semantics.** R4 column comment says "captures commit at hash change for forensics; does NOT update on no-op registration." Is the commit captured BEFORE or AFTER the schema change in the same commit? Edge case: commit A registers suite; commit B is a no-op refactor; commit C changes the suite. Does the column point to A or C?
- **R4 budget reality.** R4 added ~1h for the variant-keyed gate-input patch + parity-test scaffold. Is this realistic, or is the gate evaluator change actually larger (touches metric collection + runSuite() orchestration too)?
