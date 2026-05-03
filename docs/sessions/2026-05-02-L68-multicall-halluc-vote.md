---
status: active
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L68-multicall-halluc-vote
experiment: 396
session: 2026-05-02-grounding-phase-brief
phase: grounding (halluc-ungrounded checker stochasticity)
---

# L68 Multi-Call Halluc-Ungrounded with Vote/Union per Beat (Lever G-D)

## Loop Contract

- **Goal + component:** add a `voteN` parameter to `checkHallucUngrounded` in `src/agents/halluc-ungrounded/index.ts` controlling how many parallel LLM calls run per beat. Default 1 (back-compat). When N>1, the deterministic NER prepass runs once, then N parallel `callAgent` invocations issue concurrent halluc-ungrounded LLM calls; the **union** of LLM-confirmed flagged entities feeds the existing L40 grounded-surface filter and the existing AND-gate assembly. Production default flipped to N=2 via a new `pipeline.hallucVoteN` flag, env-overridable as `HALLUC_UNGROUNDED_VOTE_N`.
- **Why (concrete evidence):** exp #389 + #395 trace of beat 13's three halluc-ungrounded LLM calls (ids 58908 / 58911 / 58914) on byte-identical prose showed the same prose flagged different entities each call: att1 → "Kepten Maret N.", att2 → "Intelligence" / "Endurance", att3 → "central spire". A single-call check therefore misses ~2/3 of the present-but-stochastic blockers per beat. L65 (chapter-attempt carry-over) only captures the *next* attempt's findings; it cannot widen the *current* attempt's per-beat surface, so the writer's per-beat retry budget is spent against an artificially narrow signal. Closes the L67/G-A2 finding (the per-beat critique surface IS faithful — the gap is checker stochasticity, not data-path divergence; see `docs/decisions.md` §L67).
- **Measurable signal:**
  - **Unit-level:** new fixture set asserts (1) N=1 preserves byte-identical behavior to current main, (2) N=2 with two LLM calls flagging disjoint entities {X} and {Y} returns union {X,Y}, (3) N=2 with both calls passing returns pass=true and empty issues, (4) duplicate flags across N calls dedup to one entry, (5) `issuesSeverity[]` parallel array reflects union-aware severity (LLM-only vs NER+LLM intersection still distinguished after union).
  - **Empirical (DB):** for a fixed beat, the number of distinct LLM-flagged entities at N=2 ≥ N=1 (union monotonicity).
  - **A/B (LXC, 3 novels):** at N=2 vs N=1 baseline, on `fantasy-archive` + `fantasy-debt` + `fantasy-system-heretic` ch1-3, primary metric is **chapter approval rate** with secondary metrics on (a) total chapter-blocking entities surfaced per beat, (b) checker-stability (entities flagged consistently across N runs), (c) cost delta.
- **Validated stop gates:**
  - **(a) Clean pass:** unit tests green; tsc clean; A/B shows ≥10pt improvement in chapter approval rate on at least 2/3 novels OR ≥2× increase in average distinct entities flagged per blocked beat with non-regressive approval rate.
  - **(b) New dominant blocker:** approval rate regresses on any novel (mirroring the L66 v1 stop-gate-(b) pattern), e.g. union pulls in too many false-positive entities and the writer over-corrects.
  - **(c) Regression:** previously-passing tests fail; or N=1 path produces different output than current main.
  - **(d) Infra failure:** tsc / test runner / DB unreachable; or LXC concurrency limit exhaustion from 2× halluc fan-out.
  - **(e) Cost cap:** A/B costs >$30 across 3 novels (overnight $26 cap is the bound; this lane requests an explicit increase to ~$30 for the 3-novel sweep).
