---
status: complete
updated: 2026-05-01
duration: ~1h
commits: 3
subagents_spawned: 0

# ── Workflow telemetry ─────────────────────────────────────────────────────
wall_clock_min: 0
codex_reviews: 0
rework_passes: 0
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# L18: Synthetic Partial-Enactment Adherence Fixtures — Per-shape Matrix — 2026-05-01

## Context

This session is an unattended panel-build loop. The goal is to expand the adherence-events
evidence base beyond the single b12 Cassel/Maret partial-enactment cluster (1 row in the
labeled panel). The L5 two-stage checker was validated against that panel in L8 (exp #324),
but the partial-enactment case was represented by only 3 rows — too narrow to claim per-shape
discrimination.

This loop adds 9 FAIL fixtures across 3 shapes + 3 PASS controls, runs the live two-stage
`checkBeatAdherence` (commit ae50e99) on the panel, and persists a per-shape recall/precision
matrix to `phase_eval_runs`.

**Parent experiments:** exp #317 (two-stage wiring), exp #324 (L8 panel validation).

## Loop Contract

- **Acceptance:** 6+ FAIL fixtures across 3 shapes + 3+ PASS controls → JSONL panel; live
  two-stage checker run; per-shape recall/precision matrix persisted; result doc + decisions.md
  + todo close + commit.
- **Budget cap:** $1.
- **Starting commit:** 2c46924
- **DO NOT DEPLOY** (L17 running in parallel).
- **DO NOT modify runtime files** (`src/agents/writer/adherence-checker.ts`). Panel + script +
  docs only. If the run reveals a checker bug, document and propose a fix as a follow-up.

## Fixture Shapes

1. **two-of-three** — beat lists 3 required events; prose enacts only 2.
   - FAIL-01: Maret accepts ledger, asks about porter, then leaves → prose skips porter question
   - FAIL-02: Cassel sets table, lights candles, opens brief → prose skips candles
   - FAIL-03: Rael unlocks chest, counts the coin, seals it back → prose skips counting
   - PASS: all 3 events enacted with embellishment

2. **reversed-order** — beat specifies ordered events; prose reorders in a causality-breaking way.
   - FAIL-01: Sara unlocks door → sees body → calls for help; prose calls for help first
   - FAIL-02: Mage casts binding → drains well → collapses; prose drains first then casts
   - FAIL-03: Cassel reads the brief → hands it to Maret → walks out; prose walks out before handing
   - PASS: reordering of parallel/non-causal actions (draws sword + shouts — order irrelevant)

3. **substituted-actor** — beat assigns action to Character A; prose has Character B do it.
   - FAIL-01: Maret hands porter the key → Cassel hands porter the key
   - FAIL-02: Captain reads verdict aloud → Lieutenant reads verdict aloud
   - FAIL-03: Rael slides the ledger across the table → the porter slides the ledger
   - PASS: named actor does the action with full embellishment

4. **acceptable-embellishment** PASS controls (separate):
   - Cassel asks Maret about the discrepancy → prose adds "voice tight with concern" + hesitation
   - Sara opens the box → prose unlatches with cinematic detail

## Key Files

- Panel: `scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl`
- Run script: `scripts/hallucination/run-partial-enactment-panel.ts`
- Results: `/tmp/partial-enactment-panel-results.<TIMESTAMP>.jsonl` + `.summary.json`
- Result doc: `docs/partial-enactment-adherence-panel-2026-05-01.md`
- Experiment: tracked in `tuning_experiments`; persisted to `phase_eval_runs`

## Status

[x] Session doc written
[x] Fixture JSONL built
[x] Run script built
[x] Experiment created (DB) — exp #337
[x] Panel run completed — phase_eval_runs.id=79
[x] Per-shape matrix computed
[x] phase_eval_runs row persisted
[x] Result doc written — docs/partial-enactment-adherence-panel-2026-05-01.md
[x] decisions.md appended — L18 entry
[x] todo.md updated — §8 item closed + 2 follow-up prompt-iteration items added
[x] Committed (3 commits: dc1ceda, 6279f84, 3489257)

## Pickup Instructions

- If script fails: check DB connectivity (`src/db/connection.ts` → Postgres on LXC).
- If checker crashes on a fixture: capture error, document in result doc, stop per stop-condition (b).
- Cost gate: check `SELECT SUM(cost_usd) FROM llm_calls WHERE novel_id LIKE 'partial-enact%'` after run.
