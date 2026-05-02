---
status: complete
updated: 2026-05-01
role: overnight-loop-context
experiment_id: 335
---

# L17 — 3-Chapter LXC Smoke: v4 Halluc Prompt + L15 NER X-of-Y + L16 NER Telemetry — 2026-05-01

## Loop Contract

- Objective: Validate the full v4 halluc-ungrounded prompt + L15 NER X-of-Y extractor + L16
  `ner_prepass_json` JSONB telemetry on a real 3-chapter LXC run. L11 novel `novel-1777695343246`
  (fantasy-debt) stopped at ch1 on 4 plan-assist fires (district archive, trade corporation,
  Grand Ledger, Guild Master). L14 (exp #329) shipped v4-disam that closed all 4 on a synthetic
  mini-panel. This loop confirms the fix on the actual production trigger seed + captures the
  first production AND-gate matrix.
- Starting commit: 2c46924 ([docs] L14 v4 halluc promotion)
- Experiment ID: 335
- Budget cap: $4
- Primary lever under test: v4 halluc-ungrounded prompt on real 3-chapter run (fantasy-debt seed)
- Secondary validation: L15 NER X-of-Y/number-word-tail fires in production; L16 AND-gate matrix
- Files/scripts expected to change:
  - `docs/sessions/2026-05-01-L17-smoke-v4-validation.md` (this file — progress log)
  - `docs/l17-smoke-v4-validation-2026-05-01.md` (result doc)
  - `docs/decisions.md` (L17 entry)
  - `docs/todo.md` (close 3-chapter clean run item)
- Evidence artifact: `llm_calls.ner_prepass_json` AND-gate matrix query; `phase_eval_runs` row
- Stop condition (any):
  (a) 3/3 chapters complete + telemetry captured + docs committed
  (b) plan-assist fires on a NEW cluster (not the L11 4 fires) → record + stop
  (c) deploy script blocks → diagnose only
  (d) cost > $4
- Escalation condition: NEW cluster fires → document as L18 follow-up, do NOT iteratively patch

## Baseline (L11)

- L11 experiment: exp #326, novel `novel-1777695343246`, seed `fantasy-debt`, 3-chapter run
- Result: drafted ch1, then plan-assist fired 4 times on:
  1. "district archive" — lowercase compound descriptor FP
  2. "trade corporation" — lowercase compound descriptor FP
  3. "Grand Ledger" — system-vocab alias (world system description not surfaced)
  4. "Guild Master" — title-only FP (space-separated variant)
- L14 fix: v4-disam prompt adds disambiguation section clarifying compound descriptors,
  title-only phrases ("the Guild Master"), and introduces "descriptors" exception category
- L15 fix: NER X-of-Y class (e.g. "the Third of Five") and number-word-tail class
- L16 fix: persist `ner_prepass_json` per halluc-ungrounded llm_call for audit

## Pre-Deploy Checks

- Local git status: clean (confirmed)
- Latest commits: 2c46924, 9de44eb (v4-disam), 0d8135e (L16 persistence), 74171d5 (L15 X-of-Y)
- LXC active generation: NONE (confirmed before deploy)
- deploy-lxc.sh interactive guard: runs cleanly since working tree is clean

## Command Plan

- Command 1: `bash scripts/deploy-lxc.sh` (non-interactive since tree is clean)
- Command 2: Sanity-check LXC deploy (grep entity-candidates + halluc-ungrounded + system.md)
- Command 3: Verify `ner_prepass_json` column on LXC
- Command 4: `createTuningExperiment("ticket", "L17 3-ch smoke validating v4+L15+L16 stack", ...)`
- Command 5: `ssh novel-harness-lxc "nohup EXPERIMENT_ID=<id> bun scripts/run-novel.ts --seed fantasy-debt --chapters 3 --novel-key <key> > /tmp/<key>.log 2>&1 &"`
- Command 6: Poll every ~120-180s
- Command 7: Pull telemetry (AND-gate matrix, NER class histogram, adherence ratio, plan-assist gates)
- Command 8: Persist `phase_eval_runs` row
- Command 9: Write result doc + update decisions.md + todo.md
- Command 10: `concludeExperiment(<id>, "...")`
- Command 11: Commit

## Progress Log

- [x] Session context written
- [x] Pre-deploy checks passed (clean tree, no active generation)
- [x] `bash scripts/deploy-lxc.sh` — deployed synthesis-bundle-v1 to LXC (commit 59229cea)
- [x] Sanity-checks: entity-candidates, halluc-ungrounded, system.md, ner_prepass_json column — all confirmed on LXC
- [x] Experiment #335 created via `createTuningExperiment('validation_sweep', 'L17 3-ch smoke validating v4+L15+L16 stack', ...)`
- [x] Novel run launched: `nohup EXPERIMENT_ID=335 bun src/index.ts --auto --seed fantasy-debt --chapters 3 > /tmp/novel-1777698707087.log 2>&1 &`
- [x] Monitored via log polling; chapter 1 attempted 3×, bailed at plan-check-exhausted
- [x] Telemetry collected (AND-gate matrix, NER class histogram, cost, exhaustion detail)
- [x] Stop condition (b) confirmed: new cluster (Brennan, Aldric, world locations) — NOT L11 cluster
- [x] L11 cluster confirmed closed (0 fires from all 4 target entities)
- [x] phase_eval_runs row inserted (id=80)
- [x] Experiment #335 concluded
- [x] Result doc written: `docs/l17-smoke-v4-validation-2026-05-01.md`
- [x] `docs/decisions.md` §L17 entry appended
- [x] `docs/todo.md` §12 updated (L18 item added)
- [x] Session doc updated

## Results

- Outcome: PARTIAL — stop condition (b) triggered. L11 cluster CLOSED (0/4 fires). New cluster: character names + world locations absent from groundedSources. L15 x-of-y validated in production. L16 ner_prepass_json confirmed populated on 55 calls.
- Evidence link: tuning_experiments.id=335, phase_eval_runs.id=80, novel novel-1777698707087
- Cost: $0.062
- Commit(s): TBD

## Pickup Instructions

- Loop complete. All telemetry persisted. Docs updated.
- Next action: L18 — surface character-agent + world-builder named entities into groundedSources for halluc checker. Then re-run 3-chapter fantasy-debt run to close §12 todo item.
