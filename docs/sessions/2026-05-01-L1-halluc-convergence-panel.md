---
status: completed
updated: 2026-05-01
role: overnight-loop-context
loop: L1-halluc-convergence-panel
---

# L1 — Hallucination Checker 1x/3x/5x Convergence Panel

## Loop Contract

- **Objective:** Measure whether running the `halluc-ungrounded` checker N times in parallel and combining via vote thresholds (1-of-1 / 1-of-3 / 2-of-3 / 3-of-3 / 1-of-5 / 2-of-5 / 3-of-5 / 4-of-5 / 5-of-5) lifts recall meaningfully without proportionally inflating false positives. Per `docs/todo.md` §7 + the user's directive to accumulate statistically significant data with cheap DeepSeek V4 Flash calls.
- **Starting commit:** `24baec2` (post overnight-loop-template; HEAD as of loop start)
- **Experiment ID:** TBD — will create `harness.experiments.createTuningExperiment("ticket", ...)` with type "checker-convergence-halluc-v1" and link the persisted result row.
- **Budget cap:** $8 — DeepSeek V4 Flash is the cheap route (~$0.20 / 1M output for the standard tier per memory `feedback_query_llm_calls_for_costs`). 50 panel rows × 5 calls × ~512 output tokens ≈ 128K tokens ≈ $0.10 — well under cap. Even at 200 rows we stay <$1.
- **Primary lever under test:** Number of independent halluc-ungrounded calls per row (1, 3, 5) and the vote threshold for declaring "fail".
- **Files/scripts expected to change:**
  - `scripts/hallucination/convergence-eval.ts` (new) — orchestrates N parallel calls per row, persists per-row vote table.
  - `docs/halluc-convergence-results-2026-05-01.md` (new) — narrative writeup with per-class recall/precision matrix.
  - `docs/decisions.md` — append a "Halluc convergence panel — N=? results" entry.
- **Evidence artifact:** `/tmp/halluc-convergence-<timestamp>.jsonl` on LXC (per-row votes + verdict per threshold) + the persisted DB experiment row. Filename will be timestamped per `feedback_no_overwrite_runs`.
- **Stop condition:** ANY of:
  1. Convergence JSONL persisted + decisions.md entry committed + experiment concluded.
  2. Cost crosses $4 without a clean signal — reduce panel size or stop and document.
  3. Halluc checker route returns >5% errors (transport flake / DeepSeek throttle) — pause + diagnose.
- **Escalation condition:** Convergence shows NO meaningful recall lift even at 5-of-5 → run ONE follow-up loop testing higher temperature (0.3 vs 0.1) before recommending the convergence approach be parked.

## Baseline

- **Current behavior:** Production `halluc-ungrounded` runs ONE call per beat with temp=0.1, maxTokens=512. Per `docs/halluc-v3-production-report-2026-04-20.md`, ~70% recall on labeled current-surface panel.
- **Baseline command(s):** `bun scripts/hallucination/ab-halluc-prompt.ts --in <panel.jsonl> --candidate <baseline-system.md> --out <result.jsonl>` is the existing per-row caller (per Explore subagent inventory).
- **Baseline result:** Recall 0.70 on adjudicated current-surface panel (per v3 production report). To re-confirm under V4 Flash, the convergence script will compute 1-of-1 alongside multi-call results so we get the matched baseline in the same run.

## Command Plan

1. **Build a fresh current-surface panel on LXC** (50 rows + 30 synthetic from 6 entity classes once L3 lands):
   ```
   ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/hallucination/current-surface-manifest.ts --out /tmp/current-surface.json"
   ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/hallucination/build-current-surface-panel.ts --run-id <recent-run-id> --surface /tmp/current-surface.json --out /tmp/halluc-current-panel-<ts>.jsonl --limit 50 --synthetic-per-kind 5"
   ```
2. **Implement convergence-eval.ts** — runs N independent calls per row in parallel (per row, not across rows; ~5 panel rows in flight at a time to stay polite to DeepSeek throttle).
3. **Run convergence eval on LXC** with N=1, 3, 5 + `nohup` + log to `/tmp/halluc-convergence-<ts>.log`.
4. **Verification command(s):**
   - `ssh novel-harness-lxc "tail -n 20 /tmp/halluc-convergence-<ts>.log"` — sanity check progress.
   - `ssh novel-harness-lxc "wc -l /tmp/halluc-convergence-<ts>.jsonl"` — row count check.
   - Aggregate analysis script (or inline jq) to compute per-class precision/recall + agreement matrix.

## Progress Log

- 2026-05-01 02:55Z — Context file created. Inventory complete (Explore subagent confirmed `ab-halluc-prompt.ts` + `build-current-surface-panel.ts` are the canonical scripts; route is DeepSeek V4 Flash).
- L2/L3/L4 Sonnet subagents dispatched in parallel — they touch `src/agents/halluc-ungrounded/`, `scripts/hallucination/build-current-surface-panel.ts` (synthetic fixture expansion), and `src/lint/entity-candidates.ts` respectively.

## Results

- **Outcome:** SIGNAL-CONFIRMED-NOT-YET-PROMOTION-GRADE. Convergence at T=0.5 N=5 lifts F1 by 5-13% relative across both panels. Best operating point depends on class composition (k=3 on natural-mixed, k=1 on synthetic-only). Promotion blocked on (a) natural-adjudicated bigger panel rerun, (b) L4 NER calibration to crack systematic errors.
- **Evidence link/row/path:** `tuning_experiments.id=316` (concluded). `phase_eval_runs.id=56,57,58,59`. Per-row JSONL: `/tmp/halluc-convergence-N5-T0{1,5}-...jsonl` and `/tmp/halluc-convergence-big-N5-T0{1,5}-...jsonl`. Result doc: `docs/halluc-convergence-results-2026-05-01.md`.
- **Cost:** ~$0.20 across 670 DeepSeek V4 Flash calls (4 panel runs × ~167 calls each). Well under the $8 cap.
- **Commit(s):** TBD — L1 results + decisions entry + this context update get committed together.

## Pickup Instructions

- **Last safe command:** All four convergence runs persisted; experiment concluded; result doc written. Loop is closed.
- **If failed, failure fingerprint:** N/A.
- **Next action:** Move to L1-followup (adjudicate natural rows in big panel) AND L5 (adherence two-stage) in parallel. L1 itself is done.
