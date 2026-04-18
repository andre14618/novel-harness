---
status: proposed
kind: experiment-charter
experiment-family: cross-chapter-endswith-floor
proposed-by: Codex
proposed-date: 2026-04-18
adversary-verdict: pending
supersedes: docs/charters/cross-chapter-state-propagation.md
---

# Experiment Charter — `cross-chapter-endswith-floor`

Supersedes the RED `cross-chapter-state-propagation-v1`. `planner-phase2-payoff-floor` is the prerequisite frozen surface for this charter: Planner Phase-2 V1a is already live on `main`, `pre-planner-phase2-v1a` remains the planner charter's causal baseline, verifier surfaces stay frozen during measurement windows, and this charter treats cross-chapter planner state as the current gap rather than reopening the Phase-2 payoff contract.

## 1. Question

Does a one-line chapter-end state hint on each skeleton recover most of the cross-chapter coherence gain while keeping Phase-2 parallel?

## 2. Hypothesis

Do not freeze a numeric magnitude in this charter until Claude has filled the measured tables below. The finalized hypothesis must be written as a delta against measured `diffPlanAgainstState()` conflict rows and measured planning latency rows, not as an intuition-first percentage claim.

For every paired run in this charter, name the novel `cc-endswith__<arm>__<seed>__<timestamp>` where `<arm> ∈ {baseline,endswith,serial}` so the measurement tables stay queryable.

Before finalizing the charter text, fill these in order:

1. **Conflict table on the exact pilot seeds.** For every `(arm, seed, chapter)` row, load the saved `chapter_outlines` in chapter order, build prior character state from chapters `< chapter`, and score chapter `N` with `diffPlanAgainstState(outline_N, priorStates_N)` from `src/state-diff.ts`. Record:
   - `conflict_count = conflicts.length`
   - `conflict_chapter = (conflict_count > 0)::int`
   - per-conflict `type`, `characterName`, `topic`, `priorChapter`
   The primary row for this charter is the sum of `conflict_chapter` across chapters 1-10 for each run.
2. **Planning latency / cost rows from `llm_calls`.** Use the §8 query below and fill the median current parallel-planning cost and wall-time baseline before freezing any ship language.

Provisional mechanism claim, narrowed to the actual shipped surfaces: if the missing ingredient is a terse carry-forward state reminder at the skeleton tier, then parallel + `endsWith` should remove most planner conflict chapters relative to the current parallel baseline. If a remaining gap still matters, the serial arm should show what the current `priorChapters` renderer actually buys beyond the one-line hint. That renderer, as shipped today, surfaces only the text derived from `characterStateChanges` and `establishedFacts` in `renderPriorState()`; it does **not** render a separate `knowledgeChanges` block. Any conclusion from arm 3 applies only to that delivered state surface.

## 3. Falsification threshold

This family is falsified if both prongs fail on the same 40-chapter pilot:

1. `endsWith` fails the minimum causal bar: it does **not** remove `>=4` conflict chapters versus the current parallel baseline.
2. Serial Phase-2 fails to show a decisive residual gap: it does **not** beat `endsWith` by `>=2` conflict chapters on the same 40 chapters.

If both prongs fail, do not widen the serial family and do not introduce bounded-serial from this charter. The next escalation, if the problem still looks worth pursuing, is a Phase-1.5 structured state-brief charter on the same planner-side carry-forward surface.

If serial is the only arm that materially reduces conflict chapters but misses the measured wall-time gate in §7, serial is not shippable from this charter. Treat that as evidence for the Phase-1.5 pivot, not for bounded-serial.

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Baseline | Current parallel Phase-2 with `priorChapters: []` in `src/phases/planning.ts` | Current production floor for cross-chapter planner state |
| `endsWith` | Parallel Phase-2 + one-line `endsWith` hint emitted on each Phase-1 skeleton and rendered into Phase-2 context | Cheapest causal lever; keeps Phase-2 parallel |
| Serial | Serial Phase-2 using the current `priorChapters` renderer exactly as shipped today | Expensive escalation arm; measures what the shipped renderer buys beyond `endsWith` |

Bounded-serial is explicitly out of scope unless arm 3 wins clearly under §7.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Disposition |
|-------|----------------|-------------|
| One-line `endsWith` hint on each skeleton (`src/agents/planning-plotter/schema.ts`, `src/agents/planning-plotter/chapter-outline-system.md`, `src/agents/planning-beats/context.ts`) | Low; planner-only A/B arm measured under §8 | MUST-MEASURE. This is the primary test arm for this charter, not a rejected alternative. |
| Phase-1.5 structured state-brief emitted between plotter and planning-beats | Low-moderate; planner-only plus additional schema/prompt churn | Not the primary arm. This is the escalation pivot only if both §3 prongs fail or serial is the only quality-moving arm but misses the wall-time gate. |

