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

(to be filled after retry completes)
