---
status: draft (pending Codex adversarial review)
kind: subsystem-design
name: eval-testing-module-v1
owner: andre
date: 2026-04-29
revision: 1
parent-context: docs/todo.md "Three-bucket forward plan", docs/eval-infrastructure.md, docs/charters/corpus-structural-decomposition-v1.md (sibling — Bucket 1)
related:
  - docs/eval-infrastructure.md (existing eval_briefs/eval_results layer this design extends)
  - docs/designs/phase-variant-comparison.md (one-off precedent this generalizes)
  - scripts/phase-eval/ (the bespoke scripts being replaced)
  - sql/024_eval_briefs_and_results.sql (existing tables this design composes with)
  - ui/src/components/NovelReadView.tsx:325-360 (paragraph-aligned diff renderer being generalized)
---

# Durable Eval / Testing Module — Design Sketch (Revision 1)

## 0. Tl;dr

The harness produces lots of one-off A/B comparisons (phase-eval probe, tonal-pass before/after, four-arm voice-shaping ablation, conditioning-floor cross-judge run, archetype-pass POC, …). Each one re-implements the same pipeline: pick variant configs → run them → store outputs somewhere → render a comparison → make a decision. We rebuild that pipeline every time. This design extracts that pipeline into a **durable subsystem**: one set of tables, one service-layer module, one variant runner generalized across agents, one side-by-side UI generalized across content shapes.

The module's job is to make the question *"does intervention X measurably move metric Y on seed set Z?"* a 5-minute setup instead of a 2-day script-write. It composes with existing infrastructure (`eval_briefs`, `eval_results`, `tuning_experiments`, `llm_calls`, `pipeline_events`) — no replacement, only augmentation.

This is **not a charter** — no falsifiable hypothesis. It's a subsystem spec. The MVP scope is callable from `bun scripts/eval-test/run.ts <suite> <variants>`; the full scope adds a Studio-style web UI.

## 1. Goal

Provide a single, reusable shape for any harness-improvement experiment that asks:

> Given a set of variants V, a fixed seed set S, and a metric set M, run every (v, s) pair, store outputs durably, render side-by-side for human + LLM review, and emit a verdict.

