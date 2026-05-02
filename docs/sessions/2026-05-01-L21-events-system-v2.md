---
status: in-progress
updated: 2026-05-01
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

# L21 — EVENTS_SYSTEM v2: Ambient/Mechanical Action Equality

## Loop Contract

- Objective: Lift two-of-three recall from 33% → ≥67% by making the EVENTS_SYSTEM prompt explicit that ambient/mechanical actions are equally obligated as dramatic ones. Keep precision at 100% on labeled panel + embellishment controls.
- Starting commit: HEAD at loop dispatch
- Experiment ID: assigned at runtime (see Progress Log)
- Budget cap: $1
- Primary lever: EVENTS_SYSTEM constant in `src/agents/writer/adherence-checker.ts` (lines 46–63)
- Files expected to change:
  - `src/agents/writer/adherence-checker.ts` (EVENTS_SYSTEM constant)
  - `scripts/hallucination/run-ab-events-system-panel.ts` (new A/B script)
  - `docs/adherence-events-v2-promotion-2026-05-01.md` (A/B result doc)
  - `docs/decisions.md` (append L21 entry)
  - `docs/todo.md` (close §8 item if applicable)
  - `docs/sessions/2026-05-01-L21-events-system-v2.md` (this file)
- Evidence artifact: `/tmp/ab-events-system-<ts>.summary.json`
- Stop condition: (a) v2 promoted + A/B doc + decisions + commit; (b) v2 lifts recall but regresses precision >5% — doc + pivot; (c) cost crosses $1
- Escalation condition: both Approach 1 and Approach 2 wording fail to lift two-of-three recall → structural prompt redesign needed, doc and stop

## Baseline (from L18, exp #337)

- Current EVENTS_SYSTEM: the word "key" in "If ANY key action from the beat is missing" causes implicit salience weighting
- L18 two-of-three recall: 33% (1/3 caught, 2 FNs)
- L18 precision: 100% (0 FPs on any shape)
- Labeled panel (exp #299): 100/100 binary precision+recall (17 adherence rows)
- FN root causes:
  - `two-of-three-fail-01`: Maret asks about the porter's whereabouts — model infers question was implicit; short single-clause omission
  - `two-of-three-fail-02`: Cassel lights candles on the sideboard — purely mechanical action treated as optional ambient detail
- Baseline script: `scripts/hallucination/run-partial-enactment-panel.ts`

## v2 Prompt Approach

Use Approach 1 (positive framing per `feedback_priming_suppression_ab`):

Change: "If ANY key action from the beat is missing, return events_present=false."
To: "If ANY action from the beat is missing, return events_present=false. Treat every listed action as equally obligated regardless of dramatic weight — mechanical or ambient actions (lighting candles, opening doors, asking sub-questions) are as obligated as dramatic actions if the beat specifies them."

Also change the first instruction line from:
"Identify every distinct action or event it specifies"
To:
"Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient"

No negative priming ("NEVER X or Y" patterns avoided). Framing is strictly positive/additive.

## Command Plan

1. Create experiment via DB script
2. Write A/B panel script: `scripts/hallucination/run-ab-events-system-panel.ts`
3. Run A/B against L18 partial-enactment panel + labeled panel
4. Verify: two-of-three recall ≥67% AND precision=100% on labeled panel AND embellishment TN=100%
5. If pass: update EVENTS_SYSTEM in `src/agents/writer/adherence-checker.ts`
6. Run lint + type-check + unit tests
7. Write result doc, update decisions.md + todo.md
8. Conclude experiment
9. Commit

## Progress Log

- [x] Session context file written
- [x] Experiment created in DB (#338)
- [x] A/B script written: `scripts/hallucination/run-ab-events-system-panel.ts` (v1/v2/v3)
- [x] A/B run complete (phase_eval_runs.id=81)
- [x] Verdict: v2 PROMOTED
- [x] EVENTS_SYSTEM updated in `src/agents/writer/adherence-checker.ts`
- [x] Lint (0 errors), tsc (clean), bun test 47/47 pass
- [x] Docs: result doc, decisions.md L21, todo.md §8 closed
- [x] Experiment #338 concluded
- [ ] Commit landed

## Key Findings

1. **two-of-three-fail-02 (candle-lighting) is a model-level failure.** In v2/v3, the model's reasoning correctly says "lighting candles is omitted, so the beat is not fully enacted" but `events_present=true`. This is a DeepSeek V4 Flash reasoning-verdict self-consistency failure for ambient/mechanical actions.

2. **Reasoning-first JSON (v4-v7) fixes the candle case but causes 3 FPs** on labeled panel (precision drops to 57%). The "enacted" definition in v4 is too strict for physical causal-chain implied actions (b4: door-entry, b6: gaze-sweep).

3. **v2 is the best achievable wording-only fix.** Two-of-three recall is 67% (1/3 cases still FN: candle), labeled panel 100%/100%, embellishment TN=100%, lint clean.

4. **Run-to-run variance on two-of-three:** L18 showed 33%, L21 runs show 67%. The difference is fail-01 (porter question) is caught consistently in L21. The candle case is the sole persistent FN.

## Results

- Outcome: v2 PROMOTED — prompt updated in src/agents/writer/adherence-checker.ts
- Evidence: `/tmp/ab-events-system-20260502T015113.summary.json` (phase_eval_runs.id=81)
- Cost: ~$0.006 (4 panel runs)
- Commit(s): TBD

## Pickup Instructions

- Last safe state: EVENTS_SYSTEM updated, docs updated, experiment #338 concluded. Commit pending.
- Next action: commit all changes; L22 deploy + smoke novel run
