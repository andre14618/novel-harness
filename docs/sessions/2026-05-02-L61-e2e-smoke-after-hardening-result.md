---
status: closed
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L61-e2e-smoke-after-hardening
experiment: 384
novel: novel-1777761636607
---

# L61 End-To-End Smoke After Hardening — Result

## Outcome

Stop gate (b) — new dominant blocker. The post-L57 smoke halted at chapter 1 after exhausting all three attempts on the prose-integrity guard. The blocker is outside lane scope; do not patch in this lane.

## Run Identifiers

- Experiment: `tuning_experiments.id=384` (commit `6d89447`)
- Novel: `novel-1777761636607`, seed `fantasy-system-heretic`, `--chapters 3 --auto`
- LXC log: `/tmp/smoke-l61-fantasy-system-heretic-1777761636.log` (LXC 307)
- Operator summary JSON snapshot: `/tmp/l61-opsum.json` (LXC)
- Smoke-stop classifier verdict: `human_needed` (`gates_total=0` because the failure surfaces as integrity guard, not a plan-assist gate).

## Evidence Packet

- Final phase: `drafting`. Pause reason: `chapter-attempts-exhausted:ch1` ("Stopping drafting. Resume later with --resume flag.").
- Chapter 1 attempts: 3/3, all rejected by `detectProseIntegrityIssues`.
  - attempt 1: 1 issue
  - attempt 2: 5 issues
  - attempt 3: 7 issues
- Plan check: passed on every attempt (1 attempt needed 1 targeted rewrite pass).
- Continuity: no issues found across all attempts.
- Functional checks: 5–10 warnings per attempt (mostly `established_fact_missing` / `character_state_missing` / `knowledge_change_missing`); inspection of the explanation text shows most are "supported by quoted prose" — i.e. functional-state checker over-reports, but is non-blocking. Not the stop gate.
- AND-gate matrix: 25 pass, 14 ner-only-warning, 2 ner+llm-blocker. Two-stage adherence: 41 stage-1 / 5 stage-2.
- No `failedCalls`, no LXC infra failures, no provider exhaustions.

### Prose-integrity issues recorded (issues table, novel `novel-1777761636607`, chapter 1)

- `fused-boundary` (8 rows) — all variants of the in-world System UID `*SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.*`. The detector treats `.` followed by a capital letter as a sentence boundary; LitRPG path-style identifiers that legitimately contain dots followed by a capitalized next token (e.g. `MARET.ANNUAL. Class:`) are mislabeled as fused boundaries.
- `quote-integrity` (1 row) — paragraph with internal quoted reference + dialogue tag fails the per-paragraph quote-pair check.
- `duplicate-fragment` / `duplicate-sentence` (4 rows) — true duplications introduced by retry attempts (e.g. `Don't look at me.` repeated, `The cross-reference on folio twelve-B,` paragraph repeated). Genuine quality regression that escalates with each retry.

## Cost

- Per-agent total from `operator-summary --json`: ≈ $0.066 across 177 LLM calls (largest contributors: beat-writer $0.017, planning-state-mapper $0.0093, chapter-plan-checker $0.0066, halluc-ungrounded $0.0062, adherence-events $0.0059). Well under the $4 lane cap.

## Commit(s)

- Lane starting commit: `6d89447` (already deployed; `git diff --stat 6d89447..HEAD -- src/ sql/` was empty before launch).
- Lane finalization commit: this docs/cleanup commit (recorded in lane doc).

## Stop Gate Fired

(b) New dominant blocker. Two distinct, real findings:

1. **Prose-integrity false-positive on LitRPG System path identifiers.** `detectFusedBoundaries` in `src/lint/integrity.ts:46` accepts ANY `.` followed by a letter as a fused boundary unless the prior char is `.` (only handles ellipses). LitRPG/system identifiers like `SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.` are a legitimate genre construct (the harness explicitly markets `litrpg` seeds and `fantasy-system-heretic` is a System-anomaly premise) but every dot inside the identifier becomes a guard hit, blocking the chapter.
2. **Retry escalates the failure rather than correcting it.** Chapter-attempt loop carries forward the integrity-issue list to the next attempt's beat-writer (drafting.ts:1289-1291), but the writer is producing *more* duplicate fragments per attempt (1 → 5 → 7) instead of fewer. The integrity carry-over reminder is not actually steering the regenerator off the duplicated content; in this seed the writer keeps re-emitting the System UID block and the same ledger reference paragraph.

## Next Lane Recommendation (L62 candidate)

Single-lever lane: harden `detectFusedBoundaries` against LitRPG/System path identifiers — recognize all-caps dotted token runs (`/^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/` style) as a single token rather than sentence-boundary candidates, with a regression fixture drawn from this novel's draft. Decide separately (do not bundle) whether the chapter-attempt retry should fall through to plan-assist after the second integrity failure rather than re-rolling a third attempt that demonstrably degrades. Both are out of L61 scope.

## Review

`impl-review` not required: this lane shipped no runtime change; the only commit is docs/result capture. Recording as **review-waived: classification-only docs** (waiver reason: lane was validation-only; runtime decisions deferred to follow-up lanes per escalation rule).
