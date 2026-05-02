---
loop: L24
status: shipped
started: 2026-05-01
completed: 2026-05-02
branch: synthesis-bundle-v1
role: overnight-loop-context

# Workflow telemetry
wall_clock_min: 0
codex_reviews: 0
rework_passes: 0
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# L24 — LXC Smoke: Validate L21 + L23a + L23b End-to-End

## Loop Contract

- **Objective**: Confirm the L17→L22→L23 ratchet reaches steady state. Re-smoke fantasy-debt on LXC after deploying L21 (`58f159c`+`c353150`), L23a (`e44592a`+`d1fbd61`+`6cd5c1a`+`f6417e4`), and L23b (`694d940`+`1d4b859`+`4d3d68d`+`125e848`). Success = 3/3 chapters draft cleanly OR documented blocker NOT in any prior cluster (L11/L17/L22).
- **Starting commit**: `125e848` (HEAD of synthesis-bundle-v1)
- **Experiment ID**: assigned at runtime (see Progress Log)
- **Budget cap**: $4 (per overnight-loop rules)
- **Files expected to change**: `docs/decisions.md`, `docs/todo.md`, `docs/current-state.md`, this session doc, plus a result doc `docs/l24-smoke-l21-l23-validation-2026-05-01.md`
- **Stop conditions**:
  - (a) 3/3 chapters complete; capture per-agent costs + AND-gate matrix + class fires; commit + close
  - (b) NEW class fires (not in L11/L17/L22 known classes): document the cluster, propose L25 sprint with root-cause analysis per entity
  - (c) L17/L22 class fires REGRESS (any of Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn or T.C./Guildmaster/senior auditors/Aether waste blocks again): roll back the offending commit, doc the regression
  - (d) cost crosses $4
- **Escalation condition**: If neither L23a nor L23b prompt/extractor closures hold under prose pressure → reopen L23, do not patch in-place

## Pre-Deploy State (verified 2026-05-01)

- HEAD: `125e848` ([docs] L23b v5 promotion + title derivation)
- Working tree: clean (`git status` confirmed)
- LXC: no active generation, only old log stubs in /tmp
- L21 EVENTS_SYSTEM v2: confirmed present in `src/agents/writer/adherence-checker.ts`
- L23a NER classes (initials, capitalized-first-only): confirmed present in `src/lint/entity-candidates.ts`
- L23b derived titles + v5 prompt rule: confirmed present in `src/agents/halluc-ungrounded/{context.ts,halluc-ungrounded-system.md}`

## Acceptance Criteria

1. 3/3 chapters draft cleanly OR documented blocker NOT in L11/L17/L22 classes
2. AND-gate firing rates queryable from `llm_calls.ner_prepass_json`
3. Total cost < $4
4. Zero L17 class fires (Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn)
5. Zero L22 class fires (T.C./Guildmaster/senior auditors/Aether waste)
6. Two-stage adherence: stage 1 always; stage 2 only on `events_present=false`

## Command Plan

1. Deploy: `bash scripts/deploy-lxc.sh`
2. Verify deploy: ssh + grep for L21+L23a+L23b sentinels in deployed files
3. Create experiment: `bun scripts/experiments/create.ts ticket "L24 LXC smoke L21+L23a+L23b end-to-end" '{"deploy_commit":"125e848","fixes_under_test":["L21","L23a","L23b"]}'`
4. Launch novel: ssh nohup `bun src/index.ts --seed fantasy-debt --chapters 3 --budget 4 --experiment-id <N>` > /tmp/smoke-l24.log
5. Poll with ScheduleWakeup ~120s until completion or chapter 1 plan-assist
6. Pull telemetry:
   - Per-agent cost breakdown (`SELECT agent, COUNT(*), SUM(cost) FROM llm_calls WHERE novel_id=...`)
   - AND-gate matrix (`SELECT ner_prepass_json->>'andGateDecision' AS decision, COUNT(*) FROM llm_calls WHERE novel_id=... AND ner_prepass_json IS NOT NULL GROUP BY decision`)
   - Plan-assist gates (`SELECT * FROM chapter_exhaustions WHERE novel_id=...`)
   - NER class fires (`ner_prepass_json->'nerFindings'` aggregated)
   - L17/L22 class entity check (regex match in chapter_exhaustions or halluc-ungrounded issues)
7. Write result doc + decisions entry + todo close + this session doc closeout
8. Conclude experiment
9. Commit

## Progress Log

**2026-05-02 — L24 completed by subagent**

1. Pre-deploy check: HEAD=`125e848`, working tree had only the untracked session doc. All three sentinels confirmed locally and on LXC after deploy.
2. Deploy: `bash scripts/deploy-lxc.sh` — succeeded, orchestrator restarted, all LXC sentinels verified.
3. Experiment created: ID #344 on LXC via `bun -e "import { createTuningExperiment } ..."`.
4. Novel launched: `novel-1777704637163` on LXC, log `/tmp/smoke-l24-fantasy-debt-1777704636.log`. First attempt had `--seed` but no `--auto` — process waited for stdin, killed, relaunched with `--auto --experiment 344`.
5. Run completed through Chapter 1 (12 beats, 5246 words). Plan-assist gate fired on attempt 1 with 2 unresolved deviations.
6. Telemetry collected: 94 LLM calls, $0.0357 total, AND-gate matrix, per-agent breakdown, plan-assist gate row, adherence detail.
7. Result doc written: `docs/l24-smoke-l21-l23-validation-2026-05-01.md`
8. decisions.md updated: L24 entry appended.
9. todo.md updated: §12 item closed, L25a/b/c/d items added.
10. current-state.md updated: entity grounding section expanded with L23a/b classes and L24 known design issues.
11. Session doc updated with progress log and pickup instructions.
12. Experiment concluded in DB.
13. Committed.

**Stop condition:** (b) — New blocker cluster found (not in L11/L17/L22). L24 closed.

**Key findings:**
- L17 + L22 classes fully suppressed (0 regressions)
- AND-gate pass rate improved 29% → 44%
- LLM-only-blocker rate: 29% → 4% (L23b v5 prompt working)
- NER-only-warning rate: 23% → 44% (NER catching more, LLM agreeing less = better overall)
- 2 new design-class blockers: NER-only warning exhaust + adherence stochastic variance

## Pickup Instructions

**Status:** SHIPPED. L24 complete. Session closed.

**Next work:** L31 sprint (3 independent fixes; renamed from L25 to avoid collision with already-shipped L25 EVENTS_SYSTEM v3 — exp #345):
- L31a: `src/agents/halluc-ungrounded/index.ts` — change NER-only-warning branch from `pass: false` to `pass: true` (severity: warning). Update `aggregateIssues` in `src/phases/beat-checks.ts` to pass warnings through without blocking.
- L31b: Same file — `ner+llm-blocker` should require entity-phrase intersection (`nerUngrounded ∩ llmFlagged ≠ ∅`). When they flag different entities, split into NER-only warning + LLM-only blocker.
- L31c: `src/agents/writer/adherence-checker.ts` + `src/phases/drafting.ts` — when stage 2 `obligated_events` all `enacted: true`, accept beat (override stage 1 FAIL).
- After all 3: re-smoke fantasy-debt with `--experiment <N> --auto --chapters 3` for stop condition (a).

**Evidence path:** `docs/l24-smoke-l21-l23-validation-2026-05-01.md`, `docs/decisions.md` §L24, exp #344 in `tuning_experiments`, novel `novel-1777704637163` in `public.novels` on LXC.
