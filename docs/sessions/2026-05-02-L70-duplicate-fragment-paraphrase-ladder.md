---
status: active
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L70-duplicate-fragment-paraphrase-ladder
experiment: 398
session: 2026-05-02-L68-multicall-halluc-vote
phase: integrity (duplicate-fragment chapter-attempt convergence)
---

# L70 Duplicate-Fragment Paraphrase Ladder (Lever I-D)

## Loop Contract

- **Goal + component:** strengthen the carry-over directive in `formatChapterIntegrityRetryContext` (`src/agents/writer/retry-context.ts`) for duplicate-sentence / duplicate-fragment so the writer rewrites BOTH sides of a colliding pair when needed, instead of only paraphrasing one side. Pure prompt-only change; no schema, no detector, no checker behavior change.
- **Why (concrete evidence):** L68 A/B sweep (exp #396) produced 5 of 7 novels bailing `integrity-duplicate-fragment` in chapter 1 after 3-4 attempts. Inspection of the per-attempt `prose-integrity-check` events shows the writer DOES paraphrase across attempts (debt-n2: 2→5→1, arch-n2: 3→4→1) but converges with ≥1 fragment unresolved. The surviving fragments are stylistic short repeats like `"he was not wrong. That w[as]"` — phrases the writer can naturally reuse but won't strip on a "paraphrase one side" directive that only forces ONE half to change. Issue progression evidence: 5 novels' per-attempt counts in `pipeline_events.event_type='prose-integrity-check'`.
- **Measurable signal:**
  - **Unit-level:** new tests assert the prompt contains `"Rewrite at least one side using distinct concrete language"` and `"If a single paraphrase still leaves the 8-word phrase shared, rewrite both sides"`. Existing tests updated to expect the new label `(rewrite at least one side with different verbs/imagery)` instead of `(paraphrase one side)`.
  - **A/B (LXC, same 3 seeds):** at the L70 commit vs the L68 commit on `fantasy-archive` + `fantasy-debt` + `fantasy-system-heretic` ch1-2, primary metric is **chapter approval rate** with secondary metrics on (a) integrity-exhausted bail count, (b) duplicate-fragment fire counts at att 1 vs final att, (c) attempt count to convergence, (d) per-attempt issue progression.
- **Validated stop gates:**
  - **(a) Clean pass:** unit tests green; tsc clean; A/B shows ≥10pt approval improvement OR ≥30% reduction in integrity-exhausted bails on ≥2/3 novels with non-regressive cost.
  - **(b) New dominant blocker:** approval regresses (e.g. the rewrite-both directive over-stresses prose and surfaces a new failure mode). Mirrors L66 v1 stop gate (b).
  - **(c) Regression:** previously-passing tests fail.
  - **(d) Infra failure:** tsc / test / DB unreachable.
  - **(e) Cost cap:** A/B exceeds $25 across the 3-novel sweep.
- **Starting commit:** `37b126f` (L68 + L60 docs sweep)
- **Experiment ID:** 398
- **Budget cap:** ~$25 for the 3-novel A/B (prompt-only change, baseline arm reuses exp #396 N=1 data so only 3 new arms to run).
- **Primary lane:** carry-over prompt strength for duplicate-fragment paraphrase.
- **Causal hypothesis:** the writer paraphrases SOME duplicates per attempt but converges into a different attractor where a single-side paraphrase isn't enough to break the 8-token shared phrase. Forcing the writer to consider BOTH sides — and explicitly listing concrete language axes (verbs, sensory anchors, sentence shape) — should accelerate convergence below the 3-attempt budget.
- **Baseline:** exp #396 N=1 arm: 1/3 chapters approved, 4 of 6 novels bail `integrity-duplicate-fragment`, per-attempt issue progressions captured in `pipeline_events`.
- **Changed runtime lever:**
  - `src/agents/writer/retry-context.ts` line 134-138: replace `"paraphrase one side; do not delete a beat"` directive with `"Rewrite at least one side using distinct concrete language — different verbs, different sensory anchors, different sentence shape. If a single paraphrase still leaves the 8-word phrase shared, rewrite both sides. Keep the beats themselves intact."`
  - `formatIssueLine` label: `(paraphrase one side)` → `(rewrite at least one side with different verbs/imagery)`.
  - Tests: `src/agents/writer/retry-context.test.ts` updates to assert the new directive language.
- **Feedback signal:**
  - Unit: 24 tests in `retry-context.test.ts` pass; 1044/1048 production tests pass (4 pre-existing baseline failures unchanged).
  - Empirical: post-deploy A/B re-runs the same 3 seeds at the L70 commit and compares per-attempt issue progressions plus chapter approval.
- **Escalation rule:** if the L70 prompt change doesn't move approval rate or integrity-exhausted bail count, the next lever is **L70b / Lever I-D form (a)**: per-fragment beat-targeted rewrite (L41 ladder analog scoped to the duplicate-bearing beat only via char-offset → beat mapping). If THAT doesn't move it, **L70c**: calibrated relaxation of the duplicate-fragment threshold (gramSize 8→10, or maxTokenDistance 120→60) with a recall test against historical duplicate-fragment fixtures.
- **Allowed parallel support work:** docs sweep on commit; retry-replay on the existing exp #396 chapter exhaustions.
- **DeepSeek V4 Flash concurrency plan:** none for the prompt change itself; A/B uses 3 parallel novel runs (1 arm × 3 seeds).
- **Deferred out-of-lane runtime changes:** L70b (per-fragment targeted rewrite), L70c (detector threshold), L69 G-C (planner sanctioned-new-entities).
- **Files/scripts expected to change:** `src/agents/writer/retry-context.ts`, `src/agents/writer/retry-context.test.ts`, `docs/current-state.md`, `docs/decisions.md` (§L70), `docs/todo.md`.
- **Evidence artifact:** `tuning_experiments.id=398`; commit hash to be set; per-attempt `prose-integrity-check` event progressions captured pre- and post-L70.

## Stop Gates

- (a) Clean pass: unit tests green; A/B shows ≥10pt approval improvement OR ≥30% reduction in integrity-exhausted bails on ≥2/3 novels with non-regressive cost.
- (b) New dominant blocker: approval regresses on any novel; OR new failure mode (e.g. adherence misses or beat-skip).
- (c) Regression: existing retry-context tests fail; previously-passing test suites fail.
- (d) Infra failure: tsc / test runner / DB unreachable.
- (e) Cost cap: A/B exceeds $25.

## Command Plan

- Sample shape / N: 3 seeds × 1 arm (L70) × 2 chapters; baseline arm reuses exp #396 N=1 data for comparison.
- Probe-family key: chapter-1 `prose-integrity-check` per-attempt issue progression; chapter approval status.
- Expected cost: ~$15-20 across 3 novels.
- Command 1: `bunx tsc --noEmit`
- Command 2: `bun test src/agents/writer/`
- Command 3: `bun test` (full suite)
- Command 4: `bash scripts/deploy-lxc.sh`
- Command 5: launch 3-novel L70 smokes (separate SSH per novel, ssh -f -n + nohup pattern from L68)
- Command 6: A/B comparison — adapt `scripts/replay/l68-vote-ab-compare.ts` to compare L70 vs L68-N1 arms.

## Results

**Outcome: REVERTED via stop gate (b). Approval rate matched (1/3 → 1/3) but with a winner-swap that surfaced a regression on `fantasy-system-heretic`.**

**A/B sweep (3 seeds × 1 arm at L70 commit `4362fc0`, baseline reuses exp #396 N=1, $0.16 total at L70 arm):**

| seed | L68 N=1 baseline (commit `47ae038`) | L70 (commit `4362fc0`) | direction |
|---|---|---|---|
| `fantasy-archive` | bailed integrity-exhausted ch1 att 4 (3 dup-frag persistent) | bailed integrity-exhausted ch1 att 5 (fused-boundary `"6 A.M.*"` from creative punctuation) | sideways — different sub-kind, equivalent gating outcome |
| `fantasy-debt` | bailed integrity-exhausted ch1 (1 dup-frag persistent) | **APPROVED ch1 att 3** (drafting ch2) | clean win |
| `fantasy-system-heretic` | **APPROVED ch1 att 2** (0 issues by att 2) | bailed plan-check-exhausted ch1 att 3 (halluc-ungrounded `"silver interlocking ring"`) | regression |

Net approval: 1/3 → 1/3 (winner swapped from heretic to debt). Integrity-exhausted bails: 2 → 1 (50% reduction; meets the rollup ≥30% but only 1 of 3 novels improved on that surface, missing the per-novel ≥2/3 criterion). New blocker on heretic (halluc-ungrounded) is a different surface — but the causal chain is plausibly L70-driven: more aggressive integrity carry-over → att 1 produces 4 issues (vs baseline 1) → writer takes more creative risks on retry → att 3 introduces a new entity that halluc-ungrounded blocks. Three-step chain dominated by stochastic prose generation; cannot fully attribute, but consistent with stop gate (b).

**Per-attempt issue progressions (duplicate-fragment counts):**

- arch baseline: 3 → 3 → 3 (stuck)
- arch L70: 1 → 2 → 3 (started lower but ended same)
- debt baseline: 1 → 1 → 1 (stuck)
- debt L70: 0 → 0 → ... (clean — but baseline att 1 already had 1, so the seed-level prose drift may explain the difference)
- heretic baseline: 1 → 0 (clean att 2)
- heretic L70: 3 → 5 → ... (got worse before bail kind shifted to halluc)

**Stop-gate analysis:**

- **(a) Clean pass:** ≥10pt approval improvement OR ≥30% reduction in integrity-exhausted bails on ≥2/3 novels with non-regressive cost. Approval delta = 0pt. Integrity-exhausted bails fell 2→1 (50%) but only one novel changed (debt). Per-novel criterion not met. Cost ratio L70/baseline ~1.05× (within bound). **NOT MET.**
- **(b) New dominant blocker:** approval regresses on any novel. Heretic went from approved → bailed (different bail kind, but the gating outcome regressed). **FIRES.**
- **(c) Regression:** existing tests don't fail; 24/24 retry-context tests pass; tsc clean. NOT FIRED.
- **(d) Infra failure:** none. NOT FIRED.
- **(e) Cost cap:** $0.16 / $25 budget. NOT FIRED.

**Decision: REVERT L70 prompt change** to the pre-L70 wording. Per the user's standing rule "force continued looping," pivot directly to **L70b / Lever I-D form (a)**: per-fragment beat-targeted rewrite (L41 ladder analog, scoped to the duplicate-bearing beat only via char-offset → beat mapping). Form (a) does not change the writer's prompt at all — it scopes which beat retries — so it cannot induce the creative-risk pattern that L70 form (b) appears to have triggered.

**Lessons from this attempt:**

1. **Prompt-only escalations can leak across surfaces** — L70 changed the integrity carry-over only, but heretic's bail moved to halluc-ungrounded. The writer's response to a stronger directive on one surface affected its behavior on a different surface (more entities surfaced for halluc to flag). Multi-surface coupling is real for prompt changes that affect writer creativity, even when the change is scoped to one issue type.
2. **3-novel single-arm A/B has high variance** — debt's win and heretic's loss are swapping under stochastic prose generation; a paired-replay with N≥3 runs per arm would distinguish lever effect from prose noise. Future integrity-prompt A/Bs should use paired replay (`scripts/replay/l63-retry-replay.ts` analog) over fresh smokes when the lever is small.
3. **"Different sentence shape" induced punctuation experimentation** — arch L70 produced `"6 A.M.*"` (asterisk after period) — likely the writer experimenting with footnote-style markers when the directive said "different sentence shape." Future prompts that ask for "different shape" should constrain the axis explicitly (e.g. "different verbs and clauses, but keep the same punctuation conventions").

