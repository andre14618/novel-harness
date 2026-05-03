---
status: active
updated: 2026-05-02
role: session-context
session: 2026-05-02-runner-archive-and-litrpg-validate
---

# Session: Finish Runner Archival + Validate L62 LitRPG Integrity Carve-Out

## Session Start Contract

**1. Goal + component.** Finish demoting `scripts/agent/lane-runner.ts` to clearly-marked legacy (docs + script alias) and validate L62's `detectFusedBoundaries` LitRPG carve-out end-to-end on a real LXC smoke of the `fantasy-system-heretic` seed. The component for the validation lane is `src/lint/integrity.ts` plus the LXC novel pipeline against the same baseline (L61 exp #384).

**2. Why.** L61 e2e smoke (exp #384, novel `novel-1777761636607`) bailed at chapter 1 attempt 3 on 8 fused-boundary issues, all from in-world LitRPG System UIDs. L62 (exp #385) shipped the unit-tested fix in commit `31e16a8`. Until a real smoke runs against deployed LXC code, we don't know whether (i) the fix actually closes the cluster end-to-end, and (ii) the next dominant blocker is what L61's secondary finding predicted (chapter-attempt retry escalation 1→5→7) or something different.

**3. Measurable signals.**
   - **Runner archival:** docs/scripts grep shows zero PRIMARY-classified runner references; `bun run` discovery surfaces `captain-terminal` first; `lane-runner-legacy` works end-to-end as the script alias.
   - **L62 validation:** chapter 1 of `fantasy-system-heretic` drafts to completion without any `fused-boundary` issue rows in `pipeline_events` for the System UID block. Smoke-stop classifier verdict on the run is one of `clean_pass | new_blocker` (not `human_needed` from the same integrity FP). Cost ≤ $0.20 (L61 baseline was $0.066).
   - **Artifact:** lane Results section + `tuning_experiments.id=386` conclusion citing the `chapter_exhaustions` row count and the smoke-stop verdict.

**4. Validated gates.**
   - **(a) Clean pass:** chapter 1 drafts; no fused-boundary rows from System UIDs across all attempts; smoke continues into chapters 2/3 or finishes cleanly.
   - **(b) New dominant blocker:** chapter 1 drafts past the integrity guard but bails on a different cluster (e.g. plan-assist, continuity, or the L61 secondary "duplicate-fragment escalation" finding). Stop and queue the next lane (likely L63).
   - **(c) Regression:** chapter 1 still bails on `fused-boundary` issues — would mean the regex didn't deploy or matches incorrectly on deployed prose. Diagnose before any new work.
   - **(d) Infra failure:** deploy fails, LXC unreachable, provider exhaustion, or `chapter_exhaustions` rows missing. Fix harness first.
   - **(e) Cost cap:** $2 hard cap for this session's smoke (well above the $0.066 L61 baseline; gives headroom for retries).
   - **Verification commands:**
     - `bash scripts/deploy-lxc.sh`
     - `ssh novel-harness-lxc "cd ~/apps/novel-harness && EXPERIMENT_ID=386 SEED=fantasy-system-heretic bun src/index.ts --chapters 3 --auto"` (run via `nohup ... > /tmp/smoke-l62val.log 2>&1 &`)
     - `bun scripts/operator-summary.ts --latest --json | bun scripts/agent/smoke-stop-classifier.ts --input -`

## Lanes In Sequence

1. **Lane R (closed):** runner archival demotion. Commits `744baf5` + `3473428`. Outcome: clean pass — primary recipe blocks now point at the captain loop; runner appears only in clearly-labeled legacy sections; `package.json` alias renamed.
2. **Lane L62-validate (closed, clean pass for hypothesis):** smoke approved chapter 1 with 0 fused-boundary issues from System UIDs; closed the L61 cluster. New dominant blocker surfaced in continuity (out-of-phase) — parked as observation, not a sub-lane.
3. **Lane L63 / Lever A (active, code complete):** matched-pair carry-over for duplicate-sentence + duplicate-fragment. Phase brief drove this; trace evidence confirmed the fresh-prose-elsewhere causal model. 175/175 unit tests pass; awaiting deploy + retry-bearing-seed validation.
4. **Lane L64 / Lever B (queued):** route integrity exhaustion to plan-assist gate. Open only if L63 doesn't close the duplicate-family escalation pattern, or if a future smoke surfaces the integrity-exhaustion path silently.
5. **Continuity blocker observation (out-of-phase):** L62-validate ch2 surfaced a continuity blocker about a planner/writer mismatch on Maret's hidden strength. Logged as a *future* phase candidate, not a sub-lane in this session — stay disciplined to the integrity+retry phase.

## Cost-Threshold Autonomy Note

Per `docs/session-start-contract.md` and updated `CLAUDE.md`: deploy + smoke at expected ≤$0.20 is well under the $2 ask-first threshold. Proceeding without further confirmation.

## Documentation Sweep (mandatory before session close)

- `docs/current-state.md`: lint guard line already cites L62 (commit `31e16a8`); update only if smoke surfaces a runtime change.
- `docs/decisions.md`: append §L62-validate entry.
- `docs/todo.md`: close L62 if validation is clean; otherwise leave as-is and queue specific next lane.
- `docs/lessons-learned.md`: append a generalized lesson if smoke surprises us (deploy-vs-local divergence, retry pattern surprise, etc.).
- `docs/sessions/lane-queue.md`: advance.
- Lane Results filled, experiment 386 concluded.

## Progress Log

- 2026-05-02 — Session opened. Runner archival landed in commits `744baf5`+`3473428`. L62 fix shipped in `31e16a8`. Session contract written. Cost-threshold autonomy adopted.
- 2026-05-02 — Phase brief written (`docs/sessions/2026-05-02-integrity-retry-phase-brief.md`, commit `dcb72ae`). Trace evidence for L41 carry-over confirms the duplicate-* fresh-prose-elsewhere pattern (commit `5d93613`).
- 2026-05-02 — L62-validate smoke (exp #386, novel `novel-1777766296959`) deployed to LXC, drafted ch1 + ch2 cleanly with 0 integrity issues across 28 beats. Verdict from smoke-stop-classifier: `new_blocker` — but the blocker is in CONTINUITY (Theo witnessing Maret's strength), not integrity. L62's hypothesis is clean pass for our phase.
- 2026-05-02 — L63 (Lever A) implemented: matched-pair `firstExcerpt` plumbing in `integrity.ts` + pair rendering in `retry-context.ts`. 175/175 lint+retry tests green; tsc clean. Pending deploy + retry-bearing seed for empirical validation.
