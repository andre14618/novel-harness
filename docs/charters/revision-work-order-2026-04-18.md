---
status: active
kind: work-order
produced-by: Codex (gpt-5.4, high-effort, session 019da28b-81fb-7ae2-865e-e7987c3cb9a4)
produced-for: Claude (implementation)
date: 2026-04-18
---

# Charter-Revision Work Order — 2026-04-18

Produced by Codex after returning RED on all three 2026-04-18 charters (`planner-phase2-contract-v1`, `cross-chapter-state-propagation-v1`, `salvatore-v5-corpus-expansion`). User directive: Codex directs, Claude implements.

## 1. Triage

- `planner-phase2-contract.md`: **SUPERSEDE with a new charter addressing the cheaper counterfactual first.** V1a is already live on `main`, so the clean causal question is no longer "does schema help?" but "did the stronger prompt-only floor already buy most of the gain on `pre-planner-phase2-v1a`?" Re-review only after the cheap floor, frozen-verifier ablation, and tagged-baseline rows exist.
- `cross-chapter-state-propagation.md`: **SUPERSEDE with a new charter addressing the cheaper counterfactual first.** Serial Phase-2 is the expensive rung; the charter's own `endsWith` hint is the clean first ablation and keeps parallelism. Rewrite it so `endsWith` is the primary test and serial is only the escalation arm.
- `salvatore-v5-corpus-expansion.md`: **SUPERSEDE with a new charter addressing the cheaper counterfactual first.** The current corpus-expansion charter depends on an eval that does not exist and skips the measured conditioning floor. Rewrite it as a conditioning-first distinctness charter; reopen corpus expansion only if that floor fails and source books are on disk.

## 2. Execution sequence

1. Rewrite the planner charter first. It defines the frozen Phase-2 surface that the cross-chapter charter must treat as fixed.
2. Rewrite the cross-chapter charter second, on the assumption that planner V1a is already live and not part of its causal claim.
   DAG: `planner floor-first charter -> cross-chapter endsWith-first charter`
3. Create and freeze `salvatore-distinctness-v1` as a separate eval artifact before touching the Salvatore charter text.
4. Rewrite the Salvatore charter as `exampleLines`/profile-rotation-first against that frozen eval.
   DAG: `distinctness eval -> salvatore conditioning-first charter`

## 3. Per-charter revision spec

### Planner Phase-2
- **Resulting title / family name:** Rename to `planner-phase2-payoff-floor` in the same family.
- **Revised question:** On `pre-planner-phase2-v1a`, does an aggressive prompt-only setup/payoff floor recover enough of the eventual V1a lift that schema churn was unnecessary?
- **Revised hypothesis:** Do not keep the current percentages. First generate two tables: `A)` paired baseline rows on `pre-planner-phase2-v1a` for candidate fantasy seeds, `B)` `planning-beats` token-headroom rows from `llm_calls` since `2026-04-15`. Then state the hypothesis as a delta against those measured rows.
- **Revised baseline ladder:** `1)` `pre-planner-phase2-v1a` + frozen original prompt, `2)` same ref + aggressive prompt-only floor, `3)` same ref + measurement-only inference extractor for payoff detection, `4)` `main` V1a observational row with frozen checkers.
- **Revised success criteria:** Cheap floor suffices if it closes at least `80%` of the V1a gap on the primary metric or if V1a beats it by `<=1` failing chapter across the paired set; schema is justified only if V1a beats the floor by `>=2` failing chapters and every `planning-beats` call stays under `7,500` completion tokens.
- **Revised pilot size + statistical handling:** `6 seeds x 5 chapters = 30 paired chapters` minimum; drop `dark-fantasy` if it is still ceilinged at 100% first-attempt pass. Report exact paired chapter deltas and per-seed tables; no p-values.
- **Revised budget:** Set budget from measured workload, not intuition: median cost of one recent 3-chapter fantasy run from `llm_calls` multiplied by `12` causal runs; token-shape gate from `scripts/test-planner-isolated.ts` before launch.
- **Rules addressed:** `§2.1`, `§2.2`, `§3.1`, `§3.3`, `§4.4`, `§7.1`, `§9.1`, `§9.3`, `§11.1`, `§11.5`.

### Cross-chapter state
- **Resulting title / family name:** Rename to `cross-chapter-endswith-floor`.
- **Revised question:** Does a one-line chapter-end state hint on each skeleton recover most of the cross-chapter coherence gain while keeping Phase-2 parallel?
- **Revised hypothesis:** Replace continuity-v2 percentages with planner-side conflict counts. If current counts are unknown, first run `diffPlanAgainstState()` on current parallel outputs for the chosen seeds and pull planner latency from `llm_calls`; write the hypothesis as a delta from those measured conflict rows.
- **Revised baseline ladder:** `1)` current parallel baseline with `priorChapters: []`, `2)` parallel + `endsWith` only, `3)` serial Phase-2 using the current renderer exactly as shipped, `4)` bounded-serial is explicitly out of scope unless arm 3 wins clearly.
- **Revised success criteria:** Ship `endsWith` if it removes `>=4` conflict chapters across `40` planned chapters and serial removes at most `1` additional conflict chapter while planner wall time stays `<=1.25x` baseline. Escalate to serial only if it beats `endsWith` by `>=2` conflict chapters.
- **Revised pilot size + statistical handling:** `4 callback-heavy fantasy seeds x 10 chapters`; seed set must be disjoint from the planner charter and selected by a written callback-density screen, not by "runs cleanly on Salvatore." Report exact conflict counts and per-seed deltas; no pooled significance language.
- **Revised budget:** Planner-only runs: `4 seeds x 3 arms = 12` planning runs, budgeted from recent `planning-plotter`/`planning-beats` `llm_calls` latency and cost.
- **Rules addressed:** `§3.1`, `§4.6`, `§6.4`, `§9.1`, `§11.1`, `§11.5`.