- **Starting commit:** `2545eb0` (L67 close G-A2 + lever sequence pivot to G-D)
- **Experiment ID:** 396
- **Budget cap:** ~$30 across all A/B runs (3 novels × ~$8 baseline + ~$10 N=2 per-novel premium = ~$30 worst case).
- **Primary lane:** widen per-beat halluc-ungrounded LLM-confirmed entity surface via parallel multi-call vote/union.
- **Causal hypothesis:** the LLM checker's per-call entity-flagging behavior is stochastic on byte-identical prose. The current single-call check therefore samples from a probability distribution over present entities but only emits the entities sampled in *this* call. Issuing N parallel calls and unioning their LLM-confirmed entity sets approximates a more recall-complete view of the present-but-stochastic entity set, giving the writer's per-beat retry budget more coverage to act on. Predicted effect: more entities flagged per beat → writer paraphrases more references → fewer chapter-attempt persistence failures → higher approval rate.
- **Baseline:** exp #389 + #392 + #394 chapter-1 attempt-1 halluc-ungrounded fire profiles (single-call); exp #389 beat-13 trace showing 3 disjoint flagged-entity sets across 3 byte-identical-prose calls.
- **Changed runtime lever:**
  - `src/agents/halluc-ungrounded/index.ts`: extend `checkHallucUngrounded` opts with `voteN?: number` (default 1); when `voteN > 1`, replace the single `callAgent` with `Promise.all(Array.from({length: voteN}, () => callAgent(...)))`; union LLM `output.issues` across all N results (dedup by `entity` lowercase); pass = ALL N pass; the rest of the function (L40 filter, AND-gate, persistence) operates on the unioned set; persist all N llmCallId NER patches with `voteIndex: i, voteN: N` metadata.
  - `src/config/pipeline.ts`: add `hallucVoteN: 1` (default kept at 1 for safety; production deploy flips via `HALLUC_UNGROUNDED_VOTE_N=2` env on LXC).
  - `src/phases/beat-checks.ts`: thread `pipeline.hallucVoteN` into the `checkHallucUngrounded` call (existing call site at line 64).
  - Tests: `src/agents/halluc-ungrounded/index.test.ts` extension covering vote/union semantics.
- **Feedback signal:**
  - Unit: new tests for N=1 byte-equivalence, N=2 disjoint-union, N=2 dedup, N=2 pass-when-all-pass, severity preservation.
  - Empirical: SQL query against `llm_calls` after a smoke confirming each beat at N=2 produced 2 rows tagged with `voteIndex` 0 and 1.
  - A/B (LXC): 3-novel paired smoke comparing N=1 vs N=2 on the same seeds.
- **Escalation rule:** if N=2 doesn't move approval rate, try N=3 once before declaring G-D dead. If N=3 still doesn't move it, the bottleneck is upstream (writer not consuming the wider entity list well) — promote **G-C (planner sanctioned-new-entities schema)** to address it at the planner layer instead of widening the checker further.
- **Allowed parallel support work:** L60 acceptance dry-run on a separate fresh seed (independent of the A/B novels — no shared DB rows); docs sweep.
- **DeepSeek V4 Flash concurrency plan:** the multi-call fan-out IS the concurrency lever — N=2 parallel halluc-ungrounded calls per beat. The 3-novel A/B already exercises lane-level parallelism (3 LXC novel runs concurrent). Total max concurrent halluc-ungrounded LLM calls during peak: 3 novels × 1 beat-in-flight × 2-vote = 6 concurrent halluc calls. Within DeepSeek V4 Flash rate limits.
- **Deferred out-of-lane runtime changes:** G-C planner schema migration; L66 v2 narrower writer-side constraint.
- **Files/scripts expected to change:** `src/agents/halluc-ungrounded/index.ts`, `src/agents/halluc-ungrounded/index.test.ts`, `src/config/pipeline.ts`, `src/phases/beat-checks.ts`, `docs/current-state.md` (halluc-ungrounded paragraph), `docs/decisions.md` (§L68), `docs/todo.md` (close L68 line), `docs/sessions/lane-queue.md`.
- **Evidence artifact:** `tuning_experiments.id=396`; commit hashes to be set; A/B harness output script `scripts/replay/l68-vote-ab-compare.ts`.

## Stop Gates

- (a) Clean pass: unit suite green; A/B shows approval-rate improvement ≥10pt on ≥2/3 novels OR ≥2× distinct-entity surface widening with non-regressive approval.
- (b) New dominant blocker: any novel's chapter approval regresses (L66-style trade where lever target hits but gating outcome regresses).
- (c) Regression: existing N=1 byte-equivalence tests fail; previously-passing test suites fail.
- (d) Infra failure: tsc / test runner / DB unreachable; or LXC LLM concurrency exhaustion.
- (e) Cost cap: A/B exceeds $30 across the 3-novel sweep.

## Command Plan

- Sample shape / N: 3 novels × ch1-3 × N=1 baseline + N=2 vote — paired-replay style.
- Probe-family key: chapter-1-attempt-1 halluc-ungrounded LLM calls per beat.
- Expected cost: ~$30 across 3 novels, both arms.
- Command 1: `bunx tsc --noEmit`
- Command 2: `bun test src/agents/halluc-ungrounded/`
- Command 3: `bun test` (full suite)
- Command 4: `bash scripts/deploy-lxc.sh`
- Command 5: launch 3-novel A/B (separate SSH per novel, nohup) at N=2
- Command 6: launch matching N=1 baseline (3-novel)
- Command 7: A/B comparison script — `scripts/replay/l68-vote-ab-compare.ts`

## Results

**Pending — implementation in progress.**
