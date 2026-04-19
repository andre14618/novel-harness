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

### 2.a Query results (filled 2026-04-18)

**Query 1 — pp2-floor baseline paired chapter rows:** zero rows returned. No `pp2-floor__%` novels exist in `novels` yet — the causal pilot has not been run. This is the gate: running the `baseline / prompt / extractor` arms on the six pilot seeds is the remaining blocker to re-review. Expected cost: 6 seeds × 3 arms × 5 chapters = 90 chapter runs from `pre-planner-phase2-v1a`, plus the matched `mainv1a` observational arm on `main`.

**Query 2 — `planning-beats` token headroom summary** (fantasy genre, `llm_calls.agent = 'planning-beats'`, timestamps ≥ 2026-04-15; 126 calls total; corrected scale vs the 4096-maxToken legacy runs the raw rows show, since `maxTokens` was bumped to 8192 on 2026-04-18):

| stat | completion_tokens |
|---|---|
| min | 1,067 |
| avg | 1,522 |
| p95 | 1,882 |
| max | 2,170 |

Interpretation: the §8 pre-run token-shape gate (`baseline_planning_beats_completion_tokens + expected_delta_tokens_per_chapter < 7,500`) is comfortably satisfiable across the measured distribution. Even the p95 observed call at 1,882 tokens has >5,600 tokens of headroom before hitting the gate. Schema-add overhead for V1a (`requiredPayoffs` + `establishedFact.id` × avg beat count) is well under 1K tokens per chapter based on current Phase-2 output shape. **Pilot launch is NOT gated by token budget.**

**Query 3 — dark-fantasy ceiling verification** via `rg -n "exp #191|Verification \(exp #191\)|100% first-attempt pass" docs/decisions.md`:

Result: confirmed. `docs/decisions.md:618,626` — exp #191 (2026-04-15) measured dark-fantasy at 100% first-attempt pass on adherence-events, chapter-plan, and continuity (facts + state); no retries fired. **Dark-fantasy is excluded from the primary eval set per §6.** It remains available as a ceiling-verification datapoint only.

### 2.b Finalized mechanism numbers

Finalized numerical thresholds can only be pinned after Query 1 returns rows. Current charter §3 + §7 use count-based gates that don't require a pre-pilot number. No further frontmatter change needed — the charter is ready for re-review *as soon as* the §2.d mini-pilot (or its escalation to the full pilot) completes and Query 1 is re-run.

### 2.c Writer configuration (locked 2026-04-18)

All causal rows in this charter run under the **production fantasy writer route**, not a cleaner experimental proxy. The charter's causal question is whether V1a's schema churn is justified on the shipped path — not whether it would work under a different writer. Per Codex session `019da2ff-1192-7f13-a925-310f23e42702`, using DeepSeek as a cleaner probe would reproduce the same external-validity mistake v1 made in a different form.

Locked writer configuration for every arm:

- **Beat-writer model**: `salvatore-1988-v4` (W&B artifact `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4`) via the `salvatore-fantasy` pack in `src/models/roles.ts` `WRITER_GENRE_PACKS`.
- **Writer context mode**: `compactMode: true` — the default for voice-LoRA routes per `src/phases/drafting.ts:168`.
- **System prompt**: `beat-writer-system-salvatore.md` via `loadGenrePackPrompt`.
- **Structural priors**: `SALVATORE_PRIORS` injected at planner time (for the `main` V1a arm and for any arm that extends beyond the mini-pilot).
- **`WRITER_MODEL_OVERRIDE`**: explicitly UNSET. Any pilot run that leaks a non-default override invalidates its own row.

This configuration is identical across arms 1-3 (`baseline` / `prompt` / `extractor`) running from the `pre-planner-phase2-v1a` tag, and across the `mainv1a` observational row on current `main`. The *only* variable between arms is the Phase-2 planner surface; writer + checkers are frozen.

### 2.d Pre-launch mini-pilot (C+): paired `baseline + prompt` on a 15-chapter subset

Codex's recommended cheapest-partial-that-still-answers-the-charter. A baseline-only run (Claude's original C) measures headroom but cannot answer the charter's core question; a paired `baseline` vs `prompt` mini-pilot directly tests whether the cheap lever closes the gap — at a fraction of the full-pilot spend.