This charter does **not** scope reader-information state. Any Phase-1.5 follow-up stays on planner-side carry-forward facts and character-state only.

## 6. Distribution match

- **Train set stratification:** Not applicable. This is a planner prompt/schema/context ablation charter, not a fine-tune.
- **Eval set stratification:** Primary seed set is exactly `{fantasy-siege, fantasy-succession, fantasy-artifice, fantasy-tower-cartographer}`. The formal causal eval set is `E = { (seed, chapter) | seed ∈ S, chapter ∈ {1,2,3,4,5,6,7,8,9,10} }`, where `S` is that four-seed set. Measure all three arms on all 40 seed/chapter slots.
- **Callback-density screen:** A seed qualified only if it satisfied all four screens below:
  1. It is a 10-chapter fantasy seed and is disjoint from the `planner-phase2-payoff-floor` set `{fantasy-healer, fantasy-archive, fantasy-cartographer, fantasy-cultivation-void, fantasy-bridge, fantasy-debt}`.
  2. Its premise contains a concrete cross-chapter object, system, or decoded signal whose identity has to persist across chapters rather than resetting chapter-by-chapter.
  3. Its premise contains a withheld truth, conspiracy, or reinterpretation that should flip later chapter planning once discovered.
  4. Its premise implies at least one secondary actor whose knowledge, allegiance, or pressure on the protagonist can change mid-book and must be carried forward by later chapter plans.
- **Why these four pass the screen:**
  - `fantasy-siege` — ward-stones, builder records, and the imprisoned thing create persistent discovered-state and allegiance pressure.
  - `fantasy-succession` — sword fragments, the scabbard reveal, and multi-claimant bargaining require later chapters to honor earlier discoveries and commitments.
  - `fantasy-artifice` — the hidden lattice flaw, rebuild specification, and shrinking deadline create explicit carry-forward technical and political state.
  - `fantasy-tower-cartographer` — route annotations, tower-language decoding, and suppressed prior reports create a sustained callback chain rather than isolated chapter beats.
- **First alternate kept out of the pilot:** `fantasy-class-copy` also screened in on callback density, but it is excluded here because its hidden-class bookkeeping risks conflating planner-side carry-forward with reader-information / concealed-capability state, which this charter explicitly excludes.
- **Production distribution (real planning rows in `llm_calls`):** Compare the pilot's token shape and planning wall time against recent 10-chapter fantasy planning runs from `planning-plotter` + `planning-beats` since `2026-04-15` using the §8 query. This pilot is intentionally a stress slice for callback-heavy fantasy, not an "average fantasy" claim.

## 7. Success criteria

Primary metric for this charter is **conflict chapters across the 40 planned chapter slots**, where a chapter counts as a conflict chapter if `diffPlanAgainstState(outline, priorStates).conflicts.length > 0`. Always report the raw per-seed conflict tables and the sufficiency number:

`serial_gap_closure = (baseline_conflict_chapters - endsWith_conflict_chapters) / (baseline_conflict_chapters - serial_conflict_chapters)`

If the denominator is `0`, report `serial_gap_closure` as undefined and do not treat serial as evidence for escalation.

Secondary metric is **planner wall time**, measured from `llm_calls` as the planning-phase completion span for `planning-plotter` + `planning-beats` on the same novel.

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP `endsWith` | `endsWith` removes `>=4` conflict chapters across the 40 planned chapters, serial removes at most `1` additional conflict chapter, and `endsWith` planner wall time stays `<=1.25x` the measured baseline | Ship `endsWith`; keep Phase-2 parallel |
| ESCALATE to serial | Serial beats `endsWith` by `>=2` conflict chapters on the same 40 planned chapters | Re-charter / implement serial Phase-2 as the next rung; bounded-serial remains out of scope until after that result |
| ITERATE | Result falls between the two decision thresholds above, or serial is the only quality-moving arm but misses the measured wall-time gate | Re-run only with a rewritten charter that explains the unresolved gap |
| KILL this surface | Both §3 prongs fail | Do not ship `endsWith` or serial from this charter; if the family remains worth pursuing, pivot to a separate Phase-1.5 state-brief charter |

## 8. Budget

