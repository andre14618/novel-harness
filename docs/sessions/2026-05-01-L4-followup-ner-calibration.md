---
status: in-progress
updated: 2026-05-01
role: overnight-loop-context
loop: L4-followup-ner-calibration
parent_loop: L1-halluc-convergence-panel (2026-05-01-L1-halluc-convergence-panel.md)
---

# L4-followup — Deterministic NER vs LLM-Halluc Calibration

## Loop Contract

- **Objective:** Calibrate the L4 deterministic entity-candidate extractor (`src/lint/entity-candidates.ts`, commit `0eeabf9`) against the production-trained `halluc-ungrounded` LLM checker on both labeled hallucination panels. Build a 2x2 contingency table per row: `(NER fires) x (LLM fires)` resolved against the oracle/synthetic-expected pass label. The headline question: **does deterministic NER catch hallucinations the LLM misses (the "1-3 systematic FN floor" identified by L1 / exp #316)?**
- **Starting commit:** `139e8aa` (L1 closed; HEAD as of loop start)
- **Experiment ID:** TBD — `harness.experiments.createTuningExperiment("ticket", ...)` with type "checker_eval", target "halluc-ungrounded-ner-calibration", dimension "recall-floor". Linked as continuation of #316 via `linkExperiment`.
- **Budget cap:** $1 — this loop runs **NO LLM calls**. All deterministic comparison vs already-recorded LLM outputs. The only cost surface is one DB INSERT per panel into `phase_eval_runs`. Effectively zero.
- **Primary lever under test:** None promoted by this loop. Calibration target is `extractEntityCandidates(prose)` against the row's grounded-source union. The lever is *measurement only* — does NER recall lift the LLM-FN floor? No production routing change in this loop.
- **Files/scripts expected to change:**
  - `scripts/hallucination/ner-vs-llm-calibration.ts` (new)
  - `docs/sessions/2026-05-01-L4-followup-ner-calibration.md` (this file)
  - `docs/ner-vs-llm-calibration-2026-05-01.md` (new — result doc)
  - `docs/decisions.md` (append L4-followup entry under §Hallucination)
- **Evidence artifact:** Two timestamped per-row JSONLs on LXC (`/tmp/halluc-ner-calibration-{small,big}-<TS>.jsonl`) + one `phase_eval_runs` row per panel + the result doc.
- **Stop condition:** ANY of:
  1. Both panels' calibration JSONLs persisted + 2x2 matrices printed to stdout + result doc + decisions.md entry committed + experiment concluded.
  2. Script errors out on a row format edge case — pause, fix, re-run.
- **Escalation condition:** None expected — pure deterministic compute. If `extractEntityCandidates` throws or sentence-initial detection misclassifies enough rows that the matrices are uninterpretable, document the gap and conclude with verdict `BLOCKED-ON-NER-FIDELITY`.

## Baseline

- **Current behavior:** L4 extractor exists in `src/lint/entity-candidates.ts` but is TELEMETRY-ONLY — nothing in production calls it. The LLM `halluc-ungrounded` checker runs unmodified at temp=0.1 N=1 in production (or N=5 in the L1 convergence eval).
- **Baseline command(s):** None — this loop is the baseline.
- **Baseline result:** From L1 (exp #316): single-call F1 0.720 (small panel), 0.606 (big panel synthetic-only). Best convergence variant lifts F1 by +0.04–0.08 absolute. **1-3 FNs survive every threshold including unanimous 5/5 votes.** Oracle FN list on small panel (per docs/decisions.md exp #301): `Master Orin`, `Guildmaster Aldric` (×2), `Yarrow`, `Office of Structural Integrity`, `the Purge`, `Vault of Witnesses`. Big panel synthetics: `Veyr Dominion`, `Office of Structural Integrity`, `the Sundered Crown`, `the Siege of Briar Pass`, `the Bellward Order`, `Halrune Vale`, `Lord Caelin`, `Vault of Mirrored Names`, etc.

## Command Plan

1. **Implement `scripts/hallucination/ner-vs-llm-calibration.ts`** locally. Pure deterministic — reads panel JSONL + (optionally) the L1 convergence-eval JSONL for the LLM-vote signal; falls back to `actual.output.pass` from the panel itself when the convergence file isn't given.
2. **Commit script + this context file** as commit 1 (atomic, `[infra]` prefix, `docs-impact: none`).
3. **Run on LXC against both panels** with the L1 convergence JSONLs as the LLM-vote source:
   ```
   ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/hallucination/ner-vs-llm-calibration.ts \
     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
     --convergence /tmp/halluc-convergence-N5-T01-20260501T030200.jsonl \
     --out /tmp/halluc-ner-calibration-small-<TS>.jsonl \
     --persist --exp-id <expId> --variant-label small-panel"
   ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/hallucination/ner-vs-llm-calibration.ts \
     --in /tmp/halluc-panel-L1-big-20260501.jsonl \
     --convergence /tmp/halluc-convergence-big-N5-T01-20260501T031000.jsonl \
     --out /tmp/halluc-ner-calibration-big-<TS>.jsonl \
     --persist --exp-id <expId> --variant-label big-panel-synthetic-only"
   ```
4. **Write result doc + append decisions.md** with the 2x2 matrices and verdict (one of `NER-LIFTS-FLOOR`, `NER-DOES-NOT-LIFT-FLOOR`, `NER-PARTIAL-LIFT`).
5. **Commit result doc + decisions update** as commit 2 (`[docs]` prefix, body cites the experiment ID).
6. **Conclude experiment** with the verdict.

## Verification commands

- `ssh novel-harness-lxc "wc -l /tmp/halluc-ner-calibration-*.jsonl"` — row counts match (22 small, 45 big).
- `ssh novel-harness-lxc "cd ~/apps/novel-harness && bun -e '...verify aggregate counts match...'"` — sanity-check the 2x2 cells.
- `psql ... -c "SELECT id, probe_name, verdict FROM phase_eval_runs WHERE probe_name = 'halluc-ungrounded-ner-calibration' ORDER BY id DESC LIMIT 4"` — confirms persistence.

## Progress Log

- 2026-05-01 — Context file created. Plan: implement script, run, write result doc, two atomic commits, conclude exp.

## Results

- **Outcome:** TBD until both panels run.
- **Evidence link/row/path:** TBD.
- **Cost:** TBD (~$0 expected).
- **Commit(s):** TBD.

## Pickup Instructions

- **Last safe command:** None yet — loop just opened.
- **If failed, failure fingerprint:** Most likely causes if interrupted: (a) panel JSONL row missing `task.prose` for synthetic-pass-control rows (handle with empty-prose short-circuit), (b) `groundedSources` missing one of the expected keys (treat absent key as empty array — already handled in `ab-halluc-prompt.ts` patterns).
- **Next action:** Resume by re-running the calibration script on the panel that didn't complete; outputs are timestamped per `feedback_no_overwrite_runs` so re-running creates a fresh file.
