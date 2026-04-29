---
status: retrospective
updated: 2026-04-29
duration: ~7h
commits: 14
subagents_spawned: 2
wall_clock_min: 420
codex_reviews: 5
rework_passes: 5
bugs_caught_by_codex: 8
bugs_caught_by_preflight: 1
bugs_escaped_to_prod: 1
preflight_false_positives: 0
---

# Phase-eval probe + V4 Flash swap — 2026-04-29

## 1. What shipped (≤150 words)

DeepSeek V3.2 → V4 Flash swap landed pipeline-wide (commit `eb2993d`), with thinking-mode toggled per-agent (only `planning-beats`, `chapter-plan-checker`, `chapter-plan-reviser`). Legacy `deepseek-chat` / `deepseek-reasoner` registry entries removed entirely; 22+ scripts string-replaced. CLAUDE.md rule 6 augmented with explicit required-rsync stages (`09bbf7a`). Phase-modularization parity baseline (P0b) recorded on `fantasy-system-heretic` litrpg seed — 101 LLM calls, 12m 22s wall clock, committed at `0d78adf`. Phase-variant-comparison probe scaffold (charter R5 from `docs/designs/phase-variant-comparison.md`) implemented end-to-end as `scripts/phase-eval/{probe-planning-beats,run-variant,print-screen-verdict}.ts` + `default.md`/`loud.md` variants + `PLANNING_BEATS_PROMPT_OVERRIDE` env-var seam (`c6ef9a5`). First probe run: loud variant moved median facts/chapter +5, mean beats/chapter +4.3, mean knowledge/chapter +1.3 over default — strong directional signal that prompt-shape is a load-bearing planner lever even on V4 Flash thinking-mode.

## 2. Architectural iterations with supersession chains

### Chain A: charter scope convergence (R1 → R5, 4 review rounds)

