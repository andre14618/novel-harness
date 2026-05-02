---
status: active
updated: 2026-05-01
role: overnight-loop-context

# ── Workflow telemetry (mandatory as of 2026-04-19) ──────────────────────
wall_clock_min: 0
codex_reviews: 0
rework_passes: 0
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# L15 — NER X-of-Y + Number-Word-Tail Extension — 2026-05-01

## Loop Contract

- **Objective:** Close 3 FNs from L12 expanded synthetic panel (exp #327) by adding two new NER extractor classes: `x-of-y-capitalized` and `number-word-tail`. Zero FP regression required.
- **Starting commit:** `fe5152d` (L12 expanded panel)
- **Experiment ID:** TBD (allocated at runtime)
- **Budget cap:** $0.50
- **Primary lever under test:** Two new regex-based extractor classes in `src/lint/entity-candidates.ts`
- **Files/scripts expected to change:**
  - `src/lint/entity-candidates.ts` (add 2 classes + regexes)
  - `src/lint/entity-candidates.test.ts` (add 15+ new tests)
  - `docs/ner-x-of-y-extension-2026-05-01.md` (result doc)
  - `docs/decisions.md` (append L15 entry)
  - `docs/todo.md` (note under §7)
- **Evidence artifact:** `/tmp/ner-calibration-postL15-small-<ts>.jsonl` + expanded panel re-run
- **Stop condition:** 3/3 FNs closed, FP stays at 0, F1 lifts on both panels
- **Escalation condition:** A class can't be made FP-free → emit as warning-tier, document, pivot

## Baseline

- **L4-followup-2 state:** small panel F1=0.947, big panel F1=0.839
- **L12 expanded panel:** recall=83% (15/18 TP), F1=0.91, FP=0
- **FNs:** `Crown of Hyran`, `the Sigil of Eight`, `the Veiled Eight`
- **Root cause:** `X of Y` connector breaks consecutive-capitalization detection; number-word tails (Eight) not in suffix vocabulary; article-prefix ("the") suppresses extraction for suffix-class

## Command Plan

1. Write session context file (this file)
2. Implement `x-of-y-capitalized` regex in `entity-candidates.ts`
3. Implement `number-word-tail` regex in `entity-candidates.ts`
4. Export new types + regexes; add to `extractEntityCandidates()`
5. Add 15+ unit tests in `entity-candidates.test.ts`
6. Run `bun test src/lint/entity-candidates.test.ts`
7. Run `bunx tsc --noEmit`
8. Create DB experiment
9. Run NER calibration on small panel (labeled)
10. Run NER calibration on expanded panel
11. Write result doc `docs/ner-x-of-y-extension-2026-05-01.md`
12. Append decisions.md
13. Update todo.md
14. Conclude DB experiment
15. Commit (3 atomic commits)

## Progress Log

- Session context file written.

## Results

- Outcome: TBD
- Evidence link: TBD
- Cost: $0 (deterministic + no LLM calls in this loop)
- Commits: TBD

## Pickup Instructions

- If session is interrupted, resume at step 6 (unit tests)
- Calibration scripts need the DB to be accessible from local machine
- The labeled panel is at `/tmp/halluc-current-panel-exp299-labeled.jsonl`
- The expanded panel is at `scripts/hallucination/expanded-fail-classes-panel.jsonl`