**Subset:**

- Seeds: `fantasy-archive`, `fantasy-cartographer`, `fantasy-debt` (3 of the 6 primary seeds from §6).
- Chapters per seed: 1 through 5.
- Arms: `baseline` and `prompt` from the `pre-planner-phase2-v1a` tag. `extractor` and `mainv1a` arms deferred to escalation.
- Total: 3 seeds × 5 chapters × 2 arms = **30 paired chapter runs**.
- Writer configuration: §2.c locked values.

**Primary output:** a 30-row table matching Query 1's shape (arm × seed × chapter × `failing_chapter` × `validation_fail` × `drafting_retry`), attached to §2.a.

**Escalation rule — declared before launch:** uses the §7 decision rule directly. Summarized here for operational reference only — §7 is the source of truth.

1. **SHIP** — mean paired `Δ retry_ratio ≥ 0.03` AND prompt wins ≥ 11/15 slots → cheap prompt lever is sufficient; V1a schema not justified by this pilot.
2. **JUSTIFY** — mean paired `Δ` within ±0.02 AND `mainv1a` beats both later → expand to full 6-seed pilot + add `extractor` + run `mainv1a` observational.
3. **KILL** — mean paired `Δ` within ±0.015 AND baseline pilot mean `retry_ratio ≤ 0.20` → seeds too easy; re-scope before spending more.
4. **ITERATE** — everything else → expand to full 6-seed pilot under the same §7 rule.

**Budget for mini-pilot (measured, not estimated):** 6 full-novel runs (3 seeds × 2 arms × 1 novel each, chapterCount=10 per seed; measure only chapters 1–5). Per-run token totals from the 16 clean-cost fantasy runs since 2026-04-15: wandb 320K in / 37K out = $0.024; deepseek 106K in / 27K out ≈ $0.02–$0.06; cerebras 3.4K in / 907 out = $0.003; groq negligible. **~$0.05–$0.10 per full run → ~$0.30–$0.60 total** for the mini-pilot. **Wall clock: 1.5–4 h** depending on LXC serialization — each 10-chapter novel runs roughly 15–45 min end-to-end on the tagged ref. No adversary re-review triggered by the mini-pilot itself — escalation-or-stop lands first, then re-review is called on the completed three-arm table per §11.

**Operational notes:**

1. Arms 1-3 run from a checkout of the `pre-planner-phase2-v1a` tag (commit `8f42eb6`), not from `main`. The `mainv1a` row runs on current `main`. Run the tagged arms first to avoid a mid-pilot deploy-lxc collision.
2. **Verifier-stack parity caveat (discovered 2026-04-18):** the tag predates the 2026-04-18 hallucination v3 wire-in (commits `1bf119d` → `df2c5f0`), so the `baseline` / `prompt` / `extractor` arms run with **adherence-only** beat-level checking, while `mainv1a` runs with **adherence + halluc-ungrounded + halluc-leak-salvatore**. For the mini-pilot this is harmless because both participating arms (`baseline` and `prompt`) share the tag's thinner verifier stack. The confound only matters when the pilot escalates to include `mainv1a` — at that point this charter must either (a) cherry-pick the halluc wire-in onto a throwaway branch off the tag, or (b) declare mainv1a's extra checker fires out-of-scope and measure only the adherence-layer failing-chapter count for the comparison. Decide at escalation; do not decide now.
3. **`novel_id` naming.** Harness auto-generates `novel-<timestamp>`; charter Query 1 expects `pp2-floor__<arm>__<seed>__<ts>`. Run natively, then post-hoc `UPDATE novels SET id = 'pp2-floor__...' WHERE id = '<auto_id>'`. Avoids touching the tag's code.

## 3. Falsification threshold

The mechanism is wrong if both cheap levers fail to reduce paired-set `retry_ratio` (per §7) versus the frozen original prompt, or if the only apparent gain shows up when verifier surfaces move instead of when planner output changes. In that case, abandon the claim that Phase-2 payoff schema is the causal lever and do not extend this family to V1b/V1c.

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

### 7.a Primary metric (locked 2026-04-18)