- **Run budget:** `4 seeds × 3 arms = 12` planning runs. This is a planner-only sweep; no drafting or checker-surface changes belong in this charter.
- **Spend cap:** `median_recent_10ch_fantasy_planning_cost × 12`. Fill `median_recent_10ch_fantasy_planning_cost` from the query below, not intuition.
- **Time cap:** `median_recent_10ch_fantasy_planning_wall_seconds × 12`. Fill `median_recent_10ch_fantasy_planning_wall_seconds` from the same query, not intuition.
- **Wall-time gate denominator:** Use the same measured `median_recent_10ch_fantasy_planning_wall_seconds` as the denominator for the §7 `<=1.25x` gate. That gate is relative to observed current parallel planning wall time from `llm_calls`, not to a guessed absolute number.

```sql
WITH recent_planning_runs AS (
  SELECT
    lc.novel_id,
    ROUND(COALESCE(SUM(lc.cost), 0)::numeric, 6) AS planning_cost,
    EXTRACT(
      EPOCH FROM (
        MAX(lc.timestamp) -
        MIN(lc.timestamp - (lc.latency_ms * INTERVAL '1 millisecond'))
      )
    ) AS planning_wall_seconds,
    COUNT(DISTINCT lc.chapter) FILTER (
      WHERE lc.agent = 'planning-beats'
        AND lc.chapter IS NOT NULL
    ) AS planned_chapters
  FROM llm_calls lc
  JOIN novels n ON n.id = lc.novel_id
  WHERE lc.timestamp >= TIMESTAMPTZ '2026-04-15'
    AND lc.agent IN ('planning-plotter', 'planning-beats')
    AND COALESCE(n.seed_json->>'genre', '') ILIKE '%fantasy%'
  GROUP BY lc.novel_id
)
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY planning_cost) AS median_recent_10ch_fantasy_planning_cost,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY planning_wall_seconds) AS median_recent_10ch_fantasy_planning_wall_seconds
FROM recent_planning_runs
WHERE planned_chapters = 10;
```

- **Stop if:** the `planner-phase2-payoff-floor` pilot has not already run to completion; any candidate run changes verifier surfaces during the measurement window; or the run naming convention `cc-endswith__<arm>__<seed>__<timestamp>` is not followed well enough to support paired measurement.

## 9. Linked context

- Work-order source:
  - `docs/charters/revision-work-order-2026-04-18.md` §3 "Cross-chapter state" and §6
- Frozen prerequisite charter:
  - `docs/charters/planner-phase2-payoff-floor.md`
- Canonical live-state reference:
  - `docs/current-state.md`
- Code references for the current gap and measurement:
  - `src/phases/planning.ts` — current baseline passes `priorChapters: []`
  - `src/agents/planning-beats/context.ts` — `renderPriorState()` is the serial arm's shipped renderer
  - `src/agents/planning-plotter/schema.ts` — `endsWith` lands here at the skeleton surface
  - `src/agents/planning-plotter/chapter-outline-system.md` — Phase-1 prompt learns to emit `endsWith`
  - `src/state-diff.ts` — `diffPlanAgainstState()` is the named primary metric
- Related rules:
  - `docs/experiment-design-rules.md` §§3.1, 4.6, 6.4, 9.1, 11.1, 11.5
- Code to commit before run:
  - `src/agents/planning-plotter/schema.ts` for optional `endsWith`
  - `src/agents/planning-plotter/chapter-outline-system.md` so Phase-1 emits `endsWith`
  - `src/agents/planning-beats/context.ts` so Phase-2 sees `endsWith`
  - `src/phases/planning.ts` for the serial-arm experiment path using the shipped renderer
- `tuning_experiment` / run ID allocation: pending until the §11 readiness gate is satisfied

## 10. Adversary review

Primary reviewer remains Codex via `/charter-review` → `/codex:adversarial-review`. Leave all slots pending until the readiness gate below is satisfied.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | pending | pending | Hold until the §11 readiness gate is satisfied |
| `experiment-adversary` (Opus) — fallback only | pending | pending | Only run if Codex is unavailable or a second opinion is explicitly requested after Codex review |

## 11. Open questions / readiness gate

- Do not re-review until `diffPlanAgainstState()` conflict count is the named primary metric and the `baseline / endsWith / serial` decision matrix is explicit.
- This charter's pilot schedule is SEQUENCED after `planner-phase2-payoff-floor`'s pilot — not parallel — to avoid the §11.5 confound on shared infrastructure. If the planner charter isn't piloted first, this charter should not pilot.
- This charter stays scoped to planner-side carry-forward state. Reader-information / concealed-knowledge bookkeeping is a separate future charter.
- Any serial result from this charter is interpretable only as a test of the shipped `priorChapters` renderer surface: text derived from `characterStateChanges` and `establishedFacts`, with no separate `knowledgeChanges` block rendered into context.
- Bounded-serial remains out of scope unless serial wins clearly under §7.
