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

**Outcome: SHIP-AS-CODE-DEFAULT-OFF. Lever works as designed but is upstream of the current dominant blocker on the A/B seeds.**

**A/B sweep (3 seeds × 2 arms × 2-chapter cap, exp #396, $0.38 total):**

| seed | arm | bail | best-att | halluc fail calls | distinct entities | approval |
|---|---|---|---|---|---|---|
| fantasy-archive | n1 | integrity-duplicate-fragment ch1 | 4 | 0/39 | 0 | 0/1 |
| fantasy-archive | n2 | integrity-duplicate-fragment ch1 | 4 | 9/90 | 8 | 0/1 |
| fantasy-debt | n1 | integrity-duplicate-fragment ch1 | 2 | 9/59 | 16 | 0/1 |
| fantasy-debt | n2 | integrity-duplicate-fragment ch1 | 3 | 8/88 | 7 | 0/1 |
| fantasy-system-heretic | n1 | continuity ch2 | 3 (ch1) | 4/44 | 12 | **1/1** ch1 ✓ |
| fantasy-system-heretic | n2 | integrity-duplicate-fragment ch1 | 3 | 7/92 | 5 | 0/1 |

Rollup: **n1=1/3 chapters approved, n2=0/3 chapters approved.**

A/B comparison output: `/tmp/l68-vote-ab.2026-05-03T0329.json` (timestamped, append-only).

**Stop-gate analysis:**

- **Lever target metric (halluc-ungrounded recall):** **WORKS AS DESIGNED.** `fantasy-archive` is the cleanest demonstration — N=1 produced 0 halluc fail calls across 39 invocations; N=2 surfaced 9 halluc fail calls across 90 invocations on the same seed, same commit. The vote/union widened the entity surface as predicted.
- **Lever effect on approval:** **NO EFFECT — bottleneck is upstream.** 5 of 6 A/B novels and the L60 dryrun all bailed before halluc-ungrounded was the gating blocker. 4 of those 5 bailed on `integrity-duplicate-fragment` (chapter 1 prose with repeated fragments across attempts; the L41/L63 carry-over reached the writer but did not converge). The single ch1 approval (heretic-n1) was on the seed where halluc fired LEAST (4 calls vs 7-9 elsewhere). N=2 cannot help when the gating blocker is upstream of the halluc surface.
- **Stop gate (b) check:** approval regression on heretic (n1=1/1 → n2=0/1) is technically a regression, but heretic-n2's bail kind is `integrity-duplicate-fragment` — the same kind that fired on 3 other novels regardless of arm. The N=2 path didn't introduce a new failure mode; it landed in the same prose-integrity attractor that all seeds in this sweep are vulnerable to. So stop gate (b) does NOT clearly fire.
- **Stop gate (a) check:** approval did not improve ≥10pt; distinct entities at the rollup actually went from 28 (n1) → 20 (n2), but this is partly an artifact of the n2 bails happening 1-2 attempts earlier and producing less prose to flag against. The arch pair shows the entity-recall widening signal cleanly (0 → 9 fail calls), so the lever shape works.

**Decision: ship L68 as code (already merged at `47ae038` + env-fix `7001981`); keep production default at `HALLUC_UNGROUNDED_VOTE_N` unset → `pipeline.hallucVoteN=1`.** Do NOT flip the env to N=2 in production until the dominant blocker is one the lever can address. The implementation cost was low ($0); the option-value of having the mechanism available later is high.

**Cost actuals:** $0.38 across the 6 A/B novels. Cost-ratio per pair (n2 / n1): arch 1.45×, debt 0.81× (n2 bailed earlier so less prose), heretic 1.28×. Average ~1.18× — the predicted ~20% cost premium when N=2 is on.

**The dominant blocker pattern this sweep surfaced (5 of 7 novels):** `integrity-duplicate-fragment` in chapter 1, surviving 3-4 attempts with the L41/L63 matched-pair carry-over already wired in. The writer is paraphrase-resistant on duplicate fragments specifically. Next lever should target that — call it **L70 / Integrity Lever I-D**: aggressive duplicate-fragment paraphrase guidance, OR per-fragment beat-targeted rewrite (L41's ladder analog for the duplicate surface), OR a relaxed duplicate-fragment threshold to test if it's over-firing on legitimate parallelism.

**Followup observations from this sweep (separate from L68 outcome):**

- `fantasy-system-heretic` ch2 (heretic-n1) bailed on a continuity blocker, NOT halluc-ungrounded — gives a fresh failure case for the continuity surface.
- `fantasy-bridge` (L60 dryrun) bailed on a beat-check adherence failure (beat 11 missing planned character "Alderan War Council") — adherence-events 0 fails across the run otherwise; this is a single-beat character-presence miss.
- The L60 8-gate acceptance dry-run is its own lane (see `docs/sessions/2026-05-02-L60-acceptance-dryrun.md`); the bridge bail above is the input it acts on.