- **Initial approach (R1):** 14h harness build for full phase-side-by-side comparison framework. Codex `gpt-5.5 effort=high` verdict: RED (over-scope) — committed too much before validating the surface.
- **Problem discovered:** each Codex round named a specific cheaper untried counterfactual. R2 RED on 5 mechanical blockers (non-disjoint verdict cells, fake noise-band citation, missing tables in schema, wrong runner spec, SHIP-gate bypass). R3 RED on chapter-plan-checker requiring prose input incompatible with planner-only scope + N=5 making ±5pp gates uninterpretable. R4 RED on 5 schema bugs (`scenes_json` doesn't exist — actual column is `outline_json`; G1 not computable because establishedFacts is chapter-level not per-beat; G2 tautological because knowledgeChanges.characterName is required schema field; runner approval gate unspecified; compliance gates accept weaker than rider claims).
- **Superseded by:** R5 charter — 5-chapter planner-only A/B with directional G1-G4 gates, no chapter-plan-checker, no compliance language. Final scope ≈ 5% of R1.
- **Commit refs:** charter `42ae810`; implementation `c6ef9a5`.
- **Lesson:** the cheapest-counterfactual pivot pattern (memory `feedback_codex_counterfactual_signal`) holds across 4 successive rounds — each named counterfactual was the right pivot, not something to refute. If a charter is hitting 3+ rounds, the meta-question ("is this the right instrument") plus the cheapest-counterfactual pivot is faster than another revision.

### Chain B: V4 Flash thinking-mode rollout

- **Initial approach:** swap V3.2 → V4 Flash in registry + roles, set `thinking: true` for all 10 DeepSeek-using slots ("newer model, more capability, why not"). Pricing sheet copied from V4 Flash to V4 Pro entry assuming family parity.
- **Problem discovered:** user pushback ("are they literally all being used for thinking?") + ("V4 Pro is NOT the same price as flash. it is https://api-docs.deepseek.com/quick_start/pricing"). V4 Pro is $1.74/$3.48 base — ~12× output cost vs Flash at base rate. Thinking mode defaults to OFF; only multi-element structural reasoners need it.
- **Superseded by:** thinking ON only on `planning-beats` (14-beat per-chapter expansion with cross-beat dependencies), `chapter-plan-checker` (cross-beat coherence over 14 beats), `chapter-plan-reviser` (smallest-edit diff over multi-issue cluster). Decision rule documented as comment block above `deepseekV4Flash` in `src/models/roles.ts`. V4 Pro registered as escalation, NOT routed.
- **Commit ref:** `eb2993d`.
- **Lesson:** when a model family adds an optional thinking mode, evaluate per-agent against the structural-reasoning criterion before flipping the flag. Default OFF; the agent must justify the latency and cost. Same trap for pricing — variant suffixes (-flash, -pro, -reasoner) often signal a price-tier shift, not just a capability shift.

### Chain C: variant runner architecture (in-process → child-processes)

- **Initial approach:** charter-side hand-wave assumed in-process variant cycling — read prompt file, swap, run, repeat.
- **Problem discovered:** `src/agents/planning-beats/index.ts` loads its prompt via top-level `await Bun.file(promptPath).text()`. In-process variant cycling silently applies the FIRST variant's prompt to ALL subsequent variants because the module graph caches the first await result for the lifetime of the process. No good in-process invalidation hook exists.
- **Superseded by:** per-variant child processes via `spawn()`. Parent driver writes variant config, sets `PLANNING_BEATS_PROMPT_OVERRIDE` env var, spawns child; child reads env at module load (fresh module graph); results write to disk; parent aggregates.
- **Commit ref:** `c6ef9a5` (Slice 1 implementation).
- **Lesson:** any variant runner that swaps a top-level-await constant (prompt, schema, config loaded at import) MUST spawn fresh processes per variant. In-process cycling is a bug factory because the cache invalidation is implicit and silent. Generalized in `lessons-learned.md` 2026-04-29 section.

### Chain D: schema-of-record drift caught in production

- **Initial approach:** Slice 0a `clone-for-variant.ts` extension copied `CONCEPT_DONE_MUST_BE_ABSENT` table list from sql/011 + sql/012 schema design without re-checking sql/013.
- **Problem discovered:** `thematic_tags` was created in sql/011 but DROPPED in sql/013 (drop_themes_unify_defaults). Audit query `SELECT COUNT(*) FROM thematic_tags WHERE novel_id = $1` errored with `relation "thematic_tags" does not exist` after an otherwise successful clone — the cloned novel was correctly populated, but the post-clone audit blew up and the script exited 1, blocking the probe parent. First probe run failed at the default variant's clone step.
- **Superseded by:** removed `thematic_tags` from `CONCEPT_DONE_MUST_BE_ABSENT` and added a comment citing the sql/011 CREATE + sql/013 DROP.
- **Commit ref:** `9de6a78`.
- **Lesson:** memory `feedback_schema_of_record_check` says: "Before landing code that assumes array size / enum / structural shape, grep the production schema-of-record and confirm." This session is the concrete cite — `grep -rn thematic_tags sql/` would have caught the drift in <5 seconds. Adding to the schema audit checklist for any future table-list constants.

## 3. Codex back-and-forth exchanges

1. **Thread:** R1 (codex:adversarial-review on charter v1)
   - **Original commit claim:** 14h harness build for phase-side-by-side comparison
   - **Codex found:** RED — over-scope; committed before validating surface; cheapest counterfactual is "5-chapter planner-only A/B"
   - **Fix:** charter rewrite to probe-shape (commit superseded by R2)
   - **Sufficient?** no — R2 found 5 more mechanical blockers
2. **Thread:** R2 (codex:adversarial-review on charter v2)
   - **Original commit claim:** 5-chapter planner-only A/B with full validation
   - **Codex found:** RED — non-disjoint verdict cells; fake noise-band citation; missing chapter_summaries+retrieval_config in schema; runner spec used runDraftingPhase output for validation_passes (only runValidationPhase writes); SHIP gate bypassed checker recalibration
   - **Fix:** R3 charter (planner-only without replay; pre-registered numeric gates; missing tables added)
   - **Sufficient?** no — R3 found chapter-plan-checker incompatibility
3. **Thread:** R3 (codex:adversarial-review on charter v3)
   - **Original commit claim:** R3 charter with chapter-plan-checker as quality gate
   - **Codex found:** RED — chapter-plan-checker requires prose input (verified at `src/agents/chapter-plan-checker/context.ts:13`), incompatible with planner-only scope; N=5 makes ±5pp gates uninterpretable (moves in 20pp increments)
   - **Fix:** R4 charter — dropped chapter-plan-checker entirely; outline-eval metrics only; integer-chapter-count gate space
   - **Sufficient?** no — R4 found 5 schema bugs
4. **Thread:** R4 (codex:adversarial-review on charter v4)
   - **Original commit claim:** R4 charter with full G1-G4 gates
   - **Codex found:** RED — `chapter_outlines.scenes_json` doesn't exist (actual: `outline_json`); G1 not computable (establishedFacts is chapter-level); G2 tautological (characterName required field); runner approval gate unspecified; compliance language unsupported by N=5
   - **Fix:** R5 charter (commit `42ae810`) — outline_json column, chapter-level G1, volume-based G2, runner setAutoMode(true), directional language only
   - **Sufficient?** yes — R5 was committed and implementation proceeded; user explicitly said "after integrating these this latest review proceed with implementation. i will have codex make a pass to fix after the implementation"
5. **Thread:** `a09d5baaad90af744` (codex:codex-rescue gpt-5.5 effort=high adversarial review on Slice 1 implementation)
   - **Original commit claim:** Slice 1 phase-eval probe scaffold + V4 Flash plumbing + the 2 follow-up fixes (commits `c6ef9a5`, `9de6a78`, `d024ce8`, `eb2993d`)
   - **Codex found:** RED — (a) verdict script `print-screen-verdict.ts` did not implement the charter G1-G4 screen at all (computed mean/median on wrong fields, never applied 1.5x/8/3/1.10 thresholds, never emitted SCREEN-PASS/SCREEN-FAIL or exit-code-driven verdict); (b) clone-for-variant audits ran AFTER the transaction committed — failed audit left half-cloned novel with no rollback; (c) orphan DB state on child crash — chapter_outlines saved one row at a time outside transaction, no parent cleanup. Plus 3 warnings (parent module-graph polluted by planning-beats top-level-await via `src/prompts.ts` barrel; snapshot phase column never updated; `--concept-snapshot-id` not validated) and 2 applicable suggestions.
   - **Fix:** commit `28c2e57` — full verdict-script rewrite, audits moved inside transaction, parent cleanup pass via `clearNovelState`, direct prompt imports in `src/phases/concept.ts`, snapshot phase UPDATE, snapshot validation. Re-ran verdict on existing probe data → SCREEN-PASS confirmed (loud cleared all 4 gates).
   - **Sufficient?** yes — all blockers + applicable warnings + suggestions integrated; one needs-verification item (legacy abs-path fallback shape) left as-is because the only legacy producer matched the current fallback layout.

## 4. Class-of-bug patterns

- **Schema-of-record drift** — code constants (`CONCEPT_DONE_MUST_BE_ABSENT` table list, charter schema citations) carrying forward DROPPED table/column references; seen at 2 sites this session (`thematic_tags` in clone-for-variant audit, `scenes_json` in charter R3). Both caught only at runtime / Codex review, not preflight. Pattern recurs ≥2 times → candidate for elevation to `docs/patterns/schema-of-record-drift.md` with grep-based preflight check.
- **Implementation-vs-spec drift** — verdict-script implemented a "directional reporter" (mean/median + delta printout) when the charter §G specified an ordered-predicate table with explicit thresholds, exit codes, and SCREEN-PASS/SCREEN-FAIL emission. Codex caught this at end-of-session review. The charter language was clear; the implementation translated it into a more comfortable shape (descriptive metrics) that lost the load-bearing decision logic. **The rule:** when a charter specifies thresholds + ordered predicates + exit codes, the implementation must emit the verdict per spec, not a softer descriptive form. Cite charter §G inline in the script's header so the spec/implementation correspondence is visible.
- **Audit-after-commit transaction trap** — clone-for-variant ran the post-condition audit OUTSIDE the `db.begin()` transaction, so audit failure left committed half-state with no rollback. The script's header comment claimed "all-or-nothing" but the transaction boundary didn't enclose the audit. **The rule:** any "all-or-nothing" claim about a multi-step DB operation must enclose ALL the validation logic inside the transaction. Use `tx.unsafe(...)` not `db.unsafe(...)` inside the begin callback. Pattern repeats — `feedback_atomic_commits` is the close cousin.
- **Module-graph pollution from broad barrels** — `src/prompts.ts` re-exports prompt files from every agent. Importing the barrel for one prompt loads ALL prompts as a side effect (each via top-level await). The probe parent imported `runConceptPhase`, which imported the barrel, which silently loaded `planning-beats`'s default prompt before child processes had a chance to set the override env var. Child-process isolation rescued the bug today, but the pattern is fragile. **The rule:** in module graphs where one re-export carries a load-bearing side effect (top-level await, registration, etc.), prefer direct imports of the specific symbols you need rather than the broad barrel. Direct imports are surface-area control.
- **Approval-gate hang in non-interactive drivers** — `record-fixture.ts` blocked silently on world-bible approval because autoMode defaulted to false; seen at 1 site this session, but the pattern is general (any new test/eval/probe driver that calls phases with gates). The fix is a 2-line preamble (`setAutoMode(true)` + `setResolverMode("auto")`); the bug is silence — no error, just hang. Adding to driver boilerplate checklist.
- **Top-level-await module caching across variants** — `await Bun.file(...)` at module import caches forever in-process; seen at 1 site this session (planning-beats prompt). The general pattern: any tunable surface loaded via top-level await is per-process, not per-call. Variant runners MUST spawn fresh processes; in-process cycling is broken.
- **Cross-machine path serialization** — `summary.json` written on LXC carried absolute LXC paths that didn't exist after rsync to local; verdict reader exploded with ENOENT. Pattern: any cross-machine artifact that references file paths must serialize relative paths, and readers must accept relative + resolve against the artifact's directory.

## 5. Process observations

The Codex `gpt-5.5 effort=high` adversarial review pattern continued to dominate quality gates this session. Charter scope went R1 → R5 (5% of original) over 4 review rounds, each round naming a cheaper counterfactual that became the next pivot. The cheapest-counterfactual pattern from `feedback_codex_counterfactual_signal` is now empirically validated across 4 successive rounds in a single charter — a much stronger signal than any single use case.

The "act on Codex consensus" pattern (memory `feedback_act_on_codex_consensus`) was honored — after R5 the user explicitly said "proceed with implementation, I will run Codex pass after." No further charter revisions were attempted; implementation proceeded directly. This kept turnaround tight despite the long review chain.

Parallel work: while the parity recorder ran on LXC (~12 minutes), the main process built Slice 1 implementation (planning-beats env-var seam, run-variant child, probe parent, verdict script, 2 variant prompts) + spawned a Sonnet doc subagent in parallel to refresh `current-state.md` / `lessons-learned.md` / `todo.md`. The doc subagent finished in ~4 minutes with clean output requiring zero manual edits — same quality bar as before. Pattern remains correct: spawn the doc subagent in parallel after a PR-sized chunk lands; check before commit.

The schema-of-record drift bug (Chain D) was the only escaped-to-prod bug this session — it slipped past my own implementation review because I was reading sql/011 + sql/012 for table existence, not sql/013 for table drops. Codex review of Slice 1 (queued) may catch this class going forward; preflight grep-based check would catch it earlier.

One workflow observation: the harness blocks `sleep N; cmd` to prevent polling sleep-chains — first time I hit it this session, redirected to checking process state directly. The block is correct: it forces explicit ScheduleWakeup or Monitor instead of polling.

## 6. Open questions / next-session focus

- **Codex pass on Slice 1 completed end-of-session (RED → integrated).** Codex `gpt-5.5 effort=high` review (thread `a09d5baaad90af744`) returned RED with 3 blockers + 3 warnings + 2 suggestions. Integrated in commit `28c2e57`:
  - **G1-G4 screen wrong end-to-end.** Verdict script implemented mean/median on the wrong fields and never applied charter thresholds. Rewrote against charter §G — ordered predicate table, exit 0 for SCREEN-PASS / 1 for SCREEN-FAIL, validates each outline against `chapterBeatsSchema`. Re-ran on existing probe data → SCREEN-PASS (loud cleared all 4 gates).
  - **Clone audits ran outside the transaction.** Moved row-count + MUST-be-absent audits inside `db.begin()` so audit failure rolls back the entire clone instead of leaving a half-cloned novel committed.
  - **Orphan DB state on child crash.** Probe parent now tracks all created novels and clears them via `clearNovelState` on failure (always) and on success by default (DB rows are throwaway; `--keep-novels` opts out).
  - **Module-graph pollution.** `src/phases/concept.ts` imports the 3 concept prompts directly from agent modules instead of via `src/prompts.ts` barrel — eliminates the side-effect load of planning-beats's default prompt into the probe parent process.
  - **Snapshot phase not stored.** Probe now UPDATEs `novels.phase = 'planning'` after concept completes so the stored row matches the snapshot state.
  - **`--concept-snapshot-id` validation.** Probe verifies user-supplied snapshot exists, has phase='concept'|'planning', and has world_bibles + characters rows before cloning.
- **Probe scaffold is now Codex-clean.** All blockers fixed; one needs-verification suggestion left as-is (legacy abs-path fallback shape — only producer used the layout the current fallback handles).
- **Probe sample size.** Charter R5 specified 5 chapters per variant; we used the smallest current-target-genre seed (`fantasy-system-heretic`, 3 chapters) to keep cost low. The first run (3 chapters per variant, 1 run per variant, no temperature variance baseline) showed strong directional signal (ΔG1=+5, ΔG3=+4.3) but the sample is below the charter's spec. Next probe should either run a 5-chapter litrpg seed (none currently exists at chapter 5) or run 3 separate runs at temperature=0.6 to get a noise band.
- **Decision pending: scale or pivot.** Per todo.md "post-probe scaling decision" item: (a) scale to 2 more variants on the same screen, (b) add a G5 metric (e.g., halluc-fire-rate at draft time), (c) fold the env-var seam into harness as a permanent prompt-pinning surface (`pipelineOverrides.promptOverrides[agent]`), or (d) close the probe out as instrument-validated and return to context-engineering work. Decision should land in next session's retrospective.

If you're reading this on the next session, **start here:** the phase-eval probe scaffold is Codex-reviewed and integrated (commit `28c2e57`). First run on `fantasy-system-heretic` (3 chapters) produced a SCREEN-PASS verdict — loud variant cleared G1 (facts_median 8 ≥ 1.5×3 AND ≥8), G2 (know_median 5 ≥ 1.5×3 AND ≥3), G3 (total_beats 43 ≥ 1.10×30), G4 (3 outlines parse). Sample is below charter spec (5 chapters, multiple noise-band runs); next decision per todo.md is whether to (a) re-run on a 5-chapter seed, (b) add temperature noise band on the same seed, (c) fold the env-var seam into harness as `pipelineOverrides.promptOverrides`, or (d) close as instrument-validated and pivot to context-engineering work.
