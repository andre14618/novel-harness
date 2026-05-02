---
status: completed
updated: 2026-05-01
role: overnight-loop-context
loop: L7-adherence-convergence
---

# L7 — Adherence-events N-call Convergence Panel

## Loop Contract

- **Objective:** Apply L1's convergence methodology to the binary `adherence-events` checker. Same N=5 calls × {temp=0.1, temp=0.5} sweep on the same labeled panel rows. Quantify whether vote aggregation lifts F1 over single-call baseline.
- **Starting commit:** `ea3bd18` ([infra] Adherence-events N-call convergence eval).
- **Experiment ID:** TBD — created at run time.
- **Budget cap:** $1. Adherence panel has 22 rows; 4 runs × 110 calls each ≈ 440 calls × ~$0.0003 ≈ $0.13. Trivial.
- **Primary lever under test:** Number of independent `EVENTS_SYSTEM` calls per beat + temperature.
- **Files/scripts expected to change:** None additional — `scripts/hallucination/adherence-convergence-eval.ts` is the script (already committed). Result doc `docs/adherence-convergence-results-2026-05-01.md`. Decisions.md entry.
- **Evidence artifact:** Per-run JSONL on LXC at `/tmp/adherence-convergence-N5-T{01,05}-<ts>.jsonl`, plus `phase_eval_runs` rows.
- **Stop condition:** All 4 runs persist + result doc + decisions entry committed + experiment concluded.
- **Escalation condition:** Convergence shows zero divergence even at temp=0.5 → adherence binary is much more deterministic than halluc; document and stop. If it shows > halluc-level divergence (40-60% rows non-unanimous), expect bigger F1 lift potential.

## Baseline

- **Current behavior:** Production adherence-events runs ONE call per beat with temp=0.1 (per `src/agents/writer/adherence-checker.ts`). Returns `{events_present: bool, evidence: str, reasoning: str}`. Used by the writer drafting loop.
- **Baseline command:** N/A — comparable to the k=1 single-call result that this convergence will produce inline.
- **Baseline result:** Unknown F1 (no prior single-call eval persisted under the same panel). Use the convergence k=1 row as the baseline.

## Command Plan

1. Deploy after L5 commits (waiting on `bo4dghdgf` background job).
2. Create tracking experiment row.
3. Run T=0.1 N=5 on `/tmp/halluc-current-panel-exp299-labeled.jsonl` (filters to checker=='adherence-events').
4. Run T=0.5 N=5 in parallel.
5. Persist + write result doc + commit + conclude.

## Progress Log

- 2026-05-01 03:14Z — Context file created. Script committed (`ea3bd18`). Deploy waiting on L5 subagent commit.

## Results

- **Outcome:** CONVERGENCE-NOT-NEEDED. Adherence-events single-call temp=0.1 already at F1=1.000 on the 22-row labeled panel (k=1..4 of 5). Voting adds nothing; higher temperature only hurts (F1 drops to 0.947 at T=0.5 k=1). Methodology lesson: convergence helps ONLY where single-call F1 ≤ 0.85 AND temp=0.1 unanimous-rate < 80%.
- **Evidence link/row/path:** `tuning_experiments.id=320` (concluded; linked to L1's exp #316 as methodology-replication). `phase_eval_runs.id=62,63`. Per-row JSONL on LXC. Result doc `docs/adherence-convergence-results-2026-05-01.md`.
- **Cost:** ~$0.07 across 220 calls.
- **Commit(s):** TBD — committing L7 docs now.

## Pickup Instructions

- **Last safe command:** L7 is closed. Two convergence runs persisted, experiment concluded, result doc written.
- **If failed, failure fingerprint:** N/A.
- **Next action:** Move to next loop. L4-followup (NER calibration) and L6 (multi-seed probe) still in flight from Wave 2 dispatch.
