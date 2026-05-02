---
status: active
updated: 2026-05-02
role: harness-work-selection-process
---

# Harness Next Work Process

Use this when the autonomous engineering queue is empty or when deciding what harness lane should run next. The goal is to turn the backlog into one specific, reviewable lane without mixing runtime levers.

## Trigger

Run this process when any of these are true:

- `monitor` shows the active queue has stopped with no next lane.
- The current lane produced a new blocker that is outside its scope.
- The user asks what to work on next for the harness itself.
- A morning pickup needs a concrete lane queue rather than a broad backlog scan.

## Inputs

Read these in order:

1. `monitor` for live lane/process state.
2. `docs/current-state.md` for the live architecture and active constraints.
3. `docs/todo.md` sections 7-12 for pending harness work.
4. `docs/decisions.md` recent session entries for closed paths and rationale.
5. `docs/lessons-learned.md` only when a candidate repeats a known failure pattern.
6. `docs/experiment-design-rules.md` for promotion/review/evidence gates.

Do not use chat memory as the source of truth.

## Triage Buckets

Classify every plausible next item into exactly one bucket:

- **Runtime blocker removal:** fixes a known reason novel generation stops or corrupts output.
- **Replay/eval infrastructure:** lets us reject or validate runtime changes before live LXC spend.
- **Checker calibration:** changes blocker/warning policy only after labeled evidence.
- **Phase-eval reliability:** improves planner-prompt promotion trustworthiness.
- **Product acceptance:** defines or verifies what “good enough finished novel” means.
- **Operator/autonomy guardrail:** improves unattended execution, monitoring, review, or recovery.

If an item fits multiple buckets, split it. A lane should own one bucket and one causal hypothesis.

## Specificity Gate

A candidate is not lane-ready until it has all of these:

- One sentence objective.
- Baseline command or observed failure.
- One changed lever, or `None` for support tooling.
- Feedback signal that can be checked locally, by fixed panel, paired replay, or one declared smoke.
- Stop gates covering clean pass, new blocker/scope split, regression, infra failure, and cost cap.
- Experiment ID.
- Files/scripts expected to change.
- Review plan: `impl-review <sha> PASS` or explicit waiver path.

If any field is missing, the next lane is a triage/investigation lane, not an implementation lane.

## Ranking Rubric

Score each lane-ready candidate from 0-2 on each dimension:

- **Impact:** 2 blocks finished novels or unsafe autonomy; 1 improves interpretation/cost; 0 cosmetic.
- **Evidence readiness:** 2 has saved artifacts/panels/tests; 1 needs small fixture build; 0 needs broad exploration.
- **Autonomy fit:** 2 can run local/replay with clear stop gates; 1 needs one LXC smoke; 0 needs live user judgment.
- **Attribution cleanliness:** 2 changes one lever; 1 support-only; 0 bundles unrelated runtime changes.
- **Reviewability:** 2 small diff with deterministic tests; 1 moderate diff; 0 broad refactor.

Pick the highest total. Break ties by choosing the candidate that improves future evidence quality before spending more live-generation budget.

## Output

Produce exactly one primary lane and up to two queued follow-ups.

For each selected lane, create or update a `docs/sessions/YYYY-MM-DD-L<N>-<slug>.md` file using `docs/sessions/overnight-loop-context-template.md`. Then update `docs/sessions/lane-queue.md`.

The primary lane must have:

- `Experiment ID`
- `Files/scripts expected to change`
- `Evidence artifact`
- `Dashboard command: monitor`
- `Runner command`
- empty `Results: Review`

Do not launch the runner until `bun scripts/agent/preflight-loop.ts <lane> --allow-dirty` passes intentionally, or without `--allow-dirty` on a clean tree.

## Current Candidate Lanes

As of 2026-05-02, these are the strongest next harness lanes:

1. **Replay-first harness (L48 backlog):** build a helper that replays saved `llm_calls` or fixed-panel rows against candidate checker/prompt policies with cost accounting. Bucket: replay/eval infrastructure. Why first: it reduces live LXC spend and makes future checker/prompt changes more attribution-clean. **Status 2026-05-02:** L59 shipped the MVP — `bun scripts/agent/replay-first-plan.ts <panel.jsonl>` inventories the two tracked fixture panels (halluc-ungrounded, adherence-events) and prints the exact replay command. DB-backed `llm_calls` replay is still queued.
2. **Robust finished product acceptance criteria:** define concrete gates for a finished novel run: clean preflight, no malformed prose, no unresolved blocker accepted silently, checker panels above thresholds, and one complete run with evidence. Bucket: product acceptance. Why next: it tells autonomous lanes what “done” means.
3. **End-to-end smoke novel after hardening:** run one seed likely to complete and record cost, wall time, checker fires, gates, integrity, and read-through notes. Bucket: runtime blocker discovery. Why next: it finds the next actual blocker after the L31-L56 hardening stack.
4. **Functional-state warning calibration panel:** collect natural current-surface warnings and label quote-required oracle judgments. Bucket: checker calibration. Why next: it is required before any semantic planned-state warning becomes blocker-class.
5. **Phase-eval stochastic beat-floor retry policy:** add one retry for stochastic beat-floor failures while preserving visibility of structural invalidity. Bucket: phase-eval reliability. Why next: it reduces noisy false FAILs in planner-prompt promotion.

The default next primary lane should be **Replay-first harness** unless a fresh `monitor`/smoke result shows an urgent runtime blocker. The 2026-05-02 application of this process created L59 replay-first harness, L60 finished-product acceptance, and L61 end-to-end smoke after hardening.

## Review And Closeout

Before stop/queue handoff:

- Commit the implementation.
- Run independent commit-pinned review where available: `impl-review <sha> PASS`.
- If independent review is not available, record an explicit waiver in `Results: Review` with reviewer and reason.
- Fill Results fields, conclude the experiment, run docs-impact/whitespace checks, and commit final docs.
