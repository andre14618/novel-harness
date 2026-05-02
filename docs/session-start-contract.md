---
status: active
updated: 2026-05-02
role: session-start-contract
---

# Session Start Contract

Every working session opens with a single durable answer to four questions. Write them down before any code or runtime action. If a question can't be answered, the session is exploration — say so and bound it before drifting into changes.

This contract sits one level above a lane: a session may contain one or more lanes, but the session goal must be explicit, single-component, and measurable. Lanes are how a session executes; the contract is what the session *is*.

## Four Questions

1. **Goal + component.** One sentence naming the concrete behavioral change and the single component (file/agent/checker/script) it lives in. "Improve the harness" is not a goal. "Fix `detectFusedBoundaries` in `src/lint/integrity.ts` so LitRPG System UIDs no longer fire" is.

2. **Why.** One sentence citing the evidence that motivates the work — an experiment ID, a smoke result, a calibration row, a user request. "Vibes" is not a why. "L61 exp #384 bailed at ch1 with 8 fused-boundary issues, all on `SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.`" is.

3. **What is measurable.** Name the signal that will tell us the change worked, and the artifact that will hold the evidence. Unit fixture pass/fail, paired-replay blocker count, AND-gate matrix delta, fixed-panel F1, smoke-stop classifier verdict. If the only signal is "feels better," stop.

4. **Validated gates.** Name the stop gates from `docs/current-state.md` Loop architecture (a clean pass / b new dominant blocker / c regression / d infrastructure failure / e budget cap) and write down what specifically fires each one for this work. Include the verification command(s).

## Session Doc

Capture the four answers in a session doc under `docs/sessions/YYYY-MM-DD-<short-session-name>.md` using the lane template (`docs/sessions/overnight-loop-context-template.md`). The session doc is the durable contract. Chat history is not.

If the session opens multiple lanes, each lane has its own lane doc and inherits the session goal; the session doc tracks the queue and the cross-lane evidence.

## Anti-Patterns

- Mixing two component goals in one session ("fix integrity guard AND retrain the writer prompt"). Split into separate sessions or sequential lanes.
- Starting work before naming the measurable signal. The signal often forces the goal to be more specific.
- Letting "support work" (tests, docs, helpers) become the session goal. Support work belongs to a primary goal; if it stands alone, name a measurable goal for it ("preflight catches X regression class").
- Treating exploration as if it had a stop gate. Exploration sessions have a budget and an artifact (a result doc, a probe panel) — not a clean-pass criterion.
- Skipping the documentation sweep at the end. The sweep is part of the gate, not optional polish.

## End-of-Work Documentation Sweep

This sweep is mandatory before declaring a session or lane finished. Treat it as part of the (a) clean-pass criterion, not a separate checklist:

- `docs/current-state.md` — co-stage with any runtime behavior change, or footer the commit `docs-impact: none`.
- `docs/decisions.md` — append the §Lxx entry for promoted/refuted/superseded decisions.
- `docs/todo.md` — close the completed item, queue any new follow-up.
- `docs/lessons-learned.md` — append a generalized "when X, then Y" lesson when a methodology surprise or near-miss occurred. **A failure-mode unit fixture that caught an over-relaxed implementation is a lesson.** A reusable pattern that future sessions could lean on is a lesson.
- Lane doc `Results` — fill Outcome, Stop gate fired, Evidence, Cost, Commits, Review.
- `tuning_experiments` — conclude the experiment row with a one-paragraph summary citing the runtime commit.
- Session/lane queue (`docs/sessions/lane-queue.md`) — advance Active/Next/Completed.

Run before commit: `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`, the touched test surface (`bun test <path>`), and `bunx tsc --noEmit` if any `.ts` changed.

## Cost-Threshold Autonomy

Runtime actions cost money. To avoid stalling on permission requests for cheap work, the standing rule is:

- **< $2 per run:** proceed without asking. This includes deploy + smoke + paired-replay + local DB writes for normal lanes. Confirm budget by checking the prior similar run's cost in `llm_calls` or `operator-summary --json`.
- **≥ $2 per run, or anything touching shared/external state:** ask first. This includes multi-seed sweeps, panel re-labeling that fires hundreds of subagent calls, and anything that touches the LXC orchestrator service config or shared infra.
- **Hard cap:** the standing $26 overnight budget from `docs/todo.md` §6 still applies; cumulative cheap runs that approach the cap require a check-in.

If a run unexpectedly exceeds its quote (e.g. retries balloon cost), record the actual in the lane doc and pause before continuing.

## Cross-References

- `docs/interactive-claude-captain-loop.md` — captain loop and subagent pattern
- `docs/sessions/overnight-loop-context-template.md` — lane doc template (inherits session goal)
- `docs/harness-next-work-process.md` — picking the next lane after a session/queue stops
- `docs/overnight-runbook.md` — operating rules for unattended runs
- `docs/finished-novel-acceptance.md` — product-level acceptance gates
