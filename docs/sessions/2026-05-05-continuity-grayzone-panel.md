---
status: active
updated: 2026-05-05
role: lane-doc
---

# Continuity Gray-Zone Adjudication Panel — 2026-05-05

## Loop Contract

- **Objective:** Build a small adjudicated panel of continuity findings (continuity-facts contradictions and continuity-state violations) labeled TP / FP / AMB + subcategory (object emphasis, emotional/readiness state, invented entity, changed core action), so subsequent decisions on relaxing object/state conflict checks have evidence rather than vibes.
- **Starting commit:** `a06b45b`
- **Experiment ID:** 476.
- **Budget cap:** $5 (well above expected ~$1).
- **Primary lane:** Authoring visibility/interactivity foundation — checker gray-zone evidence support.
- **Causal hypothesis:** Operator inspection of recent continuity findings suggests over-strict catches around object emphasis and emotional/readiness state (`docs/authoring-harness-refinement-plan.md` Step 7 Investigation Set). A small adjudicated panel measures TP/FP rate per subcategory before any checker relaxation, preserving hard catches for invented entities and changed core actions.
- **Baseline:** No labeled panel exists for continuity findings. Decisions on checker strictness would currently be made on inspection-by-eye.
- **Changed runtime lever:** None. Pure offline evidence build. No checker prompt or threshold change in this session.
- **Feedback signal:** Per-subcategory TP/FP rate over N≥30 findings, with confidence intervals on the dominant subcategory.
- **Stop gate:** (a) Clean pass — extractor + adjudication run end-to-end and produce a panel doc with per-subcategory rates.
- **Escalation rule:** If subagent adjudication shows >40% AMB rate, flag as adjudication-design issue and stop before drawing conclusions.
- **Allowed parallel support work:** Doc sweep on close.
- **Files expected to change:** `scripts/analysis/continuity-grayzone-extract.ts` (new), `scripts/analysis/continuity-grayzone-extract.test.ts` (new), `package.json`, `docs/sessions/lane-queue.md`, this lane doc, possibly `docs/decisions/` entry, possibly a panel artifact under `output/` (gitignored or explicit fixture).
- **Evidence artifact:** Panel JSONL with N findings + labels + subcategory tags; summary doc with per-subcategory rates; experiment conclusion.

## Stop Gates

- **(a) Clean pass:** Extractor + tests green; panel emitted with N≥30 labeled findings; per-subcategory rates computed and committed in a results doc.
- **(b) New dominant blocker:** AMB rate > 40% — adjudication design needs revisit. Flag and stop.
- **(c) Regression:** TS/test breakage on touched files.
- **(d) Infrastructure failure:** Subagent adjudication fails to produce parseable output for >25% of findings.
- **(e) Cost cap:** $5; expected $1.

## Command Plan

- **Sample shape:** N=30 stratified across (facts | state) × (blocker | warning | nit). Real production data only — no synthetic/proxy. Stratification favors warnings and blockers since `nit` already implies low confidence.
- **Adjudication:** parallel Sonnet subagents via Agent tool. Each subagent receives a bounded JSON payload of ~10 findings with full context (the prose excerpt, the finding fact/violation, the evidence quote, the reasoning) and emits a labeled JSON for each. Subcategory taxonomy fixed: `object_emphasis`, `emotional_readiness_state`, `invented_entity`, `changed_core_action`, `other`.
- **Verification:**
  - `bun test scripts/analysis/continuity-grayzone-extract.test.ts`
  - `bunx tsc --noEmit`
  - `bun run docs:weight`
  - Panel artifact emit completes; per-subcategory aggregation produces sensible rates.

## Results

- Outcome: pending
- Stop gate fired: pending
- Evidence: pending
- Cost: pending
- Commits: pending
- Review: pending
