---
status: blocker-recorded
updated: 2026-05-02
role: overnight-loop-context
loop: L11
experiment: 326
phase_eval_run: 74
---

# L11 — Deploy + 3-Chapter Smoke Validate NER Prepass + allowedNewEntities + Two-Stage Adherence

## Loop Contract

- **Objective:** Validate the runtime accuracy/reliability stack landed in this overnight session — (a) NER prepass + AND-gate in halluc-ungrounded (L4-followup-3, commit `f019c60`, exp #322), (b) `allowedNewEntities` in the grounded union (L9, commits `ebe71e2`+`7ef3a9d`, exp #325), (c) two-stage adherence (L5, commit `ae50e99`, exp #317). Run a clean 3-chapter novel and verify NO regressions vs the L5 LXC smoke baseline.
- **Starting commit:** `9f4879d` (head of synthesis-bundle-v1 branch before this loop)
- **Experiment ID:** TBD — will be assigned via createTuningExperiment
- **Budget cap:** $4
- **Primary lever under test:** End-to-end production smoke validating NER prepass + AND-gate + allowedNewEntities + two-stage adherence all active simultaneously
- **Files/scripts expected to change:**
  - `docs/sessions/2026-05-01-L11-lxc-smoke-ner-prepass.md` (this file)
  - `docs/l11-smoke-ner-prepass-2026-05-01.md` (result doc)
  - `docs/decisions.md` (append L11 entry)
  - `docs/todo.md` (close §2 "Run a clean 3-chapter current-surface drafting sample" if run completed)
- **Evidence artifact:** DB experiment row + phase_eval_runs row, llm_calls telemetry, result doc
- **Stop condition:** ANY of:
  1. 3 chapters drafted clean + summary logged + result doc + decisions.md entry land
  2. Plan-assist gate fires and won't auto-resume → record gate state, mark "blocker recorded"
  3. Cost crosses $4
  4. Deploy script blocks → diagnose root cause, do NOT `--no-verify` past safety check
- **Escalation:** Deploy fails or hangs → stop and diagnose, do not force through

## Baseline

- **L5 LXC smoke baseline (exp #317):** 3 fixtures (1 PASS, 2 FAIL). Two-stage adherence validated: PASS=1 call, FAIL=2 calls. Cost $0.0002.
- **NER prepass code state:** f019c60 wired, 78/78 tests pass, not yet LXC smoke-validated against a full novel run.
- **allowedNewEntities wiring:** Already in index.ts + context.ts (f019c60 + prior). Tests pass. No LXC novel validation yet.
- **Chosen seed:** `fantasy-debt` (lowest historical plan-assist friction; heretic had beat-12 adherence blocker in exp #299; inscription is next-least-risky)

## Command Plan

1. Pre-deploy checks: `git status --short`, LXC process check
2. Deploy: `bash scripts/deploy-lxc.sh`
3. Verify deploy on LXC: grep for runNerPrepass + allowedNewEntities in deployed files
4. Create experiment: `harness.experiments.createTuningExperiment("ticket", ...)`
5. Launch smoke: `bun src/index.ts --auto --seed fantasy-debt --chapters 3` via nohup
6. Monitor every 120-180s
7. Pull telemetry when done
8. Persist phase_eval_runs row
9. Write result doc + decisions entry + todo close
10. Conclude experiment
11. Commit

## Progress Log

- [2026-05-01 now] Loop started. Context file written. LXC is free (only orchestrator server procs).
- [2026-05-02 04:15 UTC] Deploy succeeded (`9f4879d`). NER prepass + allowedNewEntities verified on LXC. Experiment #326 created on LXC (linked to #322, #325, #317). Novel launched: `novel-1777695343246`, seed `fantasy-debt`, 3 chapters.
- [2026-05-02 04:19 UTC] Planning completed. Drafting started (Chapter 1: "The Glowing Ledger", 13 beats).
- [2026-05-02 04:28 UTC] Chapter 1 beat 13/13 completed. Chapter plan checker + continuity running.
- [2026-05-02 04:28:34 UTC] Plan-assist gate fired: `plan-check-exhausted`. 4 unresolved halluc-ungrounded deviations (beats 7, 7, 8, 10 — generic institutional nouns). Loop stop condition (b) triggered.
- [2026-05-02 ~04:32 UTC] Telemetry pulled. phase_eval_runs.id=74 persisted. Experiment 326 concluded. Result doc + decisions.md + todo.md updated. Session doc updated.

## Results

- **Outcome:** BLOCKER-RECORDED (stop condition b: plan-assist gate fired)
- **Novel key:** `novel-1777695343246`
- **Experiment ID:** 326 (concluded)
- **Cost:** $0.0384
- **Chapters completed:** 1/3 (ch1 all 13 beats; ch2-3 blocked by gate)
- **Two-stage adherence:** PASS — stage 2 fired 2×/32 calls, exactly on `events_present=false`
- **allowedNewEntities:** PASS — confirmed in `request_json.groundedSources` for all 30 halluc calls
- **NER prepass:** CODE WIRED — fire-rate not measurable (serialization gap; deferred)
- **plan_assist_gate:** 4 unresolved halluc FPs (generic institutional nouns: "district archive", "trade corporation", "Grand Ledger", "Guild Master") — v3 prompt known FP class from exp #304
- **phase_eval_runs.id:** 74
- **Result doc:** `docs/l11-smoke-ner-prepass-2026-05-01.md`

## Pickup Instructions

- Loop is closed. Gate state recorded in `chapter_exhaustions.id=56`.
- To fully close §2 "Run a clean 3-chapter current-surface drafting sample": address v3→v4 halluc prompt fix for generic institutional nouns (exp #303/#304 residual), then re-run on any seed.
- Do NOT amend prior commits from this session.
