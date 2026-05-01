---
status: active
updated: 2026-05-01
---

# To Do

Pending action items only. Completed work and rationale live in `docs/decisions.md`, `docs/current-state.md`, session retrospectives, and per-charter result docs.

## Current Priorities (2026-05-01)

### 1. Stabilize the split planning contract

The planner now splits beat shape from state/obligation mapping. Exp #289 proved the split can reach final zero obligation orphans, but mapper retries still happen and retry prompts needed a state-preservation fix.

- [x] ~~Run 2-3 more planner-isolated split-mapper samples on different seeds.~~ **Done 2026-05-01.** Exp #297 (heretic, inscription) + exp #298 (echo-mage, mana-eating) cover four seeds against the promoted live mapper path; every seed had 3 mapper calls, all clean on first attempt, ZERO repair calls. Mapper headroom 42-56% across all four. See `docs/decisions.md` exp #297/#298.
- [x] ~~Use the mapper telemetry summary on the next sample set.~~ **Done 2026-05-01.** Ran `scripts/planning-state-mapper-summary.ts` against the four exp #297/#298 novels (heretic, inscription, echo-mage, mana-eating). Across all four: 3 mapper calls each, 0 json/zod failures, 0 retry_chapters, 0 retry_calls, 0 ignored_mappings, 0 initial+latest orphans, 0 overloaded beats, max_attempt=1. Cost $0.007-$0.009 per novel. Final outline counts: facts 17-26, knowledge 10-18, state 7-9.
- [x] ~~Design an incremental LLM mapper-repair surface only if chapter-scoped retries are too expensive.~~ **Done 2026-05-01.** `planning-state-repair` now returns stable-ID patch operations for obligations; deterministic code applies only mechanically valid operations and revalidates. Chapter-scoped mapper retry remains fallback when the patch does not pass. Do not reintroduce code-authored fallback obligations.
- [x] ~~Evaluate stable IDs for knowledge/state changes.~~ **Done 2026-05-01.** Stable IDs now flow through every chapter-level item and every beat obligation; coverage validation is exact-`sourceId` only. Fuzzy/text overlap is not part of the stable-ID harness path. See decision "Stable-ID deterministic contract" and `src/harness/ids.ts`.
- [x] ~~Run a real mapper screen under the stable-ID trace guard.~~ **Done 2026-05-01.** Exp #295 returned `SCREEN-PASS` on `fantasy-system-heretic` after resyncing the variant prompts (`scripts/phase-eval/variants/planning-state-mapper/{default,coverage-balanced}.md`) to the live system prompt; persisted `phase_eval_runs.id=12`. First attempt at commit `662694c` failed because the override prompts were silently stale and emitted id-less obligations — the trace guard caught a regression the prior text-overlap fallback masked. See `docs/decisions.md` exp #295.
- [ ] **Promote second-wave concept-artifact IDs only when a downstream consumer needs them.** `enrichOutlineIds` covers chapter/beat/character/fact/knowledge/state/payoff/obligation. Locations, organizations, cultures, world systems, story-spine threads/promises remain free-text until a checker, eval row, or graph-DB consumer takes a hard dependency on them.
- [ ] **Decide whether checker findings should cite IDs (Phase 11 of the stable-ID plan).** Adherence/halluc/functional-state checkers can now consume `chapterId`/`beatId`/`obligationIds`/`sourceIds` from `llm_calls.request_json`; deferred until a concrete checker gain motivates the prompt change.

### 2. Freeze and calibrate the current checker surface

Checker promotion remains blocked until fresh labels are generated against the new writer-visible surface. Do not add obligation-aware beat blockers yet.

- [ ] **Run a fresh post-validator current-surface drafting sample.** Use the deployed split mapper surface and inspect obligation coverage logs, adherence blockers, `halluc-ungrounded` blockers, functional-state warnings, continuity findings, lint/prose-integrity events, and plan-assist gates.
- [ ] **Build the current-surface hallucination panel.** Run `scripts/hallucination/current-surface-manifest.ts` and `scripts/hallucination/build-current-surface-panel.ts` from the fresh run. Start with the exp #282 `Spire` seed case as the known calibration anchor.
- [ ] **Label the panel before changing checker severity.** Use quote-required oracle labels and record the checker-visible evidence surface for each row. Checker labels must be judged against the exact evidence the checker saw, not the wider writer context.
- [ ] **Only then design obligation-aware beat checks.** Candidate checks must verify obligations the writer saw in `BEAT OBLIGATIONS`; chapter-level planned-state grounding remains warning-class until calibrated.

### 3. Build the evaluation/variant harness needed for next prompt work

The one-off planning variant probes were useful but too bespoke. The next prompt/composite-prior work needs reusable comparison plumbing.

- [x] ~~Sample `coverage-balanced` mapper variant on another seed.~~ **Done 2026-05-01.** Exp #296 SCREEN-PASS on `fantasy-inscription` at commit `08cff71`; persisted `phase_eval_runs.id=13`. coverage-balanced cleared G1-G5 with 0 ID/sourceKind/characterId mismatches, 0 overloaded beats, 35 state items vs floor 26.3, max completion 7113/16384. Combined with exp #295, coverage-balanced now has clean evidence on two seeds. Default-prompt promotion is a separate follow-up.
- [x] ~~Promote `coverage-balanced` to the default mapper system prompt.~~ **Done 2026-05-01.** Commit `f3295a3` made `src/agents/planning-state-mapper/state-mapper-system.md` byte-equal to `coverage-balanced.md`. Exp #297 validated: live-path planning on both `fantasy-system-heretic` and `fantasy-inscription` had 3 mapper calls each, all clean on first attempt, ZERO `planning-state-repair` calls. The promoted prompt eliminates repair-loop dependency in the happy path.
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
- [x] ~~Extend LLM call inspector tags.~~ **Audited 2026-05-01.** Runtime callAgent sites all pass appropriate tags: planning-plotter (attempt), planning-beats/state-mapper/state-repair (attempt+chapter), continuity facts/state (baseTags), halluc-ungrounded (attempt+chapter+beatIndex), functional-state-checker (attempt+chapter), adherence-events (attempt+chapter+beatIndex), reference-resolver (chapter), concept agents (attempt). The tagless `callAgent` sites in `src/agents/structure-{mice,mckee-gap,character-arcs,value-charge,promise}/index.ts` are corpus-extraction agents (consumers in `scripts/corpus/`), not runtime consumers — they have no chapter/beat context to pass. No remaining runtime gap.
- [ ] **Historical-superseded doc pass.** Add inline superseded callouts to older docs that still speak in current tense about retired adapters, Howard primer, tonal pass, and writer LoRA runtime routes. _Partial 2026-05-01 (commit `1905c50`):_ added callouts to hallucination-v3-wire-in-plan, pipeline-14b-consolidation, beat-writer-architecture, hallucination-checker-findings, lora-style-transfer-report, next-session-plan-2026-04-21. Remaining stale docs (codebase-audit-2026-04-18, remediation-pass-2026-04-18, harness-optimization-inventory) can be addressed incrementally if a future reader hits confusion.

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