**MVP scope**: tables + service layer + CLI runner + minimal UI (extends Studio's existing diff renderer to "novel A vs novel B" cross-run comparison). ~1 week implementation.

**Full scope (post-MVP)**: human-rating widget with rubric-driven scoring, LLM-judge integration with calibrated prompts, suite registry browseable in the Studio, autosave of partial runs for resume. ~1–2 weeks total.

**Out of scope**: any specific metric implementation (those land per-charter — corpus-distribution metrics, voice-shape distance, character-distinctness, etc.). The module is the *envelope*; metrics are pluggable.

## 2. Scope

### In scope

- **Tables** (new):
  - `test_suites` — reusable named bundles of (variant configs, seed set, metric set, optional human-rating rubric).
  - `test_runs` — one row per *execution* of a suite (joins to `tuning_experiments.id`, captures git commit, status, started/completed timestamps).
  - `test_metric_results` — per-(run, variant, seed, metric) row. Stores numeric value + raw artifact pointer (e.g., `chapter_outlines.id` or `llm_calls.id` or `chapter_drafts.id`).
  - `test_human_ratings` — per-(run, variant, seed, rater) row. For human eyeballing of prose quality.
- **Service layer module** at `src/harness/eval-tests.ts`:
  - `defineSuite({ name, variants, seedSet, metrics, humanRatingRubric? }) → TestSuite`
  - `runSuite(suiteName, opts?) → TestRunId`
  - `getRunResults(runId) → { variant, seed, metric → value, artifactRef }[]`
  - `compareRuns(runIdA, runIdB, suiteName) → SideBySideRows[]`
  - `submitHumanRating(runId, variant, seed, rater, scores)`
- **Generalized variant runner** at `scripts/eval-test/run-variant.ts`:
  - Per-agent prompt-override seam (extends the `PLANNING_BEATS_PROMPT_OVERRIDE` env-var pattern — see §4 below).
  - Configurable phase-stop point (`--stop-after=concept|planning|drafting:ch3`).
  - Spawned per variant in a child process (module-level prompt-cache hazard already established in `phase-variant-comparison.md`).
- **Side-by-side compare UI** under `/app/eval-tests`:
  - Generalize the existing `NovelReadView.tsx` `viewMode="diff"` paragraph-aligned diff renderer from "novel original vs tonal" to "novel A (variant V1) vs novel B (variant V2)".
  - Per-metric comparison table at top of page (variant V1 metric X = …, variant V2 metric X = …).
  - For non-prose artifacts (chapter outlines, briefs, world bibles), a JSON-diff renderer with collapsible nesting.
- **Human-rating widget** (full-scope only):
  - Loads a suite's `humanRatingRubric` (e.g., `{ adherence: 1-5, voice_match: 1-5, prose_quality: 1-5, notes: text }`).
  - Per-(variant, seed) pane with side-by-side prose + rating form.
  - Inter-rater agreement metric across raters (κ statistic) on suite results page.
- **CLI runner** at `scripts/eval-test/run.ts`:
  - `bun scripts/eval-test/run.ts <suite-name> [--variants=v1,v2] [--seeds=s1,s2] [--keep-novels] [--exp-id=<id>]`
  - Emits the same SCREEN-PASS / SCREEN-FAIL verdict shape per suite if the suite defines verdict gates (charter-style).
  - Runs to completion or resumes via `--resume-run=<runId>`.

### Out of scope

- **Specific metrics.** Any metric a charter defines (e.g., `voice-shape-distance`, `MICE-balance`, `facts-per-beat-median`) lands as a metric-fn in that charter's PR. The module exposes a `Metric` interface; charters supply implementations.
- **Bucket 1 corpus tagging.** That charter (`docs/charters/corpus-structural-decomposition-v1.md`) is read-only over `novels/<key>/` files; it has its own pipeline (`scripts/corpus/`) and does NOT use this module's `test_runs` shape. Different problem domain.
- **Bucket 3 pipeline refactors.** Each refactor charter MAY use this module to score itself, but the module doesn't ship any refactor.
- **Automatic LLM-judge calibration.** The module exposes a `judge` metric type but doesn't ship calibrated judges. Memory `feedback_engineering_frame_for_novel_writing` + `decisions.md` "1-10 judges showed 0-33% discrimination" — judge calibration is a per-question problem, not a generic infrastructure problem.
- **Anything beyond planner / writer / checker phases.** The module orchestrates harness pipeline runs; it doesn't do orthogonal data manipulation.
- **Replacing `eval_briefs` / `eval_results`.** Those tables remain authoritative for Phase C.3-style brief-set evals (single-shot per-beat generation, no full-pipeline run). The new tables are for full-pipeline variant comparisons. They share a foreign-key seam: a `test_metric_results` row CAN reference an `eval_results` row when the metric was computed by re-running the brief set.

## 3. Data model

```sql
-- New: sql/033_eval_testing_module.sql

CREATE TABLE IF NOT EXISTS test_suites (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  -- JSON-serialized definition; loaded by service layer at runSuite() time.
  -- Shape: { variants: [{label, agent, promptOverridePath, ...}],
  --          seedSet: [seedKey, ...],
  --          metrics: [{name, kind: "deterministic"|"llm-judge"|"artifact-ref", impl?}],
  --          humanRatingRubric?: {fields: [{name, kind, range}]},
  --          verdictGates?: [{order, predicate, label}] }
  definition_json   JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id                SERIAL PRIMARY KEY,
  suite_id          INT NOT NULL REFERENCES test_suites(id),
  experiment_id     INT REFERENCES tuning_experiments(id),
  git_commit        TEXT,                               -- captured at runSuite() entry
  status            TEXT NOT NULL,                      -- 'running' | 'complete' | 'failed' | 'cancelled'
  -- Per-variant novel ids (post-clone). Useful for re-rendering UI without re-running.
  variant_novel_ids JSONB,                              -- {variant_label: novel_id, ...}
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  verdict           TEXT,                               -- 'SCREEN-PASS' | 'SCREEN-FAIL (...)' | NULL
  notes             TEXT
);
CREATE INDEX idx_test_runs_suite ON test_runs(suite_id);
CREATE INDEX idx_test_runs_exp ON test_runs(experiment_id);

CREATE TABLE IF NOT EXISTS test_metric_results (
  id                SERIAL PRIMARY KEY,
  run_id            INT NOT NULL REFERENCES test_runs(id),
  variant_label     TEXT NOT NULL,                      -- matches test_suites.definition_json.variants[].label
  seed_key          TEXT NOT NULL,                      -- e.g. 'fantasy-system-heretic'
  metric_name       TEXT NOT NULL,                      -- matches definition_json.metrics[].name
  numeric_value     NUMERIC(12,4),                      -- the headline number
  -- Pointer to the artifact the metric was computed from. Kind-tagged so the
  -- UI knows where to fetch the displayable form. Three kinds:
  --   {kind: "chapter_outlines", id: <int>}
  --   {kind: "chapter_drafts", id: <int>}
  --   {kind: "llm_calls", id: <int>}
  --   {kind: "eval_results", id: <int>}      -- when reusing the per-beat eval surface
  artifact_ref      JSONB,
  raw_value         JSONB,                              -- structured detail (e.g., {facts_median: 8, breakdown: [...]})
  error_text        TEXT,                               -- populated on metric-fn error
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, variant_label, seed_key, metric_name)
);
CREATE INDEX idx_test_metric_run ON test_metric_results(run_id);

CREATE TABLE IF NOT EXISTS test_human_ratings (
  id                SERIAL PRIMARY KEY,
  run_id            INT NOT NULL REFERENCES test_runs(id),
  variant_label     TEXT NOT NULL,
  seed_key          TEXT NOT NULL,
  rater             TEXT NOT NULL,                      -- 'andre' | 'sonnet-4-6' | 'codex-gpt-5.5' | ...
  scores            JSONB NOT NULL,                     -- shape mirrors humanRatingRubric.fields
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, variant_label, seed_key, rater)
);
CREATE INDEX idx_test_ratings_run ON test_human_ratings(run_id);
```

### Why these tables, not a single big one

`test_suites` is the reusable definition; `test_runs` is the execution; `test_metric_results` is the cell-level scoring; `test_human_ratings` is the rubric-driven human/LLM eyeballing. Splitting them lets us:
- Re-run a suite without rewriting the suite definition.
- Add new raters to an existing run without migrating data.
- Compose UI views: leaderboard (cross-run cross-variant), single-run drilldown, single-cell prose-pair side-by-side.

### Why `artifact_ref` instead of inlining content

Prose artifacts are big (~10–20 KB per chapter draft). Foreign-key references to `chapter_drafts` / `chapter_outlines` / `llm_calls` keep `test_metric_results` lean and let the UI lazy-fetch by reference at view time. `raw_value` carries the structured detail (e.g., a per-chapter breakdown of where the metric came from) without duplicating the prose.

### Why NOT replace `eval_briefs` / `eval_results`

`eval_briefs` is "synthetic brief sets the harness was never asked to plan or fact-check"; `eval_results` is "single-shot generation of prose against one of those briefs." This module is "full-pipeline variant comparison." Different problem. The two layers compose: a suite metric named `voice-shape-distance` MAY be implemented by re-running the existing Phase-C.3-style eval against the variant's writer, in which case `test_metric_results.artifact_ref = {kind: "eval_results", id: <id>}` and the UI knows to render the brief-set comparison. But the module doesn't *require* eval_briefs — a suite metric like `MICE-balance-cv` operates on planner output and never touches the brief-set surface.

## 4. Generalized variant runner

The phase-eval probe established a working pattern: env-var seam at module load, child-process per variant for isolation. Generalize that across agents.

### Per-agent prompt-override seam

Today, only `src/agents/planning-beats/index.ts` reads from `PLANNING_BEATS_PROMPT_OVERRIDE`. The same shape applied to every agent that exports `prompt`:

```ts
// src/agents/<name>/index.ts — repeat per agent
const defaultPath = new URL("<filename>.md", import.meta.url).pathname
const overridePath = process.env.<AGENT_NAME>_PROMPT_OVERRIDE?.trim()
const promptPath = overridePath && overridePath.length > 0 ? overridePath : defaultPath
export const prompt = await Bun.file(promptPath).text()
```

This is rote. The module ships a `scripts/eval-test/codegen-overrides.ts` script that walks `src/agents/*/index.ts` and rewrites top-level prompt awaits to the override-tolerant shape. Run-once-per-PR-touching-an-agent.

**Alternative considered**: a single env var `AGENT_PROMPT_OVERRIDES_JSON` with `{ "planning-beats": "/path/to/prompt.md", "world-builder": "/path/to/other.md" }`. Rejected because parsing JSON at module load is brittle — typos silently fall back to default. Per-agent env vars are explicit and grep-able.

### Variant config

```ts
type VariantConfig = {
  label: string                         // 'default' | 'loud' | 'mice-budget-arm-A' | ...
  promptOverrides?: Record<string, string>   // { 'planning-beats': '/abs/path.md', ... }
  modelOverrides?: Record<string, string>    // { 'planner': 'deepseek-v4-pro', ... } — TBD whether MVP
  pipelineOverrides?: Partial<PipelineConfig> // qualityRedraftEnabled, etc.
  stopAfter?: 'concept' | 'planning' | `drafting:ch${number}` | 'validation'
}
```

The runner spawns one child process per variant with the override env vars set. Concept clone happens once per (suite, seed); each variant's child process clones from the concept-done snapshot via `clone-for-variant.ts --target-phase=concept-done`. Same shape as the phase-eval probe; just with the `--stop-after` flag generalized.

### Why child processes (still)

Established in `phase-variant-comparison.md` §"Why child processes" — module-level prompt cache + global `currentRunId` + global transport. ~200ms per spawn vs minutes of pipeline runtime is negligible. Add: `src/agents/*/index.ts` top-level awaits cache prompts at module load; switching agents' prompts mid-process means re-importing the agent module which is unsafe given the agent's downstream consumers (e.g., `phases/planning.ts` imports `planning-beats` once at module top).

## 5. Side-by-side compare UI

### MVP: extend `NovelReadView` to cross-novel diff

Today the diff view (`ui/src/components/NovelReadView.tsx:325-360`) compares one novel's `original` vs `tonal-pass` chapter pairs paragraph-by-paragraph. Generalize:

1. New route: `/app/eval-tests/<runId>/<variantA>-vs-<variantB>/<seedKey>`.
2. Page loads the run's `variant_novel_ids` map, picks novel A (variant V1) and novel B (variant V2) for `seedKey`, then reuses the existing `getAllChapters(novelA)` + `getAllChapters(novelB)` calls.
3. Same paragraph-pair `Array.from({ length: diffLen })` loop; same `diff-para` / `diff-pair` / `removed` / `added` CSS classes. Only the data source changes.
4. Header strip shows the metric table for this (variant, seed) pair: rows = metric, columns = variantA score | variantB score.

**The diff renderer is already paragraph-aligned by index.** Two novels written from the same seed produce the same chapter count + similar paragraph counts; alignment-by-index gives a useful (not perfect) visual diff. Cases where alignment drifts (one variant adds an extra paragraph in chapter 2) are flagged by the existing `removed` / `added` styling — same UX as tonal vs original.

### MVP: outline-level diff for non-prose artifacts

Many comparisons happen at the planner level (chapter_outlines, story_spines). The MVP renders a JSON-diff view using a small dependency (`json-diff-react` or hand-rolled): two columns, key-by-key, shared keys un-highlighted, divergent keys + added/removed keys highlighted. Reuses the same `removed` / `added` CSS classes.

### MVP: metric leaderboard page

`/app/eval-tests/<runId>` — table:

| variant | seed | metric_1 | metric_2 | metric_3 | … | drilldown |
|---|---|---|---|---|---|---|
| default | system-heretic | 8 | 5 | 30 | … | [outlines / drafts] |
| loud | system-heretic | 12 | 7 | 33 | … | [outlines / drafts] |

Per-cell drilldown opens the artifact viewer (`outlines` → JSON-diff vs default; `drafts` → cross-novel paragraph diff). Highlights cells where the diff between variants exceeds a threshold (suite-defined, defaults to 1.5× ratio).

### Full-scope: human-rating widget

`/app/eval-tests/<runId>/rate?variant=loud&seed=system-heretic` — split-pane:

- Left pane: variant prose (read-only).
- Right pane: rubric form. Suite definition specifies the rubric shape:
  ```ts
  humanRatingRubric: {
    fields: [
      { name: 'adherence', kind: 'likert', range: [1, 5], help: 'Did the prose match the beat brief?' },
      { name: 'voice_match', kind: 'likert', range: [1, 5], help: 'Does it sound like Salvatore?' },
      { name: 'prose_quality', kind: 'likert', range: [1, 5] },
      { name: 'notes', kind: 'text' },
    ]
  }
  ```
- Submit writes a `test_human_ratings` row.
- "Rate next" navigates to the next un-rated (variant, seed) cell in the run.
- Optional second-rater view: queue cells where the user is the second rater on a previously-rated cell, supporting κ-statistic computation.

The widget is generic over rubric. Different suites can have different rubrics — corpus-decomp validation might use binary "MICE-tag-correct?" labels; voice-shaping ablation might use a 5-axis prose rubric.

### Full-scope: LLM-judge integration

Rater field in `test_human_ratings.rater` accepts `'sonnet-4-6'` / `'codex-gpt-5.5'` / etc. A small `scripts/eval-test/run-llm-judge.ts` driver loads a suite, walks all (variant, seed) cells, prompts the named judge with the rubric, persists the rating. Inter-rater κ between human and LLM judges is the calibration signal. Memory `feedback_sparing_regex_scorer` + `decisions.md` "1-10 judges showed 0-33% discrimination" is the operating constraint: judges are useful as **second raters** for inter-rater agreement, not as primary ground truth. The module's job is to make adding/removing them mechanical.

## 6. Service layer API

```ts
// src/harness/eval-tests.ts

export type TestSuiteDefinition = {
  variants: VariantConfig[]
  seedSet: string[]
  metrics: MetricSpec[]
  humanRatingRubric?: RubricSpec
  verdictGates?: VerdictGate[]    // optional ordered predicate table for SCREEN-PASS verdict
}

export type MetricSpec = {
  name: string
  kind: 'deterministic' | 'llm-judge' | 'artifact-ref'
  impl: (ctx: MetricCtx) => Promise<MetricResult>   // pluggable per charter
}

export type MetricCtx = {
  novelId: string
  seedKey: string
  variant: VariantConfig
  // helpers: query chapter_outlines / chapter_drafts / etc.
  db: typeof Bun.sql
}

export type MetricResult = {
  numericValue?: number
  rawValue?: any
  artifactRef?: { kind: string; id: number }
  errorText?: string
}

export async function defineSuite(name: string, def: TestSuiteDefinition): Promise<TestSuite>
export async function runSuite(suiteName: string, opts?: RunOptions): Promise<TestRun>
export async function getRunResults(runId: number): Promise<TestRunResults>
export async function compareRuns(runIdA: number, runIdB: number): Promise<RunComparison>
export async function submitHumanRating(runId: number, variant: string, seed: string, rater: string, scores: any): Promise<void>
```

`runSuite` does the orchestration:
1. Load suite definition.
2. Open a `tuning_experiments` row of type `'ticket'` (per CLAUDE.md rule 1).
3. For each seed in seedSet:
   a. Run concept phase to completion (one shared concept-done state per seed).
   b. For each variant, clone-for-variant from concept-done snapshot.
   c. Spawn child process per variant with override env vars.
   d. After child completes, run all metric impls against the resulting state.
   e. Persist `test_metric_results` rows.
4. Apply verdict gates (if defined) → SCREEN-PASS / SCREEN-FAIL.
5. Conclude `tuning_experiments` row with verdict summary.
6. Return `TestRun`.

### Charter integration

A charter author writes a single file:
```ts
// docs/charters/<name>/suite.ts (example)
import { defineSuite } from '@/harness/eval-tests'
import { facts_median, know_median, total_beats } from './metrics'

export const suite = defineSuite('phase-variant-loud-rider-v2', {
  variants: [
    { label: 'default', promptOverrides: {} },
    { label: 'loud', promptOverrides: { 'planning-beats': './variants/loud.md' } },
    { label: 'rider-A-only', promptOverrides: { 'planning-beats': './variants/rider-A.md' } },
    // ...
  ],
  seedSet: ['fantasy-system-heretic', 'fantasy-mc-rises', 'litrpg-dungeon-runner'],
  metrics: [
    { name: 'facts_median', kind: 'deterministic', impl: facts_median },
    { name: 'know_median', kind: 'deterministic', impl: know_median },
    { name: 'total_beats', kind: 'deterministic', impl: total_beats },
  ],
  verdictGates: [
    { order: 1, label: 'SCREEN-FAIL (broken)', predicate: 'NOT G4' },
    { order: 2, label: 'SCREEN-FAIL (non-compliant)', predicate: 'NOT (G1 AND G2 AND G3)' },
    { order: 3, label: 'SCREEN-PASS', predicate: 'G1 AND G2 AND G3 AND G4' },
  ],
})
```

CLI invocation:
```sh
bun scripts/eval-test/run.ts phase-variant-loud-rider-v2
```

Replaces the bespoke `scripts/phase-eval/probe-planning-beats.ts` + `print-screen-verdict.ts` shape.

## 7. Migration of existing eval surfaces

The module is **additive**, not a replacement. Existing eval surfaces stay where they are; new charter work uses the module.

| Existing surface | Stays | Reason |
|---|---|---|
| `eval_briefs` / `eval_results` (Phase C.3) | YES | Single-shot brief-set evals are a different shape (no full pipeline). Module composes via `artifact_ref`. |
| `tuning_experiments` | YES | Module's `test_runs.experiment_id` joins to it. Authoritative for project-wide experiment lineage. |
| `llm_calls` | YES | Per-call telemetry is orthogonal. |
| `pipeline_events` | YES | Per-novel timeline is orthogonal. |
| `scripts/phase-eval/` | DEPRECATE after MVP | Bespoke replacement of `probe-planning-beats.ts` exists; keep the old script as an archived reference. |
| `scripts/variant/clone-for-variant.ts` | YES (extend) | Module reuses the `--target-phase=concept-done` flag; no rewrite. |
| `tonal-pass` paragraph-aligned diff in `NovelReadView` | EXTEND | Generalize from "novel original vs tonal" to "novel A vs novel B". UI logic shared. |

## 8. MVP vs full scope

### MVP (~1 week, ~1 working day per slice)

| Slice | Files | Acceptance |
|---|---|---|
| M0 | `sql/033_eval_testing_module.sql` | 4 tables created on local + LXC. |
| M1 | `src/harness/eval-tests.ts` (skeleton) | `defineSuite()`, `runSuite()`, `getRunResults()` callable; concept-clone-then-variant orchestration works for 1 variant + 1 seed + 1 metric. |
| M2 | `scripts/eval-test/run.ts` + `run-variant.ts` | CLI runs an example suite end-to-end; persists `test_metric_results` rows. |
| M3 | Per-agent prompt-override seam (codegen + apply) | All `src/agents/*/index.ts` accept `<NAME>_PROMPT_OVERRIDE` env var; default path byte-equal under unset. |
| M4 | UI route `/app/eval-tests/<runId>` (leaderboard) | Renders metric table for a complete run. |
| M5 | UI route `/app/eval-tests/<runId>/<vA>-vs-<vB>/<seed>` (cross-novel diff) | Reuses `NovelReadView` diff renderer; renders paragraph-aligned compare. |
| M6 | Migrate `phase-variant-comparison-r5` to suite shape | Existing screen runs through new module; verdict matches the bespoke script's verdict (no behavior change). |

### Full scope (additional ~1 week)

| Slice | Files | Acceptance |
|---|---|---|
| F1 | `test_human_ratings` table + service layer | `submitHumanRating()` callable; queries return κ-statistic across raters. |
| F2 | UI route `/app/eval-tests/<runId>/rate?variant=&seed=` | Rubric form renders from suite definition; persists ratings. |
| F3 | LLM-judge driver `scripts/eval-test/run-llm-judge.ts` | Walks suite cells; calls Sonnet/Codex with rubric; persists ratings. |
| F4 | Outline JSON-diff renderer | Cross-variant chapter_outlines diff readable in UI. |
| F5 | Suite registry browse page `/app/eval-tests` | Shows all defined suites + recent runs per suite. |
| F6 | Resume support | `--resume-run=<id>` re-runs only failed cells. |

## 9. Constraints + non-goals

1. **No metric implementations.** The module ships *zero* metrics. Every metric lands in a charter PR that imports `defineSuite`. This keeps metric drift contained per-charter, not module-wide.
2. **No silent overrides.** Per-agent env vars (`PLANNING_BEATS_PROMPT_OVERRIDE`, etc.) over a single JSON env var — typos silently falling back to default would mask SCREEN-PASS results that were actually default-config.
3. **Concept-phase shared per (suite, seed).** Concept is expensive (~$0.10–$0.30 per seed) and stable across variants that don't override concept agents. Concept runs once per (suite, seed); variants clone from `concept-done`. Charters that want to vary concept agents use `--stop-after=concept` with separate concept-phase suite runs (Bucket 3 territory).
4. **Single-pass MVP.** Resume is full-scope. MVP fails the run on any error and starts over. Acceptable because suites are small (typically 2–5 variants × 1–3 seeds) and a re-run is cheap.
5. **Atomic commits per CLAUDE.md rule 5.** Each MVP slice = one commit.
6. **Schema-of-record discipline.** New tables follow the audit pattern of `sql/024`: integer FK to `tuning_experiments`, JSONB for variable shapes, indexed on hot query paths.
7. **No replacement of existing scripts during MVP.** The old `phase-variant-comparison` scripts stay live until M6 confirms the suite-shape produces the same verdict on the same input.
8. **No autonomous-loop integration (yet).** The autonomous-context-loop design (`docs/designs/autonomous-context-loop.md`) is a separate subsystem. This module's `test_runs` shape *could* feed an autonomous-loop iteration history, but that integration is a separate doc.
9. **MVP is decision-grade, not exhaustive.** Skip features that don't change a Bucket 3 refactor decision: notifications, cross-suite analytics, suite-versioning, fine-grained ACLs.

## 10. Budget

### Implementation cost

- M0 (table migration): ~1h.
- M1 (service layer skeleton): ~1d.
- M2 (CLI runner): ~1d.
- M3 (per-agent prompt-override codegen): ~1d (12 agents × ~5min per agent + codegen script + verification).
- M4 (UI leaderboard): ~0.5d.
- M5 (UI diff page): ~0.5d.
- M6 (migrate phase-variant suite): ~0.5d.

**MVP total: ~5 working days. ~1 week calendar.**

Full-scope (F1–F6): additional ~5 days. Calendar 1–2 weeks total depending on whether full-scope ships in the same pass.

### Runtime cost

The module itself is zero-cost (orchestration only). Each suite *run* costs whatever its variants cost. Phase-variant-comparison r5 cost ~$0.10/run. A 5-variant × 3-seed × full-pipeline suite would cost ~$5–15 depending on novel length. Suite definitions own their own budget; the module surfaces total LLM cost per run via a `test_runs.notes` field auto-populated from joined `llm_calls.cost_usd`.

### Risk surface

- **Per-agent override seam codegen rewrites every agent module.** Risk: a typo in the codegen template breaks all agents. Mitigation: change-by-change PR; parity test (P0b shape from `phase-variant-comparison.md`) extends to a per-agent regression that asserts byte-equal default behavior after seam application. Run before merging M3.
- **Cross-novel paragraph diff renders confusingly when paragraph counts differ.** Already a problem with tonal-pass diff today; users tolerate it. Mitigation: chapter-level alignment first, then paragraph-level within chapter — already how `NovelReadView` works.
- **Suite definitions become an unmaintained graveyard.** Mitigation: tie suite definitions to a charter dir (`docs/charters/<name>/suite.ts`); suites without a live charter get archived. (Soft policy, not enforced by code.)
- **Module under-used because charters keep writing bespoke scripts.** Mitigation: M6 (migrating the existing phase-variant comparison) demonstrates the shape works; future charter reviews ask "could this be a suite?" by default.

## 11. Linked context

- `docs/eval-infrastructure.md` — existing eval_briefs/eval_results layer this design extends. Read before designing metric impls.
- `docs/designs/phase-variant-comparison.md` — the one-off precedent. M6 migrates this to the new module shape.
- `docs/charters/corpus-structural-decomposition-v1.md` — sibling Bucket-1 charter. Does NOT use this module (different problem); exists in parallel.
- `docs/todo.md` "Three-bucket forward plan" — this design is Bucket 2.
- `sql/024_eval_briefs_and_results.sql` — existing tables to compose with.
- `ui/src/components/NovelReadView.tsx:325-360` — paragraph-aligned diff renderer to generalize.
- `scripts/phase-eval/` — bespoke scripts to deprecate after M6.
- `scripts/variant/clone-for-variant.ts` — concept-done clone helper this design reuses.
- `src/agents/planning-beats/index.ts` — pattern for the per-agent prompt-override seam.
- `src/harness/index.ts` — service layer this design extends with `eval-tests.ts`.

## 12. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| (pending) | (pending) | (pending) | (pending) |

Submit to `codex:codex-rescue gpt-5.5 effort=high` (Codex `/codex:adversarial-review` is for experiment charters; this is a subsystem design). Specific attack surfaces to flag:

- Is the per-agent env-var seam the right shape, or does the module need a stronger contract (e.g., explicit `Phase<I,O>.runWithOverrides()` from the typed Phase contract that landed in P8)?
- Does the `test_metric_results.artifact_ref` shape force the UI to over-fetch when rendering leaderboards? Should there be a denormalized cache?
- Is "concept runs once per (suite, seed)" too restrictive? Some charters may want to vary concept agents per variant — what's the migration path when Bucket 3 surfaces that?
- Is `test_human_ratings.rater` as a free-form text field the right shape? Should there be a raters table for κ computation?
- Should the LLM-judge integration explicitly cite the module's calibration epistemology (judges as second raters, not primary ground truth) in the data model?
- Is the MVP scope too thin — does it ship enough to migrate one real charter (M6) without hitting hidden requirements?
- Is the MVP scope too thick — could a smaller surface (just tables + CLI + leaderboard, no diff UI) demonstrate the shape and accelerate Bucket 3 sooner?
- Have I undercounted the Studio-route integration cost? The Studio currently centers on novel creation; a `/app/eval-tests` namespace may need cross-page state I'm not budgeting for.
- Have I undercounted the per-agent codegen complexity given that some agents (writer, reference-resolver) have non-trivial top-of-file logic that the regex-replace approach might break?
