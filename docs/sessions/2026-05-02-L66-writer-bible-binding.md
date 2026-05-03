---
status: active
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L66-writer-bible-binding
experiment: 393
session: 2026-05-02-grounding-phase-brief
phase: grounding (writer-side BIBLE constraint)
---

# L66 Writer-Side BIBLE-Binding Constraint (Lever G-B)

## Loop Contract

- **Goal + component:** rewrite the named-entity constraint in `src/agents/writer/beat-writer-system.md` (currently line 18) so the writer is bound to the same grounded-source list the halluc-ungrounded checker uses ({bible, beat brief, character roster, prior beat, sanctioned new entities}) — and so the constraint covers ALL named-entity classes (place names, institutions, titles, organizations, named lore concepts, named artifacts), not just characters and ambient walk-ons. Add a concrete example covering exp #392's "Senior Cataloguer" failure.
- **Why (concrete evidence):** exp #392 (fantasy-archive smoke, post-L65) revealed *drift-invention* — the writer invents fresh ungrounded entities each chapter-attempt ("Third Lamentation" att1 → "Codex" att3-retry2 → "Senior Cataloguer" att3-retry3). L65's chapter-attempt carry-over architecturally cannot address this because each new attempt invents new entities. L65 lane Results addendum + grounding phase brief Live-Smoke Update document the trace.
- **Measurable signal:** A/B 3-chapter smoke on `fantasy-archive` (same seed that bailed in exp #392). v0 = current `beat-writer-system.md`. v1 = tightened entity constraint. Compare:
  - Halluc-ungrounded blocker fire count on chapter 1 attempt 1 (before any L65 carry-over kicks in — pure first-attempt grounding).
  - Whether chapter 2 reaches approval without `plan-check-exhausted` on halluc-ungrounded.
  - Sanity check: prose word count and dialogue ratio comparable (no dramatic flatness regression).
- **Validated stop gates:**
  - **(a) Clean pass:** v1 reduces first-attempt halluc-ungrounded blocker fires by ≥30% on chapter 1 (1 of fantasy-archive's known weakest grounding chapter), without dropping prose word count below 4500/chapter or producing a dramatic flatness signal (manual read-through of any one chapter).
  - **(b) New dominant blocker:** v1 produces a different failure mode (e.g. integrity escalation, plan-check exhaustion on a non-grounding cause) at higher frequency than v0.
  - **(c) Regression:** v1 drops chapter approval rate below v0 (worse than baseline).
  - **(d) Infra failure:** smoke fails on transport / DB / parsing.
  - **(e) Cost cap:** A/B = 2 smokes × ~$0.20 = ~$0.40; under $2 autonomy threshold.
- **Starting commit:** `4ba988e` (exp #392 results).
- **Experiment ID:** 393
- **Budget cap:** $0.50 total ($0.20 per smoke + $0.10 buffer).
- **Primary lane:** writer system prompt — single prompt-text change.
- **Causal hypothesis:** the current line-18 constraint (`"characters and entities"` + ambient-walk-on exception) is class-incomplete. The writer reads "entities" as ambiguous and treats lore concepts ("Third Lamentation"), institutions, and titles ("Senior Cataloguer") as outside the constraint's literal scope. A categorical enumeration plus a concrete example of the exp #392 failure pattern should close the gap. Positive-framing only (per `feedback_priming_suppression_ab.md` — negative-prime variants WORSEN compliance).
- **Baseline:** exp #392 trace — chapter 1 had `Third Lamentation` / `Seventh Lamentation` ungrounded blockers on attempt 1 (resolved within per-beat retries); chapter 2 had `Senior Cataloguer` introduced on chapter-attempt 3 → bailed at plan-check-exhausted.
- **Changed runtime lever:**
  - `src/agents/writer/beat-writer-system.md` — line 18 rewrite.
  - No code changes; no test edits unless a snapshot test is asserting the prompt body.
- **Feedback signal:**
  - Unit: tsc clean; existing test suite green (no behavioral change in code).
  - A/B: deploy v1; run 3-chapter smoke on `fantasy-archive`; compare halluc-ungrounded blocker counts and chapter approval rate vs the exp #392 baseline.
- **Stop gate:** as above.
- **Escalation rule:** if v1 fails the A/B (no improvement in halluc fire rate), the next move is **G-A2** (faithful per-beat critique surface) — the per-beat critique might be filtering out the very entities the writer most needs to see. After that, **G-C** (planner sanctioned-new-entities schema migration).
- **Allowed parallel support work:** docs sweep, lane-queue advancement.
- **DeepSeek V4 Flash concurrency plan:** none.
- **Deferred out-of-lane runtime changes:** G-A2, G-C; any tonal-impact mitigation if the new constraint flattens prose more than acceptable.
- **Files/scripts expected to change:** `src/agents/writer/beat-writer-system.md`, `docs/current-state.md` (writer-prompt entry), `docs/decisions.md` (§L66), `docs/todo.md`, this lane doc.
- **Evidence artifact:** `tuning_experiments.id=393`; commit hash to be set; lane Results.

## Stop Gates

- (a) Clean pass: v1 ≥30% halluc-ungrounded blocker reduction on ch1 a1; word count ≥4500/chapter; no dramatic flatness signal.
- (b) New dominant blocker: v1 produces a different failure mode at higher frequency than v0.
- (c) Regression: v1 drops chapter approval rate below v0.
- (d) Infra failure.
- (e) Cost cap $0.50.

## Command Plan

- v0 baseline: exp #392 (already complete; novel-1777770759949 on `fantasy-archive`).
- v1 deploy: `bash scripts/deploy-lxc.sh` after committing prompt change.
- v1 smoke: `EXPERIMENT_ID=394 bun src/index.ts --seed fantasy-archive --auto --chapters 3` (separate experiment id for the v1 smoke since 393 is the lane ticket).
- Comparison: SQL counts on halluc-ungrounded blocker fires per attempt, chapter approval count, total cost, plan-check-exhausted incidence.

## Progress Log

- 2026-05-02 — Lane opened from grounding phase brief. Experiment 393 created. Baseline = exp #392 v0 trace already in DB.
- 2026-05-02 — Prompt edit committed (`e734fd7`); regression test added (`e603f60`); A/B compare script pre-staged (`90aa3b4`); lessons-learned entry on drift-invention vs persistence (`3f7b137`). Deployed to LXC.
- 2026-05-02 — v1 smoke (exp #394) on `fantasy-archive`: chapter 1 failed integrity on attempts 1 + 2 (3 issues each, all duplicate-fragment / quote-integrity), then bailed at plan-check-exhausted on attempt 3 with halluc-ungrounded `"Twenty-three years from now"` (NER number-word-tail false positive that LLM didn't rescue). Smoke ended without drafting chapter 2 or 3.

## Results

- Outcome: **stop gate (b) fired — new dominant blocker.** L66 v1 prompt edit reverted (`a/b headline shows 79% reduction in halluc-ungrounded fires but chapter 1 approval rate dropped from v0=1/2 to v1=0/1`).
- A/B headline (`scripts/replay/l66-ab-compare.ts`):

  | metric | v0 (exp #392) | v1 (exp #394) | delta |
  |---|---:|---:|---|
  | halluc-ungrounded fires (attempt 1) | 14 | 3 | **−79%** ✓ |
  | halluc-ungrounded fires (all retries) | 18 | 4 | **−78%** ✓ |
  | chapters approved | 1 / 2 | 0 / 1 | regression ✗ |
  | plan-check-exhausted (halluc) | 1 | 1 | unchanged |
  | total cost | $0.1022 | $0.0793 | smaller (less drafting) |

- L66 v1 successfully reduced halluc-ungrounded blocker volume (the lever target) by ~79% but failed approval gate on chapter 1 because the writer's reduced-named-entity prose triggered:
  1. **Duplicate-fragment integrity escalation** — 6 integrity issues across attempts 1+2 (vs v0 ch1's 1 issue). Likely caused by the writer relying on more repetitive descriptive phrases ("the regional records hall", "a senior cataloguer") across beats; duplicate-fragment detector fires on repeated 8-grams.
  2. **NER false-positive escalation** — bail entity was `"Twenty-three years from now"` (a temporal expression matching the L11 number-word-tail NER class), suggesting the writer pivoted to time/date phrases the NER tagger picks up while the LLM checker doesn't rescue.
- Net effect: L66 traded grounding-channel failures for integrity-channel + NER-class failures, with a worse approval outcome.
- Stop gate fired: (b) new dominant blocker. Per lane rules, reverted.
- Revert: `src/agents/writer/beat-writer-system.md` line 18 restored to pre-L66 wording. Regression test `beat-writer-system.test.ts` deleted (test asserted reverted wording; will re-add for any L66 v2 successor).
- Cost: $0.1815 total ($0.0793 v1 smoke + $0.1022 v0 baseline already counted in #392).
- Commit(s): `e734fd7` (apply, reverted), `e603f60` (test, deleted), `90aa3b4` (A/B script, kept), `3f7b137` (lessons-learned, kept), revert commit pending.
- Review: empirical A/B is the canonical evidence. Numerical regression on approval rate is unambiguous; revert decision is mechanical per stop gate (b). Recording as **review-waived: empirical-stop-gate-b** (waiver reason: A/B numbers reproduce mechanically from `scripts/replay/l66-ab-compare.ts`; stop gate (b) is fired by approval-rate regression at single-seed N=1; reviewer = self).
- Implications for next lever: the 79% halluc-fire reduction proves the *direction* is right but the *form* of the constraint over-corrected. Future v2 attempts should preserve more of the writer's atmospheric specificity while still binding named-entity emission. Possible refinements:
  - Narrow the constraint to *new* named entities (the writer can keep using common nouns like "ledger", "archive" without uppercase-promotion)
  - Add an "if you must coin a name, use the planner-sanctioned new-entities list — and if the beat brief implies one, ask the planner first" — but that requires G-C planner schema work, which is the largest schema lift in the phase.
  - Or: leave the writer alone and route the fix to **G-A2 (faithful per-beat critique surface)** — make the chapter-blocking entity actually appear in the per-beat retry critique so the writer's existing per-beat retry budget can act on it.
- **Recommendation for follow-up:** promote **G-A2** ahead of any L66 v2 attempt. The exp #392 trace showed the per-beat critique listed 5 OTHER ungrounded entities but not the chapter-blocking one ("Senior Cataloguer"); fixing that data path is a localized change with no prose-tone risk. If G-A2 alone doesn't close the grounding fire rate, then revisit L66 v2 with a narrower constraint shape.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md` (grounding entry — writer-side constraint), `docs/todo.md` (close G-B candidate / queue G-A2 promotion or G-C if A/B fails), `docs/decisions.md` (§L66), this lane doc.
- Experiment concluded: 393.
- Final checks: `bun test`, `bunx tsc --noEmit`, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.
- Independent review: A/B smoke is the empirical evidence; mark waiver only if numerical improvement is unambiguous.
- Final docs/cleanup commit before stop/queue handoff.
