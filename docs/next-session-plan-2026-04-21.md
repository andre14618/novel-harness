---
status: in-progress
from_session: docs/sessions/2026-04-20-halluc-v1-and-rung0-and-v1a-pilot.md
created: 2026-04-20
last_updated: 2026-04-20
---

# Next-Session Plan (live queue, 2026-04-20 onward)

Prioritized queue at 2026-04-20 session close. Start from the top.
Supersedes stale queue in `docs/next-session-plan.md` (which is from
the 2026-04-19 exhaustion-handler session and unrelated).

## 1. Conditioning-floor scorer landed (2026-04-20) — DONE

Commit `e54b1fe` closed all four scorer TODOs (generation wired to
`executeAndLog` on the target adapter with per-arm voice-card subset
selection, judge wired to `gpt-5.4`, sha256-keyed deterministic
shuffler, stable arm-config JSON schema with 4 configs). Follow-on
commit `e9c8474` added the `profile-rotation` conditioning mode + new
`v4-profile-rotation.json` arm config to support the revised charter's
H2 lever (see item #2a).

## 2. Conditioning-floor charter adversary review — first round RED, revised, round 2 pending

**Round 1 (2026-04-20, Codex job `bshvls959`): RED.** Three blocking
issues + one warning recorded in charter §10.1 (commit `be133c5`):
bundled lever, distribution mismatch with live writer surface,
threshold metric not producible by the scorer.

**Revision (2026-04-20, commit `1749d16`).** Charter restructured:

- §2 hypothesis split into two sub-hypotheses — H1 (exampleLines rotation, tics/avoid fixed) and H2 (profile-field rotation, exampleLines fixed).
- §7 split into 7.1 proxy-eval gate (triage only, single-run aggregate) and 7.2 live-writer pilot gate (ship gate, 3-chapter fantasy novel on real `buildBeatContext` path).
- §4 ceiling relabeled "profile-only" to match the shipped `sonnet-profile.json` arm config.
- Falsification threshold in §3 converted to three-prong AND logic.
- §8 budget updated to 4 comparison arms + one pilot novel run.

**Scorer follow-on (commit `e9c8474`).** Added `profile-rotation`
conditioning mode to the scorer + `v4-profile-rotation.json` arm config.
Closes the §11 scorer-extension gate.

### 2a. Next action — adversary re-review (round 2)

```
/codex:adversarial-review docs/charters/salvatore-distinctness-conditioning-floor.md
```

Expect GREEN or narrow-YELLOW, since the three round-1 blockers have
been addressed structurally (not just reworded). If GREEN, proceed to
item #3 proxy-eval run. If YELLOW on one axis, iterate narrowly; if RED
again, this charter's approach is wrong and we consider dropping it in
favor of the raw corpus-expansion path.

## 3. Run the §7.1 proxy-eval (four non-baseline arms vs fixed v4)

Gated on item #2a GREEN verdict.

**Arm configs** (`docs/evals/arm-configs/`): `v3.json`, `v4-fixed.json`
(baseline), `v4-rotation.json` (H1), `v4-profile-rotation.json` (H2),
`sonnet-profile.json` (ceiling).

**Workload:** 4 comparison arms × 24 generations = 96 generations, plus
48 judge calls × 4 comparisons = 192 gpt-5.4 judge calls. Charter §8
budgets under one working day, no training spend.

**Command shape:**

```
EXPERIMENT_ID=<from scorer auto-create> bun scripts/evals/run-salvatore-distinctness-v1.ts \
  --arm-a-config docs/evals/arm-configs/v4-fixed.json \
  --arm-b-config docs/evals/arm-configs/v4-rotation.json \
  --judge-model gpt-5.4
```

Repeat for each non-baseline vs v4-fixed pairing.

**Decision gates per charter §7.1:** PROXY PASS (≥+4/24 aggregate gain for at least one of H1/H2, retention intact), PROXY ITERATE (middle), PROXY KILL (both ≤+2/24 or retention breach).

## 4. §7.2 live-writer pilot — gated on both item #3 proxy-eval pass AND plumbing decision

Gated on item #3 emitting PROXY PASS for at least one arm, AND on the
open "pilot plumbing" gate in charter §11.

**Pilot plumbing decision (do before running):** the scorer's proxy
eval does not exercise `buildBeatContext`. A pilot needs either

- (a) feature-flag plumbing: add an env-var or `WRITER_GENRE_PACKS`
  override so a novel run can select `fixed | rotation | profile-rotation`
  conditioning for `exampleLines`/`tics`/`avoid`. Clean, reversible,
  takes ~1-2 hours.
- (b) in-place override: temporarily edit `WRITER_GENRE_PACKS` fantasy
  pack to the winning conditioning, run pilots, revert. Faster but
  leaves the real runtime in an inconsistent state during pilots.

Recommend (a) — session retrospectives show in-place edits to shared
state cause regressions in unrelated runs.

**Pilot workload:** one fantasy seed (`fantasy-archive`,
`fantasy-cartographer`, or `fantasy-debt` — choose at launch), 3
chapters, fixed v4 vs winning arm conditioning, same prompt otherwise.
Measure adherence events, chapter-plan-checker deviations, halluc-leak
Rung 0 fire rate, subagent-eyeball distinctness.

**Decision gates per charter §7.2:** PILOT PASS (ship to default),
PILOT ITERATE (flag-gated ship or second seed), PILOT KILL (reopen
corpus expansion).

## 5. Complete V1a pilot — the two missing arms (not the full 6-seed expansion)

**Context.** Exp #256 ran 2 of 4 charter arms. See `docs/pp2-floor-pilot-results.md` for the partial data and the scoping-error rationale.

**What to do:** run the two missing arms on the **same 3 seeds** before expanding seed count.

- `extractor` arm: `pre-planner-phase2-v1a` tag + measurement-only inference extractor on each of `fantasy-archive`, `fantasy-cartographer`, `fantasy-debt`, 5 chapters each.
- `mainv1a` observational arm: **current `main`** (with V1a in production) on the same 3 seeds × 5 chapters. Caveat per charter §2: current main has 2026-04-18 halluc v3 wire-in + 2026-04-20 beat-entity-list V1 defaults. Compare on adherence-only failing-chapter count to stay apples-to-apples with the tag's thinner verifier stack.

**Worktree state at session close.** `~/apps/nh-pp2-floor` worktree prompt file restored to baseline MD5 `ee928170` (baseline variant). The worktree itself is preserved. For `mainv1a` don't run from the worktree — run from `~/apps/novel-harness/` main deploy.

**After data lands**: combine with existing 2-arm data, run charter §7 decision rule across the complete 4-arm ladder, trigger adversary re-review.

## 6. halluc-leak-salvatore regex FN widen pass

**Context.** Commit `cc57752` shipped Rung 0 regex OR-combine. Residual 12 beats where adapter fired but regex missed:

- "dark elf" (generic variant of `drow`; add to token list)
- "Rumblebelly's" and similar possessive forms (regex word-boundary rejects suffix `'s`; widen pattern)
- "mithril" lowercase standalone (currently only `Mithril Hall` multi-word)
- "Aegis-fang" / "verbeeg" inconsistencies (both in list; investigate why regex missed — may be real bugs in `regex-leak.ts`)

**Effort.** ~1 hour, $0. Add unit tests first (`regex-leak.test.ts`) covering the 12 miss cases, then fix pattern until all green.

## 7. Resolve v5-stripped design gates (only if conditioning-floor verdict argues for it)

**Context.** `docs/ablation/salvatore-v5-stripped.md` is fully scoped, strip script ran successfully, training command gated on 4 decisions. Codex verdicts: a3 / b1 / c3 / d2. My disagreement: c2 (sequence after conditioning-floor) instead of c3 (merge into one eval).

**Decision gates remaining for user:**
- (a) Brief-side stripping scope — Codex says **a3**, I agree
- (b) Placeholder strategy — Codex says **b1**, I agree
- (c) Sequencing — Codex says **c3**, I argued **c2** (sequence)
- (d) Rename augmentation — Codex says **d2**, I agree strongly

**If conditioning-floor wins its gate**: v5-stripped premise reframes around leak reduction only (voice problem is solved by rotation). Possibly redundant with Rung 0 regex; may not need training at all.

**If conditioning-floor fails**: v5-stripped becomes a higher-priority alternative path for voice-without-leak. Resolve (a)/(b)/(d) via inline user chat; apply (c) as sequenced (already done).

## 8. Other low-priority follow-ups

- **Component-isolation testing methodology** (`docs/component-isolation-testing.md`) — pilot a replay harness on a real change to validate the framework.
- **ungrounded v4 active-learning harvest** — `scripts/hallucination/harvest-v4-candidates.ts` is a read-only stub; blocker is no `llm_call_adjudications` persistent label table. Separate decision.
