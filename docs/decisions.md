---
status: active
updated: 2026-05-07
role: decision-index
archive: decisions/full-log-2026-05-04.md
---

# Decisions

This file is an index, not the full decision log. Keep it small so agents can
load current rationale cheaply.

Full historical log archived at `docs/decisions/full-log-2026-05-04.md`.

## Current Decision Records

| ID | Date | Status | Summary | Detail |
| --- | --- | --- | --- | --- |
| L88 | 2026-05-06 | active | Downstream beat calibration/packing is diagnostic evidence only; the active authoring-quality lever is default-off native concept/planning plus planner-quality scoring for endpoint landing and character materiality. | `docs/decisions/L088-upstream-native-planning-contract.md` |
| L87 | 2026-05-06 | active | Agents must state the changed phase/surface, exact change, expected benefit, downstream projection, and evidence gate before non-trivial implementation. | `docs/decisions/L087-agent-phase-impact-contract.md` |
| L86 | 2026-05-06 | superseded | Accelerated semantic-gate cohorts showed hard beat caps delete context and calibrated packing preserves obligations better, but L88 supersedes downstream packing as product direction. | `docs/decisions/L086-calibrated-planner-shape.md` |
| L85 | 2026-05-06 | active | Development is mainline-first: work directly on `main`, use rollback tags for risky moves, and reserve branches for explicit requests or disposable experiments. | `docs/decisions/L085-mainline-first-workflow.md` |
| L84 | 2026-05-06 | active | Continuity findings remain diagnostic/review evidence and no longer open Drafting Plan-Assist gates by themselves; Beat/plan, halluc-ungrounded, validation, integrity, and functional blockers remain load-bearing. | `docs/decisions/L084-continuity-diagnostic-drafting-gates.md` |
| L83 | 2026-05-06 | superseded | Continuity-state warning N=50 follow-up found 0% TP, 88% FP, 12% AMB. Runtime-gating implication superseded by L84; panel evidence remains relevant. | `docs/decisions/L083-continuity-state-warning-panel-2026-05-06.md` |
| L82 | 2026-05-06 | active | Fact-role live A/B remains hold: role filtering worked, but both arms gated on chapter-2 continuity and role-aware regressed cost/hallucination. Default runtime stays legacy; role-aware remains A/B-only. | `docs/decisions/L082-fact-role-ab-hold.md` |
| L81 | 2026-05-05 | active | Continuity gray-zone panel N=20: continuity-facts blocker/warning is reasonably calibrated (60% TP), continuity-state/warning is the dominant gray zone (20% TP, 80% non-catch), object_emphasis subcategory is well-calibrated. Follow-up needs N≥50 stratified panel before any production checker change. | `docs/decisions/L081-continuity-grayzone-panel-2026-05-05.md` |
| L80 | 2026-05-05 | active | Test and invariant work uses a dedicated support/evidence role with tiered gates, proof-before-blocking, and no hidden broad `bun test` reliance. | `docs/decisions/L080-test-invariant-agent-contract.md` |
| L79 | 2026-05-04 | active | Authoring harness refinement: prioritize visibility/interactivity and deterministic impact awareness; require A/B evidence before production creative-heuristic wiring. | `docs/decisions/L079-authoring-harness-eval-gates.md` |
| L78 | 2026-05-04 | active | UI/browser and CI posture: use Playwright MCP for browser preflight, keep external CI on hold indefinitely, backlog artifact/Canon observer expansion. | `docs/decisions/L078-ui-browser-ci-posture.md` |
| L77 | 2026-05-04 | active | Proposal provenance and downstream checker attribution: proposals are system/user-triggered change requests; checker-fire outcomes require explicit correlation, not inference. | `docs/decisions/L077-proposal-provenance-checker-attribution.md` |
| L76 | 2026-05-04 | active | Phase 7 rollout posture: persist proposal envelopes at review checkpoints, keep Canon manual, use explicit outcome source and promotion tiers. | `docs/decisions/L076-phase-7-policy-rollout-posture.md` |
| L75 | 2026-05-04 | active | Phase 7 local guard, downstream metric shape, and generator replay harness. | `docs/decisions/L075-phase-7-generator-replay-guard.md` |
| L74 | 2026-05-04 | active | Phase 6 review fixes and Phase 7 replay-metrics tracer bullet. | `docs/decisions/L074-phase-7-replay-tracer.md` |

## Earlier History

Earlier decisions remain preserved in the full log:

- `docs/decisions/full-log-2026-05-04.md`

If an older decision becomes active again, extract it into
`docs/decisions/LNNN-short-slug.md`, add a row above, and mark the old archived
entry superseded by the extracted file.

## Maintenance Rules

- Keep this index under 250 lines.
- One table row per active or recently relevant decision.
- Put detailed rationale, evidence, alternatives, and implications in the
  linked decision file.
- Use `status: active | historical | superseded` frontmatter in detail files.
- Run `bun run docs:weight` before closing docs-heavy work.
