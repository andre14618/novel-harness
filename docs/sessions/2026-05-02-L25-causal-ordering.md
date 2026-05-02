---
status: in-progress
updated: 2026-05-02
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

# L25 — EVENTS_SYSTEM v3: Causal-Ordering Rule

## Loop Contract

- Objective: Lift reversed-order shape recall from 67% → 100% by adding a positive-framed causal-sequence rule to EVENTS_SYSTEM. Specifically catch fail-02 (mage drain before binding), the sole remaining FN after L21 v2 promotion.
- Starting commit: 125e848 (branch synthesis-bundle-v1)
- Experiment ID: #345
- Budget cap: $1
- Primary lever: EVENTS_SYSTEM constant in `src/agents/writer/adherence-checker.ts` (lines 46–63)
- Files expected to change:
  - `scripts/hallucination/run-ab-causal-ordering.ts` (new A/B script)
  - `src/agents/writer/adherence-checker.ts` (EVENTS_SYSTEM, if promoted)
  - `docs/adherence-events-v3-causal-ordering-2026-05-01.md` (result doc)
  - `docs/decisions.md` (append L25 entry)
  - `docs/todo.md` (close reversed-order item if promoted)
  - `docs/sessions/2026-05-02-L25-causal-ordering.md` (this file)
- Evidence artifact: `/tmp/ab-causal-ordering-<ts>.summary.json`
- Stop condition: (a) a candidate promotes + docs + commit; (b) all candidates fail acceptance → doc deferred with structural recommendation; (c) cost crosses $1
- Escalation condition: FP regression on labeled panel from ordering rule → structural redesign needed (per-event extraction), doc and stop

## Baseline After L21 (exp #338)

- Current EVENTS_SYSTEM: v2 (ambient/mechanical equality language)
- reversed-order recall (L21 definitive run): 67% (2/3 caught)
  - fail-01 (Sara calls before seeing): TP — already caught
  - fail-02 (mage drain before binding): FN — **this is the target**
  - fail-03 (Cassel doesn't hand brief): TP — already caught
  - pass-01 (Kael draws+shouts, parallel): TN — must remain
- labeled panel: 100%/100% (17 rows, exp #299)
- embellishment TN: 100%

## Root Cause Analysis (fail-02)

Beat: "The mage casts the binding, drains the well, then collapses."
Prose: drain happens first (cold pull, draws from well), then binding forced outward, then collapses.

v2 reasoning: "all in sequence" — the model sees binding and drain both present, reads the prose left-to-right, sees binding MENTIONED (as the forcing of sigil outward) and passes. The causal prerequisite (binding must precede drain) is not in the prompt language.

The fundamental issue: v2 only checks presence, not order. The ordering rule must be added without neg-prime language and without breaking pass-01 (parallel concurrent actions that have no causal dependency).

## Prompt Design

### v3 — causal-ordering rule (minimal addition)

Add one bullet after the "ALL must appear" rule:

> "When the beat sequences events with 'then', 'after', 'before', 'next', or implicit causal logic (where X is a prerequisite for Y to occur), verify that the prose enacts them in the same order. If a prerequisite action occurs after its consequence in the prose, return events_present=false even when all events are present."

Risk: The pass-01 beat ("Kael draws his sword and shouts a warning") uses "and" — parallel, no causal order. The v3 rule applies only to "then"/"after"/"before"/"next" or "implicit causal logic." The word "and" in the beat does not trigger ordering. Risk is LOW that this fires on pass-01.

### v4 — causal-ordering-tighter (with concrete examples)

Same v3 rule plus a grounding example that names the exact two fixture types:

> "...For example: if the beat says 'casts the binding, then drains the well', the prose must show the binding cast first; if the beat says 'unlocks the door, then sees the body', the door must be opened before the body is visible. If the prose reverses a causally-ordered sequence, return events_present=false even when all events are present."

Risk: Explicit examples could create anchoring that hurts labeled panel rows whose context doesn't match these examples. Also risks the L21 v4-v7 FP failure mode (reasoning-first caused labeled panel FPs). v4 here is NOT reasoning-first — just adds examples, so the risk is lower.

## Command Plan

1. [x] Create experiment #345 in DB
2. [x] Write A/B script: `scripts/hallucination/run-ab-causal-ordering.ts`
3. [x] Write session doc (this file)
4. [ ] Commit scaffolding (script + session doc)
5. [ ] Run A/B: `bun scripts/hallucination/run-ab-causal-ordering.ts --persist --exp-id 345`
6. [ ] Evaluate verdict
7. [ ] If PASS: update EVENTS_SYSTEM, run lint+tsc+test, write result doc, update decisions.md + todo.md
8. [ ] If FAIL: write deferred result doc, structural recommendation, update decisions.md
9. [ ] Conclude experiment #345
10. [ ] Commit docs + (if promoted) code changes

## Progress Log

- [x] Context read: L21 session doc, partial-enactment panel doc, v2 promotion doc, adherence-checker.ts, A/B harness, all 14 fixtures
- [x] Confirmed: fail-01 and fail-03 already caught (TP); fail-02 is sole FN
- [x] Experiment #345 created in DB
- [x] A/B script written: `scripts/hallucination/run-ab-causal-ordering.ts`
- [x] Session doc written
- [ ] Commit scaffolding
- [ ] A/B run
- [ ] Verdict + result doc + conclusion

## Pickup Instructions

- Last safe state: experiment created, script written, session doc written. Scaffolding commit pending.
- Next action: commit scaffolding, then run A/B with `--persist --exp-id 345`
