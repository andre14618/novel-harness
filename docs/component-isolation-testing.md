---
status: proposed
updated: 2026-05-01
---

# Component Isolation Testing

This charter follows the live split in `docs/current-state.md` and `CLAUDE.md`: planning decides structure, writing decides prose, checking enforces discipline. Isolation is not a default virtue; use it when the question lives inside one layer, and use end-to-end when the answer depends on cross-layer control flow.

## 1. Isolatable Components

Planning layer:
- `planning-plotter`: freeze `novels.seed_json`, `world_bibles.content_json`, `characters.profile_json`, and `story_spines.content_json`; measure chapter count, POV/setting completeness, and target-word distribution. Harness plugs into `src/agents/planning-plotter/context.ts` + `src/agents/planning-plotter/schema.ts`, as called from `src/phases/planning.ts`. Concrete shape: same seed in, chapter skeletons out.
- `planning-beats`: freeze the Phase-1 skeleton plus the same concept artifacts; measure beat count per chapter, beat-kind mix, structural annotations, and whether the generated beat list gives the mapper enough dramatic anchors. Harness plugs into `src/agents/planning-beats/context.ts` + `src/agents/planning-beats/schema.ts`.
- `planning-state-mapper`: freeze concept artifacts, chapter skeleton, and the fixed `planning-beats` scene list; measure `establishedFacts`, `knowledgeChanges`, `characterStateChanges`, `requiredPayoffs`, writer-visible obligation coverage, ignored mappings, retry count, and deterministic auto-repair count. Harness plugs into `src/agents/planning-state-mapper/context.ts` + `src/agents/planning-state-mapper/schema.ts` plus `src/harness/beat-obligations.ts`.
- `savePlannedState`: freeze parsed `chapter_outlines.outline_json`; measure deterministic writes into `facts`, `character_states`, and `character_knowledge`. Harness plugs into `src/planned-state.ts` and the write helpers in `src/db/facts.ts`, `src/db/character-states.ts`, and `src/db/knowledge.ts`.

Writing layer:
- `reference-resolver`: freeze `SceneBeat`, `ChapterOutline`, and prior DB state; measure `ResolvedReferences.context`, lookup count, and LLM-fallback rate. Harness plugs into `src/agents/writer/reference-resolver.ts`.
- `beat-context`: freeze outline, character snapshots, `character_states.state_json`, world bible, and pre-resolved refs; measure deterministic `userPrompt` text and `targetWords`. Harness plugs into `src/agents/writer/beat-context.ts`.
- `beat-writer`: freeze `BeatContextResult.userPrompt`, system prompt, and model config from `src/models/roles.ts`; measure prose length, paragraph breaks, and downstream checker fire rate. The harness should mirror the `executeAndLog()` request assembled in `src/phases/drafting.ts`.

Checking layer:
- `runBeatChecks`: freeze prose, beat, outline, world bible, and prior beat; measure normalized `BeatIssue[]` and retry lines. Pure aggregation plugs into `src/phases/beat-checks.ts`; inference replay plugs into historical `llm_calls` rows.
- `chapter-plan-checker`: freeze prose plus outline; measure `{pass, deviations, setting_match, emotional_arc_correct}`. Harness plugs into `src/agents/chapter-plan-checker/context.ts` + `src/agents/chapter-plan-checker/schema.ts`, as invoked from `src/phases/drafting.ts`.
- `chapter-plan-reviser`: freeze outline, current prose, and unresolved issues/blockers; measure revised `scenes` plus acceptance vs rejection under the sanity rules in `src/phases/drafting.ts`. Harness plugs into `src/agents/chapter-plan-reviser/context.ts` + `src/agents/chapter-plan-reviser/schema.ts`.

## 2. Required End-to-End Tests

- Retry exhaustion must stay end-to-end because budgets in `src/phases/drafting.ts`, persisted flags in `chapter_outlines.revision_used` (`sql/031_chapter_outlines_revision_used.sql`), and gate telemetry in `chapter_revisions` / `chapter_exhaustions` only interact under a live chapter attempt.
- Escalation flow must stay end-to-end because adherence and hallucination retries can change prose enough to alter later `chapter-plan-checker` verdicts; the meaningful behavior is beat issue -> targeted rewrite -> chapter-level recheck -> possible `chapter-plan-reviser`, not any single call in isolation.
- Plan-reviser post-revision sanity checks must stay end-to-end because the important question is not “did the reviser return JSON,” but “did `saveChapterOutline()` persist an acceptable revision, restart the attempt, and honor the one-reviser lifetime cap.”
- SSE and gate sequencing must stay end-to-end because `src/trace.ts`, `src/events.ts`, `src/gates.ts`, `src/orchestrator/novel-routes.ts`, and `ui/src/components/StudioPage.tsx` together define orphan reconciliation, `gate:plan-assist` ordering, and auto-mode `PipelineBailError` behavior.

## 3. Existing Reusable Infrastructure

