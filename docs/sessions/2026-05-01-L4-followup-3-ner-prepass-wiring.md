---
status: pending
updated: 2026-05-01
role: overnight-loop-context
loop: L4-followup-3-ner-prepass-wiring
parent_loops: [L4, L4-followup, L4-followup-2]
---

# L4-followup-3 — Wire Deterministic NER as Halluc Prepass

## Loop Contract

- **Objective:** Integrate the deterministic entity-candidate extractor (`src/lint/entity-candidates.ts`, post L4-followup-2 fixes) into the production `halluc-ungrounded` checker as a **prepass signal**. The L4-followup calibration showed deterministic NER beats the LLM checker by +17-32% relative F1; L4-followup-2 closed the two pre-promotion gaps. Production wiring is the final step before measuring real-world impact.
- **Starting commit:** TBD (after L4-followup-2 result doc commits).
- **Experiment ID:** TBD — link as continuation of #319.
- **Budget cap:** $4 — runtime change, validation needed via 3-chapter smoke run.
- **Primary lever under test:** NER prepass added to `src/agents/halluc-ungrounded/index.ts` runtime checker. AND-gate vs OR-gate vs WARN-only — TBD by recon.
- **Files/scripts expected to change:**
  - `src/agents/halluc-ungrounded/index.ts` — add NER prepass before LLM call
  - Possibly `src/agents/halluc-ungrounded/schema.ts` — add NER provenance to issues
  - `src/agents/halluc-ungrounded/halluc-ungrounded-system.md` — note that NER signals are pre-filtered
  - `src/agents/halluc-ungrounded/index.test.ts` — assert NER prepass behavior
  - `docs/current-state.md` — update halluc checker description
- **Evidence artifact:** 3-chapter smoke run output + per-call llm_calls breakdown showing NER prepass impact (calls saved, additional FN catches).
- **Stop condition:** Wiring lands + smoke validates: NER prepass adds high-confidence FNs without inflating FPs above the L4-followup baseline.
- **Escalation condition:** If NER prepass causes a regression (more total checker fires AND high FP rate on production prose), revert and document.

## Design question — gate behavior

L4-followup data (small panel, n=22):
- NER F1 = 0.842, FP rate = 1/12 = 8%
- LLM (k=1 of 5 @ T=0.1) F1 = 0.720, FP rate = 6/12 = 50%

NER's 8% FP rate is too high for a HARD STANDALONE BLOCKER (would fail 1 in 12 clean beats unnecessarily).

Three candidate designs:

**A) AND-gate (NER ∩ LLM = blocker; NER ∪ LLM = warning)**
   - Blocker fires only when both NER and LLM agree fail → very high precision
   - Warning fires when either fires → covers the FN cases
   - Pro: low false-blocker rate; Con: may still miss the systematic FN class (where LLM is wrong)

**B) NER-blocker, LLM-validator-on-NER-hit**
   - NER fires → run LLM ONCE on this beat → if LLM agrees, block; if LLM disagrees, warn
   - Saves LLM calls when NER passes (NER is fast)
   - Pro: cost reduction + high precision; Con: still gated on LLM accuracy

**C) Route ladder (per §11 backlog)**
   - NER pass + LLM pass (1x) → done, no block
   - NER fail OR LLM fail → run LLM 5x convergence → vote at k=3
   - Pro: cheap on clean beats, expensive only on suspicious ones
   - Con: complex; harder to reason about

Recommendation: design **A as v1** (simpler), then iterate to C only if the precision/recall numbers warrant.

## Baseline

- **Current behavior:** halluc-ungrounded runs single-call LLM at temp=0.1. F1=0.720 (k=1) on small panel per L4-followup baseline.
- **Baseline command:** `bun scripts/hallucination/ner-vs-llm-calibration.ts --in /tmp/halluc-current-panel-exp299-labeled.jsonl ...` — already ran in L4-followup.
- **Baseline result:** small panel LLM F1 = 0.720; NER F1 = 0.842 (post-fix may be higher).

## Command Plan

1. **Recon:** read `src/agents/halluc-ungrounded/index.ts` + `src/lint/entity-candidates.ts` (post L4-followup-2). Understand current call shape.
2. **Implement:** add `extractEntityCandidates()` call before the LLM call. Compare each candidate against the grounded union (using `normalizeForGroundedMatch`, the helper from L4-followup-2). Build NER findings list.
3. **Decide gate behavior:** apply design A (AND-gate). NER findings + LLM findings combined; intersection = blocker, union = warning.
4. **Add unit test** for the runtime wiring.
5. **Smoke validate** with a 3-chapter novel run (use a stable seed; record gate fires, retries, lint integrity).
6. **Persist** to phase_eval_runs probe `halluc-ungrounded-ner-prepass-validation`.
7. **Conclude** experiment + commit per atomic-commits.

## Progress Log

- 2026-05-01 (now) — Context file created. Pending L4-followup-2 docs commit before dispatch.

## Results

- **Outcome:** TBD
- **Evidence link/row/path:** TBD
- **Cost:** TBD
- **Commit(s):** TBD

## Pickup Instructions

- **Last safe command:** Pre-dispatch.
- **Next action:** After L4-followup-2 docs commits, dispatch this loop to a Sonnet subagent.