### Salvatore
- **Resulting title / family name:** Rename to `salvatore-distinctness-conditioning-floor`.
- **Revised question:** On a frozen distinctness eval, does rotating v4 `exampleLines`/profile conditioning improve multi-character separation enough that corpus expansion can wait?
- **Revised hypothesis:** Name the judge now and use count units, not faux-precise points. Before finalizing numbers, query `eval_cell_summary` for v3/v4 retention on `salvatore-original-v1` and held-out val, then set thresholds in exact assignment counts on the new distinctness eval.
- **Revised baseline ladder:** `1)` `salvatore-1988-v3`, `2)` `salvatore-1988-v4`, `3)` v4 + rotated `exampleLines`/profile subsets at inference, `4)` Sonnet+profile ceiling from exp `#220`.
- **Revised success criteria:** Conditioning suffices if rotation adds `>=4/24` correct assignments over v4, no anchor pair falls below `3/4`, and `salvatore-original-v1` retention worsens by no more than `+0.10 Δ-sum` versus v4. Only reopen corpus expansion if rotation gains `<=2/24`.
- **Revised pilot size + statistical handling:** Freeze `salvatore-distinctness-v1` first: `24` assignment cells, scored as exact counts, plus `3` fixed rotation presets per character to eliminate one-subset luck. Judge must be a named reasoning model not used as training-label source.
- **Revised budget:** No training budget in this charter. Budget only eval-generation + pairwise judging, anchored to exp `#220` pairwise workload; this should be a fraction of that spend and under one working day.
- **Rules addressed:** `§2.1`, `§2.3`, `§3.6`, `§7.3`, `§9.3`, `§11.1`, `§11.4`, `§11.8`.

## 4. Cheaper-counterfactual specs

### Aggressive prompt-only Floor for Phase-2
- **Files to touch:** `src/agents/planning-beats/beat-expansion-system.md`
- **Exact prompt text changes:** Add a CRITICAL block: `When a later beat depends on an earlier setup, state the setup explicitly in the seeding beat description and state the payoff explicitly in the later beat description. End the seeding beat with "[plants payoff for beat N: FACT]". End the payoff beat with "[pays off FACT from beat M]". Never create an unmatched marker.`
- **Measurement protocol:** Compare `pre-planner-phase2-v1a` baseline vs prompt-only floor vs `main` V1a observational row on the same seeds with frozen checkers.
- **Expected time + spend:** Prompt edit only; cost is the paired run budget from §3.
- **Single sufficiency number:** `gap_closure = (floor - baseline) / (V1a - baseline)`

### `endsWith` skeleton hint
- **Files to touch:** `src/agents/planning-plotter/chapter-outline-system.md`, `src/agents/planning-plotter/schema.ts`, `src/agents/planning-beats/context.ts`
- **Measurement protocol:** Compare current parallel baseline vs parallel+`endsWith` vs serial on the same callback-heavy seeds; score with `diffPlanAgainstState()` conflict counts and planner wall time.
- **Expected time + spend:** One planner-only A/B/C sweep; no drafting required.
- **Single sufficiency number:** `serial_gap_closure = (endsWith conflict reduction) / (serial conflict reduction)`

### `exampleLines` rotation
- **Files to touch:** `src/agents/writer/beat-context.ts`
- **Measurement protocol:** On frozen `salvatore-distinctness-v1`, compare v4 fixed `exampleLines` vs v4 rotated subsets; keep the base adapter constant.
- **Expected time + spend:** No training; just generation + pairwise judging.
- **Single sufficiency number:** `extra_correct_assignments_over_v4`

## 5. What NOT to change

- Keep planner V1b/V1c explicitly out of scope until V1a-or-cheaper is resolved.
- Keep cross-chapter scope on planner-side carry-forward state, not reader-information or checker expansion.
- Keep `pre-planner-phase2-v1a` as the counterfactual baseline and keep the user's tag-not-revert preference.
- Keep Salvatore retention tied to `salvatore-original-v1` plus held-out val, and keep late-style `Pinquickle's Folly` out of training.

## 6. Adversary re-review readiness gate

- **Planner charter:** Do not re-review until the charter contains the completed three-arm baseline table from `pre-planner-phase2-v1a` with frozen verifier surfaces.
- **Cross-chapter charter:** Do not re-review until `diffPlanAgainstState()` conflict count is the named primary metric and the `baseline / endsWith / serial` decision matrix is explicit.
- **Salvatore charter:** Do not re-review until `salvatore-distinctness-v1` exists as a frozen eval artifact with a named judge and the charter is scoped to conditioning-first rather than corpus expansion.
