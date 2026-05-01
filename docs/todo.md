---
status: active
updated: 2026-05-01
---

# To Do

Pending action items only. Completed work and rationale live in `docs/decisions.md`, `docs/current-state.md`, session retrospectives, and per-charter result docs.

## Current Priorities (2026-05-01)

### 1. Stabilize the split planning contract

The planner now splits beat shape from state/obligation mapping. Exp #289 proved the split can reach final zero obligation orphans without deterministic auto-repair, but mapper retries still happen and retry prompts needed a state-preservation fix.

- [ ] **Run 2-3 more planner-isolated split-mapper samples on different seeds.** Inspect per-chapter mapper orphan counts, mapper retry count, ignored mappings, overloaded beats, JSON retries, and final auto-repair count. Use `scripts/test-planner-isolated.ts` and link runs to exp #289 or a follow-up experiment.
- [ ] **Use the mapper telemetry summary on the next sample set.** `scripts/planning-state-mapper-summary.ts --novel-id=<id>` now joins `llm_calls`, final outlines, and `output/<novel>/harness.log` to report initial/final orphan counts, retry pass counts, auto-repair count, max completion tokens, JSON retries, and cost. Run it for the next 2-3 planner-isolated samples and persist findings in `docs/decisions.md` or a result doc.
- [ ] **Decide auto-repair policy after the sample set.** Options: keep final auto-repair as warning-class safety net, route remaining gaps to plan-assist in human mode, or keep auto-repair only for short-story/auto mode. Do not remove auto-repair until mapper retry evidence is stable.
- [ ] **Evaluate stable IDs for knowledge/state changes.** Deterministic coverage still matches knowledge/state by text and character. Consider adding IDs to `knowledgeChanges[]` and `characterStateChanges[]` only if mapper retries keep missing or mutating state under text matching.

### 2. Freeze and calibrate the current checker surface

Checker promotion remains blocked until fresh labels are generated against the new writer-visible surface. Do not add obligation-aware beat blockers yet.

- [ ] **Run a fresh post-validator current-surface drafting sample.** Use the deployed split mapper surface and inspect obligation coverage logs, adherence blockers, `halluc-ungrounded` blockers, functional-state warnings, continuity findings, lint/prose-integrity events, and plan-assist gates.
- [ ] **Build the current-surface hallucination panel.** Run `scripts/hallucination/current-surface-manifest.ts` and `scripts/hallucination/build-current-surface-panel.ts` from the fresh run. Start with the exp #282 `Spire` seed case as the known calibration anchor.
- [ ] **Label the panel before changing checker severity.** Use quote-required oracle labels and record the checker-visible evidence surface for each row. Checker labels must be judged against the exact evidence the checker saw, not the wider writer context.
- [ ] **Only then design obligation-aware beat checks.** Candidate checks must verify obligations the writer saw in `BEAT OBLIGATIONS`; chapter-level planned-state grounding remains warning-class until calibrated.

### 3. Build the evaluation/variant harness needed for next prompt work

The one-off planning variant probes were useful but too bespoke. The next prompt/composite-prior work needs reusable comparison plumbing.

- [ ] **Run the first mapper variant probe through the refreshed phase-eval plumbing.** The runner now accepts `PLANNING_STATE_MAPPER_PROMPT_OVERRIDE` and `print-screen-verdict.ts --metric-set=state-mapper` reports facts/knowledge/state/payoffs/obligations plus orphan/overload gates. First candidate arm: `coverage-balanced` vs `default` in `scripts/phase-eval/variants/planning-state-mapper/`. Example command after deploy: `bun scripts/phase-eval/probe-planning-beats.ts --seed=fantasy-system-heretic --variants=default,coverage-balanced --variant-dir=scripts/phase-eval/variants/planning-state-mapper --output-base=output/phase-eval/<run-tag> --prompt-env=PLANNING_STATE_MAPPER_PROMPT_OVERRIDE`.
- [ ] **MVP durable eval/testing module.** Design draft: `docs/designs/eval-testing-module-v1.md`. Replace bespoke scripts with `(variant config, seed set, metric set) -> results table + UI`, reusing `llm_calls`, `tuning_experiments`, `pipeline_events`, and `eval_results` where possible.

