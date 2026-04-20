---
ticket: T7 — ticket-vs-experiment taxonomy cleanup
experiment: 250
status: planning
created: 2026-04-19
---

# Plan — Clarify ticket vs experiment taxonomy

## Goal
Document and encode the distinction between **tickets** (engineering work: feature, bug, refactor, docs) and **experiments** (measured work: SFT training, benchmark sweep, A/B). The `tuning_experiments` table has become a catch-all; clarify the naming without a disruptive schema migration.

## Non-goals
- No new DB table. `tuning_experiments` keeps all tracked work.
- No column rename on the existing table (stale queries would break).
- No backfill of past `experiment_type` values. Going forward only.
- No behavioral change to `createTuningExperiment` — just a typed union on the `type` parameter so future callers pick from a canonical set.

## Discovery notes
- `sql/003_harness_tables.sql:8` — `experiment_type TEXT NOT NULL`. No DB enum to extend.
- `src/db/ops.ts:787` — `createTuningExperiment(type: string, ...)`. Unconstrained string.
- Historical `experiment_type` values in DB (~30 distinct, audited via `SELECT DISTINCT experiment_type, COUNT(*) FROM tuning_experiments`): includes `sft_training`, `validation_sweep`, `charter`, `checker-eval`, `infrastructure`, `writer`, `perbeat-decomposition`, `teacher-comparison`, `training`, `validation`, `writer-model-probe`, `adherence-production-data`, `archetype-pass-poc`, `beat-architecture`, `eval`, `judge-calibration`, `lint-rewriter`, `lora-sft`, `message-order`, `methodology`, `model-ab`, `pipeline-config`, `planner-phase1-investigation`, `quality-vs-penalty`, `rewriter-precision`, `sft_eval`, `system-test`, `teacher_eval`, `temperature-sweep`, `voice-baked-beat-writer`, `voice_imprint_capability_vs_tuning`, `writer-model-default`. Naming is inconsistent (`checker-eval` vs `teacher_eval`, `sft_training` vs `lora-sft`).
- **Implication:** a strict named union would break `tsc` on dozens of legacy callers + disincentivize ad-hoc labels that are actually useful for discovery. Solution: **widened-literal union** pattern.

## Exit criteria
1. `src/db/ops.ts` — `createTuningExperiment`'s `type` parameter changed from `string` to a **widened-literal union** that recommends canonical values while tolerating any string:
   ```ts
   /**
    * Canonical work-type labels. The union uses the `(string & {})` tail
    * to preserve IDE autocomplete for the recommended set WITHOUT breaking
    * any legacy caller that uses an ad-hoc label (e.g., `"teacher-comparison"`,
    * `"temperature-sweep"`, `"judge-calibration"` — ~30 distinct historical
    * values in the DB).
    *
    * Pick from the canonical set when starting new work; only invent a new
    * label if no canonical type fits.
    */
   export type TrackedWorkType =
     | "ticket"                // DEFAULT — engineering ticket (feature / bugfix / refactor / docs)
     | "charter"               // multi-commit architectural effort with multiple Codex review rounds
     | "sft_training"          // LoRA / SFT training run
     | "validation_sweep"      // benchmark sweep with quantitative outcome
     | "checker_eval"          // checker / adapter quality eval
     | "infrastructure"        // infra migration, tooling, deploy work
     // Tail allows any string — all ~30 historical labels continue to
     // compile. Adding autocomplete hints for the canonical 6 is the
     // whole value delivered by this ticket.
     | (string & {})
   ```
2. CLAUDE.md Rule 1 updated from "Every experiment goes in the DB" to "Every tracked work item (experiment or ticket) goes in the DB via `createTuningExperiment`. Prefer the canonical `TrackedWorkType` values (`ticket` for standard engineering work, `charter` for multi-commit architectural efforts, `sft_training` / `validation_sweep` / `checker_eval` / `infrastructure` for measured/ops work). Ad-hoc labels are accepted but discouraged for new work — pick a canonical label so the DB stays queryable."
3. `.claude/skills/implement-ticket.md` Phase 0 — one paragraph: default to `ticket` for engineering work; reserve `charter` for multi-commit architectural efforts; use the ML-specific labels for training / benchmark work. Fix the stale `checker-eval` reference (line 46 today) to `checker_eval` to match the canonical set.
4. `docs/current-state.md` — one-line pointer to `TrackedWorkType` + a sentence distinguishing "tracked work" from "experiments-in-the-strict-sense."
5. `docs/todo.md` — note completed.
6. `bunx tsc --noEmit` — passes unchanged (26/26 baseline, zero new). The widened-literal tail (`(string & {})`) makes ALL existing callers still valid.
7. Preflight PASS.
8. Codex review verdict RESOLVED.

