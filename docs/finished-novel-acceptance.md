# Finished Novel Acceptance

This is the canonical operator checklist for declaring a novel run "good enough finished." It exists so autonomous lanes do not improve local blockers without knowing which evidence closes the product loop.

The acceptance contract is built only from existing commands, telemetry, and persisted evidence. No new judgment models are introduced here. Subjective prose quality is recorded as a human read-through requirement rather than a checker.

## How To Use This Doc

1. Run the gates in the order listed below. Each gate is independent; skip none.
2. Record the artifact path / DB row / commit referenced in each gate's "Evidence" line into the run summary.
3. If a gate fails, take the listed failure action. Do not silently accept a fail.
4. Once all gates pass, classify the run via `Final Decision` at the bottom.

A run is "accepted" only when:

- All automatically checkable gates (1–7) report PASS for the same novel id and commit, and
- A human read-through (gate 8) records GO with notes saved alongside the run.

A run is "rejected" if any gate fires its `reject` action.

A run is "needs-human" if any gate is ambiguous or cannot be classified locally — the run is paused, not approved.

## Acceptance Gates

### Gate 1 — Static health (TypeScript, build, narrow tests)

- Question: does the runtime build cleanly at the run commit?
- Command:
  - `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit`
  - `./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit`
  - `bun build --target bun src/index.ts --outfile /tmp/index.js`
  - `bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js`
  - `bun test src/` (narrow runtime tests; broader `bun test` if the touched surface warrants it)
- Evidence: command exit codes, captured stdout/stderr.
- PASS: all four tsc/build commands exit 0; runtime tests have zero new failures vs. the documented `BASELINE_TEST_FAILURES = 0` baseline.
- FAIL: any non-zero exit. Action: reject the run; fix or revert before re-running the full novel.
- Owner: automated; lane runner / preflight loop.

### Gate 2 — Preflight invariants and docs-impact discipline

- Question: do the structural invariants and docs-impact policy hold for the run commit?
- Command:
  - `bun scripts/preflight.ts`
  - `bun scripts/preflight-docs-impact.ts --strict`
- Evidence: preflight stdout (records the five live invariants from `docs/invariants.md`); docs-impact output for the commit range that introduced the run's runtime.
- PASS: both commands exit 0.
- FAIL: any non-zero exit. Action: reject the run; do not accept finished output produced by code that fails preflight or skipped docs-impact reconciliation. See `docs/current-state.md` § Preflight Invariants.
- Owner: automated.

### Gate 3 — Lane and stop-gate hygiene

- Question: did the autonomous run record an explicit stop reason for any incomplete lane, and is the lane queue clean?
- Command: `bun scripts/agent/lane-status.ts <lane-doc>` (or `lane-dashboard` for a multi-panel view).
- Evidence: lane event log (`output/agent-runs/<lane-id>/events.jsonl`), `Results:` block in the lane doc.
- PASS: status is `stop` or `continue` with a populated `Results: Outcome / Stop gate fired / Evidence / Commit / Review` block.
- FAIL: status is `blocked`, `human-needed`, or `infra-failure`; OR the lane doc has incomplete Results fields. Action: classify per `docs/agent-lane-protocol.md`; resolve or escalate before approving the produced novel.
- Owner: automated detection; human-needed dispositions surface to the operator.

### Gate 4 — Run-level smoke stop classification

- Question: did the novel run end in a clean stop, a known design-class blocker, or something worse?
- Command:
  - `bun scripts/operator-summary.ts <novel-id> --json | bun scripts/agent/smoke-stop-classifier.ts --known-kinds <kinds>`
  - or: `bun scripts/operator-summary.ts <novel-id> --json > out.json && bun scripts/agent/smoke-stop-classifier.ts --input out.json`
- Evidence: classifier JSON (`{classification, reason, evidence}`); operator-summary JSON snapshot for the same novel id.
- PASS: classification is `clean_pass`.
- HOLD: classification is `human_needed` — the run cannot be auto-accepted, but is not auto-rejected either. Action: operator review required.
- FAIL: classification is `regression` or `new_blocker` (with no resolved gate covering the kind) or `infra_failure`. Action: reject the run; route to the appropriate lane for the dominant blocker.
- Owner: automated classification; operator dispositions any `human_needed`.