- `scripts/variant/clone-for-variant.ts` already gives plan-freeze infrastructure for within-seed ladders by copying `novels`, `world_bibles`, `characters`, `chapter_outlines`, and planner-materialized state tables before drafting.
- `docs/eval-infrastructure.md`, `sql/024_eval_briefs_and_results.sql`, and `sql/026_checker_eval_columns.sql` already define a DB-backed eval loop. `eval_briefs` holds frozen inputs; `eval_results` already supports both Phase C.3 voice evals and checker-style `expected_label_json` / `actual_label_json`.
- `scripts/variant/*` is intentionally sparse today: the folder currently contains only `clone-for-variant.ts`. New isolation runners should live beside it so plan-freeze workflows stay discoverable and consistent.
- `llm_calls.request_json` is now proper JSONB after commit `ff555bc9c89e19065532af05593978db7720c0f5`, so structured per-call metadata is queryable instead of double-encoded.
- `llm_calls.system_prompt`, `llm_calls.user_prompt`, and `llm_calls.response_content` from `sql/017_llm_call_inspection.sql` make historical inference replay possible without reconstructing prompts from memory.

## 4. Replay Pattern for Checker Changes

`scripts/replay/<checker>.ts` should:
- query `llm_calls` by `agent` (`WHERE agent = $1 AND failed = false`) and select `id`, `novel_id`, `chapter`, `beat_index`, `system_prompt`, `user_prompt`, `response_content`, and `request_json`;
- normalize the old verdict from `response_content` into checker-specific label JSON;
- load the new prompt/schema from the live module path, then rerun the checker on the frozen historical `user_prompt` or on prose/context rebuilt from `request_json`;
- diff old vs new into a small verdict delta object: pass flip, added issues, removed issues, changed beat indexes;
- persist each replay row to `eval_results` with `set_name='replay:<checker>:<date>'`, `beat_id='llm_call:<id>'`, `adapter_uri='replay://<checker>/<git-sha>'`, `expected_label_json=old`, `actual_label_json=new`, `correct` meaning “no verdict delta,” and `latency_ms` from the replay call.

## 5. Plan-Diff Pattern for Planning Changes

`scripts/plan-diff.ts` should freeze concept-phase outputs from one source novel: `novels.seed_json`, `world_bibles.content_json`, `characters.profile_json`, and `story_spines.content_json`. It should run variant A and B through the same planning seams used by `src/phases/planning.ts`, but stop before drafting and compare the resulting `ChapterOutline[]` structurally.

Required metrics:
- payoff-link coverage: every `requiredPayoffs[].fact_id` resolves to an `establishedFacts[].id`;
- beat-count distribution per chapter;
- `establishedFacts` count per chapter and total;
- `knowledgeChanges` count per chapter and total.

Output should be a JSON report plus a short markdown table. Do not involve prose generation.

## 6. Beat-Rewriter Pattern for Writer Changes

`scripts/beat-compare.ts` should harvest frozen beat briefs from existing `chapter_outlines.outline_json` rows, then rebuild deterministic writer inputs with `src/agents/writer/beat-context.ts`. The frozen upstream state should include `world_bibles.content_json`, `characters.profile_json`, `character_states.state_json`, planner facts from `facts`, and pre-resolved refs from `src/agents/writer/reference-resolver.ts`. For later beats, `previousBeatProse` must also be frozen from a canonical baseline draft, not regenerated per variant.

Each variant then writes the same beat brief side-by-side. Compare prose shape, paragraphing, and `runBeatChecks()` outcomes. Persist rows to `eval_results` with one `cell_label` per writer variant.

## 7. Decision Tree

1. Does the hypothesis change structure before prose exists? If yes, run `plan-diff`; if no, go to 2.
2. Does it change only prose generation with fixed `chapter_outlines`, world state, and beat briefs? If yes, run `beat-compare`; if no, go to 3.
3. Does it change only checker judgment on existing prose/context? If yes, run `scripts/replay/<checker>.ts`; if no, go to 4.
4. Does success depend on retry budgets, targeted rewrites, reviser escalation, or persisted flags in `chapter_outlines` / `chapter_revisions`? If yes, run end-to-end; if no, go to 5.
5. Does it touch SSE, trace, or `plan-assist` gate behavior across `src/trace.ts`, `src/events.ts`, `src/gates.ts`, and `ui/src/components/StudioPage.tsx`? If yes, run end-to-end; if no, isolated testing is primary, followed by one smoke e2e.

## 8. Anti-Patterns

- Checker-only ship gate. Failure mode: replay shows a cleaner verdict, but the live retry loop in `src/phases/drafting.ts` may already clear the old issue, or the new checker may create worse rewrite churn. Missed interaction: checker -> targeted rewrite -> recheck.
- Beat-isolated eval for planner changes. Failure mode: a plan variant looks fine beat-by-beat but breaks payoff realization or chapter-level arc coherence. Missed interaction: `src/agents/planning-beats/schema.ts` -> `src/agents/writer/beat-context.ts` -> `chapter-plan-checker`.
- Reviser judged without persistence. Failure mode: revised beats look plausible in isolation, but the real system rejects them on beat floor/new-character checks or mishandles restart state. Missed interaction: `chapter-plan-reviser` -> `saveChapterOutline()` -> `chapter_outlines.revision_used` -> next attempt.
