---
status: active
updated: 2026-05-01
loop: L19
objective: asymmetric-voting-policy-probe
experiment: TBD
parent_exps: [316, 322, 327, 330]
---

# L19 — Asymmetric Voting Policy Probe (2026-05-01)

## Objective

Evaluate asymmetric voting policies for the `halluc-ungrounded` checker by comparing 4 policies on the labeled natural-mixed panel + expanded synthetic panel. NER F1=1.000 on both panels (L15, exp #330) is the precondition; it is satisfied.

## Starting Commit

`67b0d1b` (current HEAD on `synthesis-bundle-v1` branch)

## Experiment ID

Created at loop start: TBD — see experiment creation in probe script.

## Policies Under Evaluation

1. **AND-gate v1 (current production)**: NER∩LLM=blocker; NER-only=warning (still pass=false); LLM-only=blocker. Single LLM call at T=0.1.
2. **Asym-A (high-precision)**: NER alone blocks (FP=0 post-L15); LLM ≥3-of-5 votes at T=0.5 = blocker; 1-2-of-5 = warning; 0-of-5 = pass-LLM.
3. **Asym-B (high-recall)**: NER alone blocks; LLM 2-of-5 votes at T=0.5 = blocker (lower threshold); 1-of-5 = warning; 0-of-5 = pass-LLM.
4. **Asym-C (NER + single-call T=0.1)**: NER alone blocks; single LLM call at T=0.1 blocks; same cost as current production. This is "can we do better with same call count if NER carries recall?"

## Key Evidence from Prior Loops

- L15 (exp #330): NER F1=1.000 small panel, 1.000 expanded panel. FP=0 on both.
- L1 (exp #316): T=0.5 k=3 is best F1 on natural-mixed small panel (0.762). T=0.5 k=1 best on synthetic-only big panel (0.686).
- L4-followup-3 (exp #322): AND-gate wired. NER-only = warning, not pass.
- Current production: NER∩LLM-blocker, NER-only=warning (pass=false), LLM-only=blocker.

## Panels

- **Labeled panel**: `/tmp/halluc-current-panel-exp299-labeled.jsonl` — 22 halluc-ungrounded rows (17 natural + 5 synthetic). Oracle labeled: TN=12, FN=4, MIXED=1, 5 synthetic (expected_pass=false).
- **Expanded synthetic panel**: `scripts/hallucination/expanded-fail-classes-panel.jsonl` — 27 rows: 18 FAIL across 6 classes + 9 PASS controls.

## Files Created / Changed

- `scripts/hallucination/asymmetric-voting-probe.ts` — new probe script (local only, no deploy)
- `docs/asymmetric-voting-policy-probe-2026-05-01.md` — result doc
- `docs/sessions/2026-05-01-L19-asymmetric-voting-probe.md` — this file
- `docs/decisions.md` — append L19 entry
- `docs/todo.md` — close §7 "Evaluate asymmetric voting policy"

## Budget Cap

$1.50 (5x convergence on ~50 rows, ~$0.0003/call × 5 × 50 = $0.075 minimum; 5x coverage at T=0.5 is ~$0.375).

## Stop Conditions

- (a) Probe complete + result doc + decisions.md + commit — PROCEED
- (b) NER FP rate post-L15 is > 0 (should be 0; document and pivot if not)
- (c) Cost > $1.50

## Pickup Instructions

If loop stops midstream:
1. Check experiment ID in `tuning_experiments` (description LIKE '%L19%')
2. Check `/tmp/asym-voting-probe-*.jsonl` for any partial results
3. Re-run `bun scripts/hallucination/asymmetric-voting-probe.ts` with `--resume`
4. Budget remaining: subtract `SELECT SUM(cost) FROM llm_calls WHERE timestamp > '<start>'`