**Primary metric:** `retry_ratio = retry_count / total_beat_attempts` per matched chapter-slot, where:
- `retry_count` = count of `llm_calls` rows with `agent='beat-writer'` AND `attempt > 1` for that (novel, chapter).
- `total_beat_attempts` = count of all `llm_calls` rows with `agent='beat-writer'` for that (novel, chapter), all attempts.

**Aggregate:** unweighted mean paired improvement `Δ = baseline_retry_ratio − prompt_retry_ratio` across the 15 matched (seed, chapter) slots. Positive Δ means the prompt arm reduced retries vs baseline.

**Slot win:** counted ONLY when the prompt arm's full-precision retry_ratio is strictly lower than baseline's on the same (seed, chapter) slot. Ties do not count as wins.

**Explicitly NOT used:** no chapter weighting, no attempt weighting, no pooled beat-level rate. These would let chapter-5 giants (48 / 85 / 146 attempts) dominate the 15-slot pilot and turn the decision metric back into a workload-size signal instead of a chapter-level behavior signal.

### 7.b Decision rule

| Outcome | Condition | Action |
|---------|-----------|--------|
| **SHIP** prompt floor (V1a unjustified) | mean paired `Δ ≥ 0.03` AND prompt wins `≥ 11/15` slots | Cheap prompt lever is sufficient. Keep V1a live on `main`; do NOT extend to V1b/V1c on the strength of this pilot. |
| **JUSTIFY** schema (escalate) | mean paired `Δ` within `±0.02` AND `mainv1a` observational row beats both arms by `≥ 0.02` once added | Schema may be doing real work. Expand to the full 6-seed pilot per §6 + add the `extractor` arm + run `mainv1a`. Re-derive thresholds at full-pilot scale. |
| **KILL** causal claim | mean paired `Δ` within `±0.015` AND baseline pilot mean `retry_ratio ≤ 0.20` | Seeds insufficiently stressed; re-scope before further spend. |
| **ITERATE** | everything else | Expand to full 6-seed pilot under the same §7 rule. |

**Load-bearing axis:** the `≥ 11/15` slot-win rule. Under a null of 50% per-slot win rate, binomial P(≥11 wins / 15) ≈ 0.059 — hard enough to hit by luck alone but not so strict that a mini-pilot can't satisfy it. The `Δ ≥ 0.03` mean is a materiality backstop preventing ship on a pile of microscopic wins.

**Practical-sameness bands:** `±0.02` and `±0.015` define when arms are effectively identical. They're asymmetric by design — KILL is stricter on sameness because it triggers re-scoping, while JUSTIFY is looser because it only triggers escalation (not a terminal decision).

**Token-shape gate:** the `< 7,500 completion tokens` pre-run check from §8 still applies. Any arm whose chapter exceeds that gate fails for a token-budget reason independent of this metric.

**No p-values.** Effect-size rules only.

### 7.c Why this metric replaced the original binary `failing_chapter`

The original §7 used `failing_chapter = validation_fail OR drafting_retry` (binary, per chapter). Baseline measurement revealed:
- `validation_fail` signal: 0/15 chapter-slots. Zero variance → no detectable effect possible.
- `drafting_retry` signal: 14/15 chapter-slots (93% saturation). Given ~20 beats per chapter and the observed ~30% beat-level retry rate, P(≥1 retry per chapter) is near 1.

Combined, `failing_chapter` was saturated at 14/15 on baseline alone — a metric that can't distinguish a 1-retry chapter from a 43-retry chapter both flagged "failing." Codex session `019da330-c950-7d03-86bf-1847d7653fe0` verified the saturation and issued HALT-AND-RESPEC; session `019da336-081e-72b1-b191-dae888e9dd26` locked the replacement metric + numeric thresholds above using baseline-only data, before any prompt-arm data was examined.

The prompt-arm runs were still executing when the respec landed; data collection was allowed to continue operationally but all analysis was frozen until this §7.a/b was committed. Analysis under the new metric begins only from commits *after* this one.

## 7.a Granularity axis — secondary measurement (required)

