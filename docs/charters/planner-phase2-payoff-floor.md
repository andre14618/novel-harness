---
status: proposed
kind: experiment-charter
experiment-family: planner-phase2-payoff-floor
proposed-by: Codex
proposed-date: 2026-04-18
adversary-verdict: pending
supersedes: docs/charters/planner-phase2-contract.md
---

# Experiment Charter — `planner-phase2-payoff-floor`

Supersedes the RED `planner-phase2-contract-v1`. `main` already carries Planner Phase-2 V1a; this charter treats that as fact and asks the cheaper causal question from `pre-planner-phase2-v1a`.

## 1. Question

On `pre-planner-phase2-v1a`, does an aggressive prompt-only setup/payoff floor recover enough of the eventual `main` V1a lift that `requiredPayoffs` + `establishedFact.id` schema churn was unnecessary?

## 2. Hypothesis

Do not freeze any numeric magnitude in this charter until Claude has filled the measurement tables below on frozen verifier surfaces. The finalized hypothesis must be written as a delta against these measured rows, not as an intuition-first percentage claim.

For every paired run in this charter, name the novel `pp2-floor__<arm>__<seed>__<timestamp>` where `<arm> ∈ {baseline,prompt,extractor,mainv1a}` so the queries below run unchanged.

Run these in order before finalizing the charter text:

1. Baseline paired chapter rows for the exact pilot seeds.

```sql
WITH run_index AS (
  SELECT
    n.id AS novel_id,
    split_part(n.id, '__', 2) AS arm,
    split_part(n.id, '__', 3) AS seed
  FROM novels n
  WHERE n.id LIKE 'pp2-floor__%'
),
chapter_flags AS (
  SELECT
    r.arm,
    r.seed,
    c.chapter_number AS chapter,
    EXISTS (
      SELECT 1
      FROM validation_passes vp
      WHERE vp.novel_id = r.novel_id
        AND vp.chapter_number = c.chapter_number
        AND vp.pass_number = 1
        AND vp.status = 'has_issues'
    ) AS validation_fail,
    EXISTS (
      SELECT 1
      FROM llm_calls lc
      WHERE lc.novel_id = r.novel_id
        AND lc.chapter = c.chapter_number
        AND lc.agent = 'beat-writer'
        AND COALESCE(lc.attempt, 1) > 1
    ) AS drafting_retry
  FROM run_index r
  JOIN chapter_outlines c ON c.novel_id = r.novel_id
  WHERE r.arm IN ('baseline', 'prompt', 'extractor', 'mainv1a')
    AND r.seed IN (
      'fantasy-healer',
      'fantasy-archive',
      'fantasy-cartographer',
      'fantasy-cultivation-void',
      'fantasy-bridge',
      'fantasy-debt'
    )
)
SELECT
  arm,
  seed,
  chapter,
  (validation_fail OR drafting_retry)::int AS failing_chapter,
  validation_fail::int AS validation_fail,
  drafting_retry::int AS drafting_retry
FROM chapter_flags
ORDER BY seed, chapter, arm;
```

2. `planning-beats` token-headroom rows from `llm_calls` since `2026-04-15`.

```sql
SELECT
  COALESCE(split_part(lc.novel_id, '__', 3), 'unlabeled') AS seed,
  lc.novel_id,
  lc.chapter,
  lc.completion_tokens,
  lc.max_tokens,
  ROUND(100.0 * (1 - lc.completion_tokens::numeric / NULLIF(lc.max_tokens, 0)), 1) AS headroom_pct,
  lc.timestamp
FROM llm_calls lc
LEFT JOIN novels n ON n.id = lc.novel_id
WHERE lc.agent = 'planning-beats'
  AND lc.timestamp >= TIMESTAMPTZ '2026-04-15'
  AND (
    lc.novel_id LIKE 'pp2-floor__%'
    OR COALESCE(n.seed_json->>'genre', '') ILIKE '%fantasy%'
  )
ORDER BY headroom_pct ASC NULLS LAST, lc.timestamp DESC;
```

3. Dark-fantasy ceiling verification from exp `#191` before deciding whether it belongs in the primary eval set.

```bash
rg -n "exp #191|Verification \\(exp #191\\)|100% first-attempt pass" docs/decisions.md
```