### 4. Pick the next corpus-informed synthesis probe after runtime stabilization

Corpus mining has enough single-pattern evidence. Do not mine more one-off patterns until a composite prior has been tested through the refreshed variant harness.

- [ ] **Pick one composite-prior bundle for the next variant arm.** Current candidates: action-beat assembly, voice/dialogue shaping, per-pair interaction mode, or chapter-close narrator seam. Prefer one bundle per arm so causal signal stays readable.
- [ ] **Fix P3b closer-kind regression before re-probing plotter variants.** The corpus-v1 plotter variant regressed chapter closer kind to 0/3 action vs 2/3 default. Revise the closer guidance before using it in a larger bundle.
- [ ] **Re-measure P16 facts density on 5+ chapters.** The n=3 corpus-v1 probe showed a facts-density drop, but the sample is below noise floor.
- [ ] **Soften the rank-ordered beats variant to set-based guidance.** The directional re-score found rank-ordering over-constrains the planner. Convert to a set the planner can select from before another probe.

### 5. Runtime and repo hygiene

- [ ] **Tighten the TypeScript baseline.** Full `bunx tsc --noEmit` still fails on pre-existing strictness/test-fixture issues, including missing `obligations` in fixtures, optional `functional-state-checker` fields, implicit `any` DB mappers, and `llm.test.ts` typing. Fix separately from planning changes.
- [ ] **Fix DB-backed phase parity reliability.** `tests/phase-parity/phase-parity.test.ts` can still fail with `ERR_POSTGRES_CONNECTION_CLOSED` in local runs.
- [ ] **Full restart recovery for plan-assist gates.** MVP orphan detection exists; full recovery needs drafting attempt-loop changes so resume can re-fire and re-await pending gates.
- [ ] **Extend LLM call inspector tags.** `chapter`, `beat_index`, and `attempt` are populated for key drafting calls; thread tags through remaining planner/checker/support calls where missing.
- [ ] **Historical-superseded doc pass.** Add inline superseded callouts to older docs that still speak in current tense about retired adapters, Howard primer, tonal pass, and writer LoRA runtime routes.

## Parked Or Deferred

These are real ideas but not active next steps.

- [ ] **Branch search and multi-candidate drafting.** First milestone is V0 candidate plan sampler plus deterministic branch filters. See `docs/features-expansion-todo.md`.
- [ ] **Prose quality improvement track.** Wait until plan/obligation/runtime and checker calibration are stable. Prefer multi-draft local selection and targeted beat/window rewrites over full-chapter rewrites. See `docs/features-expansion-todo.md`.
- [ ] **Audiobook voice tagging / multi-cast TTS exploration.** First milestone is a tagged JSON/SSML sidecar export, not TTS generation. See `docs/features-expansion-todo.md`.
- [ ] **Scene-level vs beat-level writer architecture.** Parked by user direction. Beat-level remains default until current runtime evidence justifies reopening.
- [ ] **Deep-authoring / post-planning edit UI.** Still valuable for human-shaped novels, but lower priority than runtime contract and eval infrastructure.
- [ ] **Small-model/local checker POCs.** Preserved as optional checker cost/latency work, not writer-route strategy. Do not start new SFT spend without explicit user authorization.
- [ ] **Adapter registry/provenance hardening.** Useful for archived/future fine-tunes: registry-backed UI, training-data SHA256, formatter provenance, and experiment lineage hooks.
- [ ] **Character-name normalization.** Split titles from first/last names only when a future feature becomes sensitive to surname/title matching.

## Explicitly Not Current

- Writer-layer LoRA routing, tonal/voice LoRA generation, Salvatore leak detection, and Howard-primer style prompting are retired from runtime.
- New writer/checker fine-tunes are not the default path. Prefer DeepSeek V4 Flash plus deterministic guards and calibrated, bounded checkers.
- Continuity SFT expansion and halluc-leak Salvatore SFT v2 are deferred unless fresh evidence shows the current DeepSeek/deterministic surfaces are insufficient.