### Gate 5 — Plan-assist gate resolution

- Question: are all plan-assist exhaustion gates for the run resolved before approval?
- Command:
  - `bun scripts/operator-summary.ts <novel-id>` (look at the Plan-assist Gates section)
  - `bun scripts/operator-summary.ts --stale-gates --min-age-hours 0` for cross-novel sweep
  - `bun scripts/agent/resolve-stale-gates.ts ... --apply` only after a dry-run review and a documented reason.
- Evidence: `chapter_exhaustions` rows for the novel id; resolver dry-run output if used.
- PASS: every `chapter_exhaustions` row for the novel has `decision IS NOT NULL` and a non-empty `decision_details` reason.
- FAIL: any pending or denied gate without a recorded operator response. Action: resolve via `/api/novel/resume` paths or mark `orphaned` with a documented reason; never delete rows.
- Owner: operator; resolver script enforces dry-run-first.

### Gate 6 — Prose integrity and adherence floor (per-attempt evidence)

- Question: did the runtime never accept malformed prose or silently drop unresolved blockers?
- Command:
  - `bun scripts/operator-summary.ts <novel-id> --json` — inspect `agentCosts[*].failed_calls` for `lint-fix-rejected` / `prose-integrity-check` patterns and `exhaustions[]` for unresolved blocker kinds.
  - Spot check `pipeline_events` for `adherence-stage2-override` and `lint-fix-rejected` traces if needed.
- Evidence: operator-summary JSON; `pipeline_events` rows for the novel id.
- PASS: zero `lint-fix-rejected` / `prose-integrity-check` events that did not eventually retry to a passing chapter; zero accepted-blocker-after-retry-exhaustion rows that bypassed the plan-assist gate (per the policy in `docs/current-state.md` § Active quality controls).
- FAIL: any accepted malformed-prose chapter or any blocker silently appended to the approved draft. Action: reject; runtime regression — open a lane against `src/phases/drafting.ts` or `src/lint/integrity.ts`.
- Owner: automated; manual spot-checks if telemetry is missing.

### Gate 7 — Calibration freshness for blocking checkers

- Question: are the checkers that gated this run currently passing their calibration panels at the run commit?
- Command:
  - `bun scripts/agent/replay-first-plan.ts <panel.jsonl>` to plan the replay.
  - `bun scripts/phase-eval/list-runs.ts --probe halluc-synthetic-fire-rate` and `--probe adherence-per-event-prototype` for the latest persisted recall/precision.
  - `bun scripts/phase-eval/list-runs.ts` family-rollup for any planner prompt that affected this run; require multi-run promotion eligibility per `docs/experiment-design-rules.md` §12.
- Evidence: `phase_eval_runs` rows; replay plan output; `docs/decisions.md` entry for the in-force checker version.
- PASS: each blocking checker version used by the run has a recent (within last commit window) panel pass meeting the documented thresholds, AND prompt-promoted variants have ≥1 prior consecutive PASS at the same probe-family tuple (`SCREEN-PASS-SUGGESTIVE` alone is not enough).
- FAIL: a blocking checker is running with a stale or below-threshold panel. Action: reject finished acceptance until the checker is re-calibrated or downgraded to warning-class per `docs/current-state.md`.
- Owner: automated where panels exist; lane-class work to extend coverage where they don't.

### Gate 8 — Human read-through (non-encodable subjective acceptance)

