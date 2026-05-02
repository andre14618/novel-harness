---
status: pending
updated: 2026-05-01
role: overnight-loop-context
loop: L5-adherence-two-stage
---

# L5 — Two-stage Adherence Wiring (Binary First, Per-event on FAIL)

## Loop Contract

- **Objective:** Implement the docs/todo.md §8 backlog item: "Wire two-stage adherence only on binary failure. Keep the current binary `adherence-events` as the first pass; invoke the per-event prototype only when binary says events are missing." Acceptance: no extra LLM call on pass cases, and failure cases return quote-backed missing-event detail. The motivation is that binary adherence is fast and cheap; the detailed per-event LLM call (which produces actionable retry hints) is only worth running when we already know an event is missing.
- **Starting commit:** TBD — set when loop opens. Must be after L1/L2/L3/L4 land.
- **Experiment ID:** TBD — `harness.experiments.createTuningExperiment("ticket", ...)` with description noting binary-then-detailed-on-fail two-stage shape.
- **Budget cap:** $4. The two-stage wiring itself is a code change with no LLM calls. The validation run (3-chapter smoke + per-row inspection) burns small DeepSeek V4 Flash spend.
- **Primary lever under test:** Two-stage call ordering — binary first (existing path), per-event detailed call ONLY when binary says fail.
- **Files/scripts expected to change:**
  - `src/agents/<adherence-related-agent>/index.ts` (TBD by recon — likely `src/agents/chapter-plan-checker/` or `src/lint/adherence-events.ts` or similar).
  - Possibly a new schema in `src/agents/<adherence>/schema.ts` for the per-event detailed output.
  - `src/agents/<adherence>/index.test.ts` — unit test asserting per-event call is NOT made when binary returns pass.
  - `docs/decisions.md` — append two-stage adherence wiring entry.
- **Evidence artifact:** `/tmp/adherence-two-stage-validation-<ts>.log` from a 3-chapter smoke run, showing call counts (binary=K, per-event=M, M < K) + total cost.
- **Stop condition:** ANY of:
  1. Two-stage code lands, unit test passes, smoke run validates per-event call count strictly less than binary call count, decisions.md entry committed.
  2. Recon shows the existing adherence-events checker isn't structured for two-stage (e.g., it's a single LLM call that ALREADY returns per-event detail) — pivot to documenting the "no-op needed" finding.
  3. Cost crosses $3 without smoke validation — stop and document.
- **Escalation condition:** Two-stage actually INCREASES cost (because per-event is more expensive than binary AND fails frequently) → re-baseline binary-only and document the trade-off.

## Baseline

- **Current behavior:** TBD by recon. Hypothesis: the current adherence-events checker is a single LLM call that returns either pass or a list of issues. The "two-stage" intent is to split this so the binary pass/fail call is small (cheap), and only the detailed quote-and-missing-event call runs on fail.
- **Baseline command(s):** TBD — likely `bun scripts/hallucination/probe-obligation-aware-adherence.ts` or similar.
- **Baseline result:** TBD — record per-call latency + token cost + accuracy.

## Command Plan

1. **Recon:** Find the live adherence-events checker. Likely candidates:
   - `src/agents/chapter-plan-checker/` (the SFT-distilled adherence checker per memory `project_chapter_plan_checker_finetune`)
   - `src/lint/adherence-events.ts` or similar
2. **Read recon files** to understand current call shape.
3. **Implement two-stage wiring** OR document why it's already that shape OR pivot.
4. **Add unit test** asserting per-event call is gated on binary fail.
5. **Smoke validate** with a 3-chapter run, recording call counts.

## Progress Log

- 2026-05-01 03:05Z — Context file created (placeholder until Wave 2 starts).

## Results

- TBD

## Pickup Instructions

- Loop is queued. To begin: read this file, then run recon to find the live adherence-events checker location.
