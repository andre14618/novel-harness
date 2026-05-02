---
loop: L24
status: in-progress
started: 2026-05-01
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

(written by subagent)

## Pickup Instructions

(written by subagent on stop)
