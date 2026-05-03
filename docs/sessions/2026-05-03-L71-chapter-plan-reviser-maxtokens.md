---
status: active
updated: 2026-05-03
role: lane-result
lane: 2026-05-03-L71-chapter-plan-reviser-maxtokens
experiment: 400
session: 2026-05-02-L68-multicall-halluc-vote
phase: planning (chapter-plan-reviser token-cap fix)
---

# L71 chapter-plan-reviser maxTokens Cap Fix

## Loop Contract

- **Goal + component:** raise the `chapter-plan-reviser` `maxTokens` ceiling so plan-revisions on long-tail chapters don't hit `finish_reason=length` and bail the novel at the plan-assist gate. `src/models/roles.ts:148` — `maxTokens: 6144 → 12288`. Pure config change; no schema, no prompt edit, no checker behavior.
- **Why (concrete evidence):** L70b A/B (exp #399) surfaced `fantasy-system-heretic` ch1 att 1 bailing `plan-assist reviser-rejected` with reviser hitting `completion_tokens=6144 finish_reason=length`. Whole-novel bail. DB diagnosis on `llm_calls` over 14 days: 1 of 25 reviser calls hit the cap (4% incidence; avg completion 1624 tokens, max 6144). The reviser uses DeepSeek V4 Flash with `thinking: true`, so reasoning tokens consume budget alongside structured output. On long-tail chapters (heretic ch1 had a single deviation requiring a substantial re-plan), the reasoning eats most of 6144, leaving no room for the JSON output → truncation → JSON parse fail → reviser-rejected → whole-novel bail at plan-assist.
- **Measurable signal:**
  - **Unit-level:** no test impact (config change only).
  - **Empirical:** retry the heretic seed at the post-fix commit. PASS = chapter-plan-reviser succeeds (no `finish_reason=length`), reviser produces a parseable outline, drafting proceeds.
- **Validated stop gates:**
  - **(a) Clean pass:** heretic retry produces a successful chapter-plan-reviser call and drafting reaches the integrity check (which is L70b's surface, validated separately). No new test failures (1057/1061 baseline preserved).
  - **(b) New dominant blocker:** retry bails on a different surface that is plausibly token-budget-induced (e.g. cost per call >2× baseline; reviser still hits a higher cap; downstream agents now fail because of larger upstream output).
  - **(c) Regression:** existing tests fail.
  - **(d) Infra failure:** tsc / test / DB unreachable.
  - **(e) Cost cap:** ~$0.05 for the heretic retry (single novel, partial chapter).
- **Starting commit:** `8567c29` (L70b ship + docs sweep).
- **Experiment ID:** 400 (ticket-class).
- **Budget cap:** ~$1 — tiny config change, single retry, no A/B fan-out.
- **Primary lane:** raise reviser maxTokens to give thinking-mode reasoning enough headroom on long-tail chapters.
- **Causal hypothesis:** the cap is currently set tight enough that on chapters needing substantial plan-revisions the reasoning + output combined exceeds 6144 tokens. Bumping to 12288 doubles the headroom; the average call (1624 tokens) is unaffected, only the long-tail benefits. Cost impact is bounded by the actual token consumption — providers bill on `completion_tokens` produced, not `max_tokens` requested.
- **Baseline:** L70b A/B exp #399 — heretic bailed plan-assist reviser-rejected ch1 att 1 with `completion_tokens=6144 finish_reason=length`.
- **Changed runtime lever:** `src/models/roles.ts:148` — `maxTokens: 6144 → 12288`.
- **Feedback signal:**
  - Unit: tsc clean; full suite stays at 1057/1061.
  - Empirical: heretic retry's chapter-plan-reviser call has `completion_tokens < 12288` AND `finish_reason ≠ length` AND drafting advances past the plan-assist gate.
- **Escalation rule:** if 12288 still gets capped on heretic, the next move is to either disable thinking on the reviser (simpler output, no reasoning budget consumed) or split plan-revisions into two-pass (diff identification + apply) so each pass has narrower scope.
- **Allowed parallel support work:** none — config-change-only.
- **DeepSeek V4 Flash concurrency plan:** none.
- **Deferred out-of-lane runtime changes:** none.
- **Files/scripts expected to change:** `src/models/roles.ts`, `docs/current-state.md`, `docs/decisions.md` (§L71), `docs/todo.md`.
- **Evidence artifact:** `tuning_experiments.id=400`; commit hash to be set; heretic retry novel ID + chapter-plan-reviser `llm_calls` row showing `completion_tokens` + `finish_reason`.

## Stop Gates

- (a) Clean pass: heretic retry produces a successful chapter-plan-reviser call (no `finish_reason=length`) and drafting reaches the integrity check.
- (b) New dominant blocker: retry bails on a budget-induced new surface; cost per call >2× baseline.
- (c) Regression: tests fail.
- (d) Infra failure.
- (e) Cost cap >$1.

## Command Plan

- Sample shape / N: 1 seed × 1 arm (`fantasy-system-heretic`) × 2 chapters at the post-fix commit.
- Probe-family key: `chapter-plan-reviser` `llm_calls` row's `completion_tokens` + `finish_reason`; `chapter_exhaustions` for any retry-attempt bails.
- Expected cost: ~$0.05 for the retry (single novel through ch1, possibly ch2).
- Command 1: edit `src/models/roles.ts:148`
- Command 2: `bunx tsc --noEmit`
- Command 3: `bun test src/models/` (no specific tests for this config; smoke check)
- Command 4: commit
- Command 5: `bash scripts/deploy-lxc.sh`
- Command 6: launch heretic retry (`ssh -f -n` + nohup pattern)
- Command 7: query `llm_calls` for the reviser call's outcome and chapter completion status

## Results

**Outcome: SHIP as defensive config bump.** Heretic retry at exp #400 (`novel-1777784619991`) completed both chapters cleanly in 13m 20s at $0.051 cost — no reviser invocation, no bails. Direct cap validation did not occur (chapter-plan-checker passed without escalation, so the reviser was never invoked); the previous bail at exp #399 was stochastic plan-deviation drift. The 12288 cap is shipped as defensive coverage for the documented 4% long-tail failure mode.

**Heretic retry summary (commit `f6b4aa4`, exp #400, novel-1777784619991):**

| metric | value |
|---|---|
| chapter 1 | APPROVED att 1 |
| chapter 2 | APPROVED att 1 |
| validation | passed pass 1 |
| chapter-plan-reviser invocations | 0 |
| chapter_exhaustions | 0 |
| total LLM calls | 119 (0 failed) |
| total cost | $0.051 |
| wall clock | 13m 20s |

**Stop-gate analysis:**

- **(a) Clean pass:** heretic retry produced no `finish_reason=length` AND drafting advanced past plan-assist. Strict reading requires the reviser to fire and succeed; retry-stochasticity meant the reviser never fired. **Indirectly met:** the novel completed without any plan-assist bail, which was the failure mode we were trying to prevent.
- **(b) New dominant blocker:** none — full novel approved cleanly.
- **(c) Regression:** tsc clean; no test changes (config-only).
- **(d) Infra failure:** none.
- **(e) Cost cap:** $0.051 / $1 budget.

**Caveat:** the 12288 cap is unvalidated against an actual cap-hit case in this lane. The historical evidence (exp #399 heretic ch1 att 1 hit 6144 with `finish_reason=length`) establishes the failure mode is real. The 12288 cap is a defensive bump, not a tested fix. Future evidence: the next reviser invocation that hits a long-tail chapter will reveal whether 12288 is sufficient. If a future cap-hit re-occurs at 12288, escalate per the lane's escalation rule (disable thinking on reviser, or split plan-revision into two passes).

**Lessons from this attempt:**

1. **Stochastic retry can mask the case you're trying to fix.** Heretic's previous bail (exp #399 ch1 att 1) was a chapter-plan-deviation that escalated to the reviser. The retry took a different path (chapter-plan-checker passed att 1) and the reviser was never invoked. Defensive config bumps for low-frequency failure modes will often not be directly validated by a single retry; the bump's value is bounded by the historical evidence, not the retry's outcome.
2. **Rate-of-failure data on the agent's `llm_calls` row is the right validation surface for a token-cap fix.** A retry showing the agent never fired is consistent with both "the fix worked" and "the fix wasn't needed this time." A retry where the agent fires AND `completion_tokens < new_cap` AND `finish_reason ≠ length` is the direct validation. For low-frequency failure modes, accept indirect validation (no bail) and rely on the historical 1/25 incidence as the prior.