Provisional mechanism claim, to be numerically finalized only after those tables exist: if the observed V1a lift mostly came from making setup/payoff obligations explicit in planner output, the aggressive prompt-only floor should remove most of the paired failing-chapter gap relative to the frozen original prompt, while the measurement-only inference extractor will reveal how much of the remaining lift is verifier sensitivity rather than writer behavior.

## 3. Falsification threshold

The mechanism is wrong if both cheap levers fail to reduce the paired-set failing-chapter count versus the frozen original prompt, or if the only apparent gain shows up when verifier surfaces move instead of when planner output changes. In that case, abandon the claim that Phase-2 payoff schema is the causal lever and do not extend this family to V1b/V1c.

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | `pre-planner-phase2-v1a` + frozen original `planning-beats` prompt | Clean causal baseline before V1a landed |
| Floor + aggressive prompt | `pre-planner-phase2-v1a` + aggressive prompt-only setup/payoff floor | Cheapest causal lever; must be measured before schema claims |
| Floor + inference extractor | `pre-planner-phase2-v1a` + measurement-only inference extractor for payoff detection | Cheapest post-processing counterfactual; isolates verifier sensitivity |
| `main` V1a observational row | `main` with V1a (`requiredPayoffs` + `establishedFact.id`) and frozen checkers | Already-live observational reference, not the causal arm |

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Disposition |
|-------|----------------|-------------|
| Aggressive prompt-only block on `pre-planner-phase2-v1a`: `When a later beat depends on an earlier setup, state the setup explicitly in the seeding beat description and state the payoff explicitly in the later beat description. End the seeding beat with "[plants payoff for beat N: FACT]". End the payoff beat with "[pays off FACT from beat M]". Never create an unmatched marker.` | Prompt edit only + paired run cost | MUST-MEASURE. This is the primary cheap floor from the work order and must be in the three-arm baseline table before any schema claim is re-reviewed. |
| Measurement-only inference-time extraction: ask the frozen verifier layer to infer `did this beat realize an earlier setup?` from prose and beat descriptions without any Phase-2 schema use | Post-processing only + paired run cost | MUST-MEASURE. This is not rejected; it is the required non-schema counterfactual that tests whether the remaining gain is extractor/verifier sensitivity rather than planner JSON shape. |

## 6. Distribution match

- **Train set stratification:** Not applicable. This is a prompt/schema ablation charter, not a fine-tune.
- **Eval set stratification:** Primary seed set is exactly `{fantasy-healer, fantasy-archive, fantasy-cartographer, fantasy-cultivation-void, fantasy-bridge, fantasy-debt}`. The formal causal eval set is `E = { (seed, chapter) | seed ∈ S, chapter ∈ {1,2,3,4,5} }`, where `S` is that six-seed set. Measure the three `pre-planner-phase2-v1a` arms on all 30 seed/chapter slots, then attach the matched `main` V1a observational row on the same 30 slots.
- **Production distribution (real beats in `llm_calls`):** Compare those six seeds against fantasy `planning-beats` rows since `2026-04-15` on beat count, completion tokens, headroom, first-pass chapter failures, and drafting retries before accepting the pilot as representative.

Mismatch note: `dark-fantasy` is intentionally excluded from the primary eval set because `docs/decisions.md` exp `#191` records a 3-chapter verification run at 100% first-attempt pass on adherence-events, chapter-plan, and continuity. It remains a ceiling-verification datapoint, not a primary seed, unless a fresh query proves it is no longer ceilinged.

## 7. Success criteria

Primary metric for this charter is **failing chapters across the 30 paired seed/chapter slots**, where a chapter counts as failing if pass 1 logs `validation_passes.status = 'has_issues'` or if drafting required a second `beat-writer` attempt within that chapter under frozen verifier surfaces. Always report `gap_closure = (floor - baseline) / (V1a - baseline)` on that same failing-chapter metric. Do not use p-values.

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP cheap floor | The aggressive prompt-only floor reduces failing chapters versus baseline, and `main` V1a beats the prompt-only floor by `<=1` failing chapter across the paired set | Treat schema churn as not yet justified by this charter; keep V1a live on `main`, but do not use this charter as evidence for extending the schema family |
| ITERATE | The aggressive prompt-only floor and `main` V1a differ by exactly `2` failing chapters across the paired set, or the inference extractor materially changes the ranking between arms, or the token-shape gate data is still ambiguous | Re-charter with the completed tables and a narrower claim about where the remaining gap lives |
| JUSTIFY schema | `main` V1a beats the aggressive prompt-only floor by `>=2` failing chapters across the paired set, and every `planning-beats` call for the measured rows stays under `7,500` completion tokens | Treat the V1a schema as causally justified enough to remain the active floor for any future V1b/V1c discussion |
| KILL causal claim | Neither cheap lever reduces failing chapters versus baseline, or the apparent lift disappears when verifier surfaces are frozen, or any candidate arm that requires schema growth cannot stay under `7,500` completion tokens | Abandon the claim that payoff-schema enrichment is the right lever and redirect to a cheaper family |