## File ownership slices

### Slice A — typed union + CLAUDE.md rule update (single subagent)
**Files:**
- EDIT `src/db/ops.ts`:
  - Add `export type TrackedWorkType = "sft_training" | "validation_sweep" | "checker_eval" | "infrastructure" | "charter" | "ticket"` above `createTuningExperiment`.
  - Change `createTuningExperiment(type: string, ...)` → `createTuningExperiment(type: TrackedWorkType, ...)`.
  - Add a 3-4 line docstring above the function: each type's meaning + when to pick it.
- EDIT `CLAUDE.md`:
  - Under "Rules," update Rule 1: "**Every tracked work item goes in the DB.** Use `harness.experiments.createTuningExperiment()` + `concludeExperiment()`. Pick the right `experiment_type`: `ticket` (default — feature / bugfix / refactor / docs), `charter` (multi-commit architectural effort), `sft_training` / `validation_sweep` / `checker_eval` (measured work), `infrastructure` (migrations + tooling)."
- EDIT `.claude/skills/implement-ticket.md` Phase 0:
  - Add one sentence after the existing "Phase 0 — Create tuning_experiment (MANDATORY)" header: "Default to `experiment_type="ticket"` for single-purpose engineering work. Use `charter` only for multi-commit architectural efforts that span multiple subsystems or Codex review rounds. See `src/db/ops.ts` `TrackedWorkType` for the full set."
  - Fix the stale `checker-eval` reference (hyphen) on the existing example list to `checker_eval` (underscore) so the skill doc teaches the canonical naming.
- EDIT `docs/current-state.md` — add a 2-line pointer to the taxonomy distinction in the "Process" or "Development SOP" section (wherever is appropriate — the docs subagent can place it).
- EDIT `scripts/hallucination/full-eval.ts` line 140 — change literal `"checker-eval"` → `"checker_eval"` to match the canonical naming. This is a tolerated ad-hoc value under the widened-literal union, but normalizing improves DB queryability.
- EDIT `ui/src/components/WorkflowPage.tsx` line 46 — the displayed list `"charter / validation_sweep / sft_training / checker-eval / infrastructure"` is updated to `"ticket / charter / validation_sweep / sft_training / checker_eval / infrastructure"` to match the canonical `TrackedWorkType` set.

**Note on live `checker-eval` references** (Codex re-triage `a19974cc`): both above are folded into scope. Grep-audited at plan time; no other `"checker-eval"` string literals in the repo outside the session retros (which preserve historical accuracy — NOT changed).

### Slice B — tsc verification (no file changes; command-only)
- Run `bunx tsc --noEmit`. Widened-literal `(string & {})` tail means ALL existing callers still compile regardless of whether they use canonical values. Audit (Codex thread `a5136495` correction): non-canonical literals in active use include `"data-generation"` at `scripts/finetune/aggregate-continuity-labels.ts:172` and `"lora_voice_sft"` at `scripts/finetune/submit-salvatore-training.ts:60`. These are accepted by the widened-literal union; no migration required. A future normalization pass could fold them into the canonical set (`lora_voice_sft` → `sft_training`; `data-generation` stays ad-hoc or becomes a new canonical `data_generation`), but that's out of scope.
- Expected tsc result: baseline 26 errors, 0 new. Widened-literal union preserves compilation for all ~30 historical experiment_type values, not just the 6 canonical ones.

## Risks + mitigations
- **Legacy call sites** — the DB audit surfaced ~30 distinct historical labels. A strict narrowed union would break tsc on dozens of sites. The widened-literal `(string & {})` tail preserves compilation while still giving IDE autocomplete for the canonical 6. No legacy caller needs to change.
- **Autocomplete UX** — TypeScript's widened-literal pattern (`"a" | "b" | (string & {})`) is documented + understood by modern editors; it shows the literal list in autocomplete but accepts any string. Verified pattern from TS 4.1+ release notes.
- **Downstream scripts** — any Python / shell scripts that hard-code `experiment_type` values aren't affected by the TS union. They continue to work but can start using `"ticket"` for new work.
- **Historical clarity** — the retro-assigned labels (this session's #244-#250 all `charter`) stay wrong. That's fine; don't backfill.

## Green / red split
- **Green.** Small typed union + docstring updates. No runtime logic change. Pure clarification.

## Commit chain (anticipated)
1. `[process] T7 — ticket-vs-experiment taxonomy: add TrackedWorkType union + SOP updates (exp #250)` — Slice A + Slice B.

## Codex sequencing
- Phase 2 triage: expect `green`.
- Phase 3 full review: confirm the union's set covers historical usage + no call sites break + docstring accuracy.
- Phase 6 impl review: **hot tier** (typed-union + docs, no behavior change).
