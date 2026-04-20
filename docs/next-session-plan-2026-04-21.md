---
status: queued
from_session: docs/sessions/2026-04-20-halluc-v1-and-rung0-and-v1a-pilot.md
created: 2026-04-20
---

# Next-Session Plan (queued from 2026-04-20 close)

Prioritized queue at 2026-04-20 session close. Start from the top.
Supersedes stale queue in `docs/next-session-plan.md` (which is from
the 2026-04-19 exhaustion-handler session and unrelated).

## 1. Land or iterate Codex's conditioning-floor scorer (uncommitted)

**Context.** Session ended with Codex CLI job `bc1biuhtt` still in flight. It had produced the following uncommitted work:

- Modified: `scripts/evals/run-salvatore-distinctness-v1.ts`
- Created: `scripts/evals/run-salvatore-distinctness-v1.test.ts`
- Created: `docs/evals/arm-configs/` (README.md + `v3.json`, `v4-fixed.json`, `v4-rotation.json`, `sonnet-profile.json`)

**What to do:**

1. Check `git status` — if files still uncommitted, the Codex job either completed silently or is still going. Look for a `tuning_experiments` row with `target='salvatore-distinctness-conditioning-floor'` to find its exp_id.
2. Review the diff. The 4 TODOs to verify closed:
   - `generateSample()` (was line 286) wired to inference backend with per-arm voice-card subset selection.
   - `judgePair()` (was line 324) wired to `gpt-5.4`.
   - `shufflePairDeterministic()` (was line 311) replaced with sha256-keyed seeded shuffler.
   - Arm-config schema documented + 4 JSONs match charter §4 ladder.
3. Run the smoke test from Codex's instructions (1 beat, 1 pair) — should reach generation loop without throwing `TODO`.
4. If acceptable, commit and deploy.
5. If not, iterate with a narrow follow-up prompt.

## 2. Trigger Codex adversary re-review of the conditioning-floor charter

Once the scorer lands:

```
/codex:adversarial-review docs/charters/salvatore-distinctness-conditioning-floor.md
```

The §11 readiness gate (scorer is functional) is the only thing holding the charter. Expect GREEN if the scorer works.

## 3. Run the conditioning-floor 3-arm eval

If GREEN: run 3 arms × 72 generations + 3 comparisons × 48 judge calls = 216 generations + 144 judge calls. Charter §8 budgets under one working day. No training spend.

Arms: `v3`, `v4-fixed`, `v4-rotation`, `sonnet-profile` (baseline ladder per charter §4). Use the arm-config JSONs at `docs/evals/arm-configs/`.

Decision gates per charter §7: SHIP (≥4/24 rotation gain, retention intact), ITERATE (middle), KILL (≤2/24).

## 4. Complete V1a pilot — the two missing arms (not the full 6-seed expansion)

**Context.** Exp #256 ran 2 of 4 charter arms. See `docs/pp2-floor-pilot-results.md` for the partial data and the scoping-error rationale.

**What to do:** run the two missing arms on the **same 3 seeds** before expanding seed count.

- `extractor` arm: `pre-planner-phase2-v1a` tag + measurement-only inference extractor on each of `fantasy-archive`, `fantasy-cartographer`, `fantasy-debt`, 5 chapters each.
- `mainv1a` observational arm: **current `main`** (with V1a in production) on the same 3 seeds × 5 chapters. Caveat per charter §2: current main has 2026-04-18 halluc v3 wire-in + 2026-04-20 beat-entity-list V1 defaults. Compare on adherence-only failing-chapter count to stay apples-to-apples with the tag's thinner verifier stack.

**Worktree state at session close.** `~/apps/nh-pp2-floor` worktree prompt file restored to baseline MD5 `ee928170` (baseline variant). The worktree itself is preserved. For `mainv1a` don't run from the worktree — run from `~/apps/novel-harness/` main deploy.

**After data lands**: combine with existing 2-arm data, run charter §7 decision rule across the complete 4-arm ladder, trigger adversary re-review.

## 5. halluc-leak-salvatore regex FN widen pass

**Context.** Commit `cc57752` shipped Rung 0 regex OR-combine. Residual 12 beats where adapter fired but regex missed:

- "dark elf" (generic variant of `drow`; add to token list)
- "Rumblebelly's" and similar possessive forms (regex word-boundary rejects suffix `'s`; widen pattern)
- "mithril" lowercase standalone (currently only `Mithril Hall` multi-word)
- "Aegis-fang" / "verbeeg" inconsistencies (both in list; investigate why regex missed — may be real bugs in `regex-leak.ts`)

**Effort.** ~1 hour, $0. Add unit tests first (`regex-leak.test.ts`) covering the 12 miss cases, then fix pattern until all green.

## 6. Resolve v5-stripped design gates (only if conditioning-floor verdict argues for it)

**Context.** `docs/ablation/salvatore-v5-stripped.md` is fully scoped, strip script ran successfully, training command gated on 4 decisions. Codex verdicts: a3 / b1 / c3 / d2. My disagreement: c2 (sequence after conditioning-floor) instead of c3 (merge into one eval).

**Decision gates remaining for user:**
- (a) Brief-side stripping scope — Codex says **a3**, I agree
- (b) Placeholder strategy — Codex says **b1**, I agree
- (c) Sequencing — Codex says **c3**, I argued **c2** (sequence)
- (d) Rename augmentation — Codex says **d2**, I agree strongly

**If conditioning-floor wins its gate**: v5-stripped premise reframes around leak reduction only (voice problem is solved by rotation). Possibly redundant with Rung 0 regex; may not need training at all.

**If conditioning-floor fails**: v5-stripped becomes a higher-priority alternative path for voice-without-leak. Resolve (a)/(b)/(d) via inline user chat; apply (c) as sequenced (already done).

## 7. Other low-priority follow-ups

- **Component-isolation testing methodology** (`docs/component-isolation-testing.md`) — pilot a replay harness on a real change to validate the framework.
- **ungrounded v4 active-learning harvest** — `scripts/hallucination/harvest-v4-candidates.ts` is a read-only stub; blocker is no `llm_call_adjudications` persistent label table. Separate decision.