## 8. Budget

- **Spend cap:** `median_cost_recent_3ch_fantasy_run_from_llm_calls × 12 causal runs + eval/judge spend`. Fill `median_cost_recent_3ch_fantasy_run_from_llm_calls` with this query, not intuition:

```sql
WITH recent_fantasy_runs AS (
  SELECT
    l.novel_id,
    SUM(l.cost)::numeric(12,6) AS total_cost,
    COUNT(DISTINCT CASE WHEN d.status = 'approved' THEN d.chapter_number END) AS approved_chapters
  FROM llm_calls l
  JOIN novels n ON n.id = l.novel_id
  LEFT JOIN chapter_drafts d ON d.novel_id = l.novel_id
  WHERE l.timestamp >= TIMESTAMPTZ '2026-04-15'
    AND l.novel_id IS NOT NULL
    AND COALESCE(n.seed_json->>'genre', '') ILIKE '%fantasy%'
  GROUP BY l.novel_id
)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cost) AS median_3ch_cost
FROM recent_fantasy_runs
WHERE approved_chapters = 3;
```

- **Time cap:** Derive from measured workload, not intuition: `median_wall_clock_recent_3ch_fantasy_run × 12 causal runs + eval/judge wall time`.
- **Pre-run token-shape gate:** Before pilot launch, run:

```bash
bun scripts/test-planner-isolated.ts fantasy-healer,fantasy-archive,fantasy-cartographer,fantasy-cultivation-void,fantasy-bridge,fantasy-debt
```

Then compute, for each candidate seed/chapter:

`expected_delta_tokens_per_chapter = (beat_count × added_prompt_marker_fields_per_beat × median_tokens_per_prompt_marker_field) + (beat_count × avg_required_payoff_links_per_beat × median_tokens_per_requiredPayoff_entry) + (established_fact_count × median_tokens_per_establishedFact_id)`

Gate the pilot **before launch** on:

`baseline_planning_beats_completion_tokens + expected_delta_tokens_per_chapter < 7,500`

for every measured seed/chapter row. If any row fails the gate, revise the arm before spending on the paired pilot.

## 9. Linked context

- Prior experiments / decisions:
  - `docs/decisions.md` — 2026-04-17 two-phase planner split
  - `docs/decisions.md` — 2026-04-15 exp `#191` dark-fantasy verification run
  - `docs/current-state.md` §Planning and generation — V1a is already live on `main`
  - `docs/charters/planner-phase2-contract.md` — RED original being superseded
- Related rules:
  - `docs/experiment-design-rules.md` §§2.1, 2.2, 3.1, 3.3, 4.4, 7.1, 9.1, 9.3, 11.1, 11.5
- Code to commit before run:
  - `src/agents/planning-beats/beat-expansion-system.md` for the aggressive prompt-only floor
  - measurement-only extractor surface used to score the inference-time counterfactual
  - verifier surfaces must remain frozen during the measurement window
- `tuning_experiment` ID: pending allocation after the §11 readiness gate is satisfied

## 10. Adversary review

Primary reviewer remains Codex via `/charter-review` → `/codex:adversarial-review`. Leave all slots pending until the readiness gate below is satisfied.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | pending | pending | Hold until the §11 readiness gate is satisfied |
| `experiment-adversary` (Opus) — fallback only | pending | pending | Only run if Codex is unavailable or a second opinion is explicitly requested after Codex review |

## 11. Open questions / readiness gate

- Tag/reference: `pre-planner-phase2-v1a` currently points at commit `8f42eb6` and is the causal baseline for this charter.
- V1a is not being reverted; cheap-lever measurement runs from that ref for a clean A/B against the already-live `main` observational row.
- Do not re-review until the charter contains the completed three-arm baseline table from `pre-planner-phase2-v1a` with frozen verifier surfaces.
- Frozen means no prompt edits, model swaps, or retrains for the verifier stack during the pilot window; only the planner-floor arm and the measurement-only extractor may move.
