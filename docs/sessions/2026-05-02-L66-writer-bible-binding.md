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

## Results

(pending)

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md` (grounding entry — writer-side constraint), `docs/todo.md` (close G-B candidate / queue G-A2 promotion or G-C if A/B fails), `docs/decisions.md` (§L66), this lane doc.
- Experiment concluded: 393.
- Final checks: `bun test`, `bunx tsc --noEmit`, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.
- Independent review: A/B smoke is the empirical evidence; mark waiver only if numerical improvement is unambiguous.
- Final docs/cleanup commit before stop/queue handoff.