- Question: does the finished novel read as a coherent, on-spec story by an experienced reader?
- Command: human read; no automated substitute.
- Evidence: a written read-through note saved at `docs/sessions/<date>-<novel-id>-readthrough.md` (or appended to the run lane doc) covering: opening grip, midpoint payoff, ending payoff, voice consistency, character distinctness, and any continuity surprises that did not fire as checker blockers.
- GO: read-through records "ship-grade" or equivalent.
- HOLD: read-through identifies issues that map to existing checker categories — open lanes against those checkers; this run is not finished but the system is not necessarily broken.
- NO-GO: read-through identifies issues with no checker category — the failure must be either (a) escalated as a new lane to add or recalibrate a checker, or (b) recorded as an explicit acceptable warning class (per the lane escalation rule, do not create broad style checkers).
- Owner: human reader (operator). Subjective by design; not encoded.

## Failure Mode → Action Map

| Failure | Source gate | Action |
|---|---|---|
| Build / typecheck regression | Gate 1 | Reject; revert or fix before any acceptance |
| Preflight invariant fail | Gate 2 | Reject; treat as runtime regression |
| Docs-impact discipline miss | Gate 2 | Reject acceptance; co-stage `docs/current-state.md` or add `docs-impact: none` per `docs/commit-conventions.md` |
| Lane status `blocked` / `human-needed` / `infra-failure` | Gate 3 | Classify per `docs/agent-lane-protocol.md`; resolve before declaring finished |
| Smoke-stop `regression` | Gate 4 | Reject; open lane against the dominant blocker |
| Smoke-stop `new_blocker` (unknown kind) | Gate 4 | Reject; design-class lane |
| Smoke-stop `infra_failure` | Gate 4 | Re-run on healthy infra; do not blame the model |
| Smoke-stop `human_needed` | Gate 4 | Operator decides; document the resolution |
| Pending plan-assist gate | Gate 5 | Resolve via resume route or mark orphaned with reason; never delete |
| Accepted malformed prose / blocker-bypass | Gate 6 | Reject; runtime regression lane |
| Stale or below-threshold checker calibration | Gate 7 | Reject; re-calibrate panel before claiming acceptance |
| Read-through NO-GO / HOLD | Gate 8 | Lane against the named issue OR explicit recorded warning class |

## Final Decision

After running gates 1–7, the smoke-stop classifier output (gate 4) is the single most-load-bearing automatic signal. After running gate 8, the human read-through is the single most-load-bearing subjective signal. The combined decision rule:

- **accept** — all of gates 1–7 PASS and gate 8 is GO.
- **reject** — any of gates 1–7 reports FAIL, or gate 8 is NO-GO.
- **needs-human** — gates 1–7 are all PASS or HOLD with at least one HOLD (e.g., smoke-stop `human_needed`, lane `human-needed`), or gate 8 is HOLD. The run is paused for operator decision; it is not auto-approved.

Record the final decision and the per-gate evidence references in the run lane doc's `Results:` block. The lane runner's review-evidence requirement (`docs/agent-lane-protocol.md`, L57) keeps this honest: queued autonomous advancement does not occur until `Results: Review` is populated.

## Out Of Scope For This Doc

- New checker designs, severity changes, or model swaps. Those are runtime-lane work, not acceptance policy.
- Generic 1–10 prose scoring. Quality is measured by the structured gates above plus the human read-through.
- Long-term style theory or craft frameworks. Per `docs/current-state.md` § Current Improvement Philosophy, those are explicitly not the lever.
- New corpus-leak checkers. Per `CLAUDE.md` § Strategic Constraints, those require a re-authorized writer-LoRA route.

## Cross-References

- `docs/current-state.md` § Active quality controls, § Canonical Verification Gates, § Preflight Invariants
- `docs/agent-lane-protocol.md` — lane status / heartbeat / dashboard
- `docs/overnight-runbook.md` — unattended loop preconditions and post-session audit
- `docs/experiment-design-rules.md` §12 — promotion thresholds and probe-family discipline
- `docs/commit-conventions.md` — docs-impact policy
- `docs/invariants.md` — structural-property check registry
- `scripts/operator-summary.ts`, `scripts/agent/smoke-stop-classifier.ts`, `scripts/agent/lane-status.ts`, `scripts/phase-eval/list-runs.ts`, `scripts/agent/replay-first-plan.ts`, `scripts/preflight.ts`, `scripts/preflight-docs-impact.ts`