User-directed addition 2026-04-18. The §7 failing-chapter count is a pass/fail surface; it answers *whether* the beat-writer lands a chapter that clears checkers. It does **not** distinguish whether the beat-writer received granular enough structure to produce *qualitatively better* prose at the beat level. The Floor arm (aggressive prompt) and the `main` V1a arm (explicit `SEEDS` / `PAYOFFS DUE` fields rendered into beat context) can plausibly hit identical §7 failing-chapter counts while producing beat-level prose that differs in kind — e.g. V1a realizing a seeded payoff with a crisper named referent, the Floor arm covering it more diffusely. That qualitative delta is the relevant signal for a beat-focused writer, and a pass/fail charter that ignores it will *under-value the schema lever even when schema is the right choice.*

**Required secondary measurement.** In addition to §7's failing-chapter count, score each (seed, chapter) slot on a pairwise granularity axis.

Protocol:

1. For every (seed, chapter) slot where arm A and arm B both produced prose that passed §7 (or both failed — exclude mixed-outcome pairs), assemble the full chapter prose from each arm.
2. Identify the set of seeded payoff pairs the planner declared for that chapter: `{ (setup_beat_index, payoff_beat_index, fact_description) }`. On the Floor arm these come from the aggressive-prompt "[plants payoff for beat N: FACT]" / "[pays off FACT from beat M]" markers. On the V1a arm they come from `establishedFact.id` + `requiredPayoffs` fields. On the baseline arm (frozen original prompt) they are extracted post-hoc by the measurement-only inference extractor from §5.
3. For each payoff pair, present the two arms' prose excerpts covering the payoff beat side-by-side to a named reasoning judge. The judge answers one question: *"Which output realizes the seeded payoff at the beat-level with a more specific named referent and a more concretely-dramatized fact?"* Options: arm-A / arm-B / tie / neither-realizes-it.
4. Score: per-arm `realized_with_granularity` count across all payoff pairs in the pilot. Report per-seed and pooled. Do **not** average the judge responses into a score; report the raw distribution.

**Judge identity (named to avoid circularity):** `claude-opus-4-7` (Anthropic). Rationale: not used as a label source in any Phase-2 planner or beat-writer training pipeline, distinct model family from the beat-writer stack (DeepSeek V3.2 + Salvatore LoRA on Qwen3-14B). Cross-reference `docs/decisions.md` 2026-04-17 Archetype POC for the circularity discipline.

**Granularity axis gates (independent of §7 failing-chapter count):**

| Outcome on granularity axis | Condition | Action |
|---|---|---|
| V1a delivers distinct granularity lift | `main` V1a realizes `≥N+3` payoff pairs more than the Floor, where `N` is the Floor arm's realized count, across the 30 paired slots | Count as evidence that schema is doing work beyond what prompt alone delivers, even if §7 failing-chapter gates would otherwise KILL. Promote to re-examination of the §7 JUSTIFY gate. |
| V1a and Floor are granularity-tied | V1a advantage is `<3` payoff pairs | Combine with §7 count to decide. No granularity justification for schema from this pilot. |
| Floor beats V1a on granularity | Floor realizes more payoff pairs than V1a | Flag as a material surprise; do not ship either until root-caused. |

**What this catches that §7 misses.** A chapter that passes adherence-events by dramatizing *some* events from the plan but substitutes a generic noun ("the artifact") for a seeded named fact ("the iron chest of the bloodline heirs") will score identically on §7 failing-chapter count whether the planner gave the writer an `establishedFact.id=bloodline-iron-chest` or a loose prompt instruction. The granularity axis is the only axis in this charter that forces the judge to look at *whether the named referent from the plan actually reaches the prose.*

**What this axis does not measure.** Prose quality in aggregate (cadence, voice, rhythm — those live in the writer-imitation-benchmark family), adherence-events-style enactment (that's §7), or continuity / hallucination (those are their own checkers). This axis is narrow by design: does structured planner output reach the beat-writer's prose as structured content, or does it get smoothed away?

**Cost.** `30 slots × avg 4 payoff pairs per chapter × 1 judge call per pair ≈ 120 judge calls`. On `claude-opus-4-7` at typical chapter-payoff-excerpt sizes, estimate $1–$3 added to the pilot budget in §8. Fold into the §8 cap; do not request a separate budget line.

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
