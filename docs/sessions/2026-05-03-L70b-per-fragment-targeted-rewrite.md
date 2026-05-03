---
status: active
updated: 2026-05-03
role: lane-result
lane: 2026-05-03-L70b-per-fragment-targeted-rewrite
experiment: 399
session: 2026-05-02-L68-multicall-halluc-vote
phase: integrity (duplicate-fragment per-beat targeted rewrite)
---

# L70b Per-Fragment Beat-Targeted Rewrite (Lever I-D form (a))

## Loop Contract

- **Goal + component:** when `detectProseIntegrityIssues` returns duplicate-sentence / duplicate-fragment hits, route the rewrite at the *beat* granularity instead of regenerating the whole chapter. The writer's prompt does not change at all — only which beats retry. Files in scope: `src/lint/integrity.ts` (offset metadata), `src/phases/drafting.ts` (route to `runSettleLoop` between detection and chapter-attempt continuation), unit tests.
- **Why (concrete evidence):** L70 form (b) reverted under stop gate (b) on 2026-05-03 (exp #398). Approval rate matched 1/3 → 1/3 with a winner-swap (`fantasy-system-heretic` regressed from approved → bailed `plan-check-exhausted` on a halluc-ungrounded `"silver interlocking ring"` introduced on att 3; `fantasy-archive` shifted bail kind from duplicate-fragment to fused-boundary on `"6 A.M.*"`). Diagnosis: a stronger directive on the integrity surface caused the writer to take more creative risks across surfaces. Form (a) avoids that class entirely because it does not change the writer's prompt — it only narrows which beats retry, so the unaffected beats' prose is preserved verbatim and cannot drift into new failure modes.
- **Measurable signal:**
  - **Unit-level:** new tests assert (i) duplicate-fragment / duplicate-sentence issues carry `offset` and `firstOffset` fields with the correct char index, (ii) the offset → beat-index mapping returns the beat whose `[start, end)` window contains the offset on a `beatProses.join("\n\n")` chapter, (iii) `runSettleLoop` integration: when both halves of a duplicate map to the same beat, that one beat is rewritten; when they straddle two beats, only the *later* beat (the second occurrence) is rewritten so the earlier prose stays canonical.
  - **A/B (LXC, same 3 seeds):** at the L70b commit vs the L68 N=1 baseline (commit `47ae038`, exp #396 reuse) on `fantasy-archive` + `fantasy-debt` + `fantasy-system-heretic` ch1-2. Primary metric: chapter approval rate. Secondary metrics: (a) integrity-exhausted bail count, (b) per-attempt duplicate-fragment fire counts, (c) attempt count to convergence, (d) cost ratio.
- **Validated stop gates:**
  - **(a) Clean pass:** unit tests green; tsc clean; A/B shows ≥10pt approval improvement OR ≥30% reduction in integrity-exhausted bails on ≥2/3 novels with non-regressive cost AND no novel that was approved at L68 baseline regresses to a bail at L70b.
  - **(b) New dominant blocker:** any novel that was approved at L68 N=1 baseline regresses to a bail at L70b (same as L70 stop gate (b); cross-surface regression sentinel).
  - **(c) Regression:** previously-passing tests fail.
  - **(d) Infra failure:** tsc / test / DB unreachable.
  - **(e) Cost cap:** A/B exceeds $25 across the 3-novel sweep.
- **Starting commit:** `40268c6` (L70 revert).
- **Experiment ID:** 399
- **Budget cap:** ~$25 for the 3-novel A/B (per-beat targeted rewrite is cheaper per attempt than chapter regeneration; expected to be net under baseline cost).
- **Primary lane:** per-beat targeted rewrite for duplicate-fragment / duplicate-sentence; no writer-prompt change.
- **Causal hypothesis:** the duplicate-fragment / duplicate-sentence detector reports the issue at a specific char range. The duplicates concentrate in 1-2 beats per chapter (typically the high-density action or interiority beats). Rewriting only those beats — using the existing `runSettleLoop` machinery from chapter-plan-check — is sufficient to clear the duplicate without disturbing the rest of the chapter prose. Because the unaffected beats are not regenerated, the writer cannot drift into new failure modes elsewhere (the L70 form (b) regression class).
- **Baseline:** exp #396 N=1 arm: 1/3 chapters approved (heretic), 2 of 3 novels bail `integrity-duplicate-fragment` (arch, debt). Per-attempt issue progressions captured in `pipeline_events`.
- **Changed runtime lever:**
  - `src/lint/integrity.ts`: `LintFixIntegrityIssue` gains optional `offset?: number` (start of the colliding span on `text`) and `firstOffset?: number` (start of the first occurrence's span, set for duplicate-* kinds). All five detector helpers thread the offsets through; `dedupeIssues` keys remain `kind:excerpt` (offset is metadata, not identity).
  - `src/phases/drafting.ts`, integrity branch (~line 1305): if all duplicate-* issues map to ≤2 distinct beats AND `beatProses.length === outline.scenes.length`, route to `runSettleLoop` with budget=1 settle pass. The check closure re-runs `detectProseIntegrityIssues` on `beatProses.join("\n\n")`. The route closure maps `excerpt`'s `offset` (or `firstOffset` if the second occurrence is at the chapter end) to the containing beat. The rewriteBeat closure mirrors the chapter-plan-check pattern at drafting.ts:663 — same retry-context shape, same model, same `priorBeatProse` slice. On `accepted` outcome: clear `priorIntegrityIssues`, fall through to approval gate. On `exhausted` / `no-routing` / `ineligible`: keep the existing chapter-attempt fall-through and let `priorIntegrityIssues` carry over to the next chapter retry.
  - No change to `formatChapterIntegrityRetryContext` wording. No change to writer prompts.
- **Feedback signal:**
  - Unit: new tests in `src/lint/integrity.test.ts` for offset metadata; new tests at `src/phases/drafting.integrity-settle.test.ts` (or inline if no new file) for the offset → beat mapping; existing 24 retry-context tests stay green; full suite stays at 1044/1048 (4 pre-existing failures unchanged).
  - Empirical: post-deploy A/B re-runs the same 3 seeds at the L70b commit and compares per-attempt issue progressions, integrity-exhausted bails, chapter approval, and cost vs the L68 N=1 baseline.
- **Escalation rule:** if L70b doesn't move approval or integrity-exhausted bail count, the next lever is **L70c**: calibrated relaxation of the duplicate-fragment threshold (`gramSize` 8→10, or `maxTokenDistance` 120→60) backed by a recall test against historical duplicate-fragment fixtures.
- **Allowed parallel support work:** docs sweep on commit; retry-replay on the existing exp #398 chapter exhaustions for the heretic regression diagnosis (already captured in §L70 lessons).
- **DeepSeek V4 Flash concurrency plan:** none for the routing change itself; A/B uses 3 parallel novel runs (1 arm × 3 seeds).
- **Deferred out-of-lane runtime changes:** L70c (detector threshold), L69 G-C (planner sanctioned-new-entities).
- **Files/scripts expected to change:** `src/lint/integrity.ts`, `src/lint/integrity.test.ts`, `src/phases/drafting.ts`, `src/phases/drafting.integrity-settle.test.ts` (new), `docs/current-state.md`, `docs/decisions.md` (§L70b), `docs/todo.md`.
- **Evidence artifact:** `tuning_experiments.id=399`; commit hash to be set; per-attempt `prose-integrity-check` event progressions captured pre- and post-L70b; new `integrity-settle-outcome` trace events for the per-beat path.

## Stop Gates

- (a) Clean pass: unit tests green; A/B shows ≥10pt approval improvement OR ≥30% reduction in integrity-exhausted bails on ≥2/3 novels with non-regressive cost AND no novel approved at baseline regresses.
- (b) New dominant blocker: any novel that was approved at L68 N=1 baseline regresses to a bail at L70b. Any novel's duplicate bail moves to a different surface (fused-boundary, halluc-ungrounded) at higher rate than baseline.
- (c) Regression: existing tests fail (full suite must stay at 1044/1048).
- (d) Infra failure: tsc / test runner / DB unreachable.
- (e) Cost cap: A/B exceeds $25.

## Command Plan

- Sample shape / N: 3 seeds × 1 arm (L70b) × 2 chapters; baseline arm reuses exp #396 N=1 data for comparison.
- Probe-family key: chapter-1 `prose-integrity-check` per-attempt issue progression; new `integrity-settle-outcome` events; chapter approval status.
- Expected cost: ~$10-15 across 3 novels (per-beat rewrite is cheaper than chapter regeneration).
- Command 1: `bunx tsc --noEmit`
- Command 2: `bun test src/lint/ src/phases/drafting.integrity-settle.test.ts`
- Command 3: `bun test` (full suite)
- Command 4: `bash scripts/deploy-lxc.sh`
- Command 5: launch 3-novel L70b smokes (separate SSH per novel, ssh -f -n + nohup pattern from L68)
- Command 6: A/B comparison — adapt `scripts/replay/l68-vote-ab-compare.ts` to compare L70b vs L68-N1 arms, including settle-outcome breakdown.

## Results

(to be filled after A/B completes)
