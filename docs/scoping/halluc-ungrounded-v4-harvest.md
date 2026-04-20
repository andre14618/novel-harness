---
status: draft
date: 2026-04-20
kind: training-data-harvest-plan
for: halluc-ungrounded-v4 (active-learning shard)
depends-on: exp #254 (beat-entity-list V1), halluc-v3-production-report-2026-04-20.md
---

# halluc-ungrounded-v4 Active-Learning Harvest Plan

Scoping document for the next training shard for `halluc-ungrounded`. Does **not** cover
training submission; that is gated on human-accept signal infrastructure (see §6).

---

## 1. Motivation

`halluc-ungrounded-v2:v1` ships with a 77.8%/85.4%/81.4% P/R/F1 on natural val. The
production-telemetry pass (2026-04-20) identified two specific failure signatures that
retraining cannot fix via synthetic data alone:

**Class-A: context-surface mismatch.** The writer's grounded surface (beat brief +
transition bridge + chapter outline + resolved refs) is wider than the checker's
(`beat.description` + world-bible names + speaker names). The writer introduces named
entities from the wider surface; the checker correctly fires. These are true positives at
~90% precision but represent an architectural problem, not an adapter calibration problem.
The right long-term fix is planner-level entity enrichment in `beat.description` (option
(a) from the production report). Active-learning harvest of these fires trains v4 to
tolerate the context-surface mismatch; it does not eliminate the root cause.

**Class-B: entity-in-grounded-sources overfire.** The adapter fires on an entity that
does appear in `groundedSources` (from_brief, derived_outline_fact, or planner_emitted
buckets) but was not surface-matched by the adapter's attention. Exp #254 measured this
at 17% of fires (2 FP / 14 TP from 16 labeled solo fires). These are the true FPs that
could be eliminated by training v4 to see the groundedSources provenance.

Active-learning harvest assembles labeled real-production fires from both classes and
merges them into the v2 training pool to produce a v4 adapter with tighter FP
calibration on Class-B and explicit grounding on real-production prose distributions.

---

## 2. Candidate Definition

### Class-A: Solo-ungrounded TP candidates

A row from `llm_calls` qualifies as a Class-A candidate when ALL of the following hold:

1. `agent = 'halluc-ungrounded'`
2. `(response_content::jsonb)->>'pass' = 'false'`
3. No co-fire with `adherence-events` on the same `(novel_id, chapter, beat_index, attempt)`.
4. No co-fire with `halluc-leak-salvatore` on the same tuple.
5. `timestamp >= '2026-04-18'` (post-wire-in only; prior rows lack structured
   `groundedSources` provenance).

These fires have ~90% precision (corrected estimate from production report offline
replay). The 10% FP rate maps almost entirely to Class-B below.

**Formation of a training pair from a Class-A candidate:**
- `system_prompt` from `llm_calls.system_prompt` (already stored)
- `user_prompt` from `llm_calls.user_prompt` (already stored; all 712 solo fires have
  non-null user_prompt as of 2026-04-20)
- `assistant` label: adapter's own `response_content` (assumed TP); Sonnet adjudication
  flips to `{"pass":true,"issues":[]}` for confirmed FPs.

### Class-B: Entity-in-grounded-sources FP candidates

A Class-B candidate is a Class-A candidate where at least one fired entity appears as a
case-insensitive substring of any token in `groundedSources.from_brief`,
`groundedSources.derived_outline_fact`, or `groundedSources.planner_emitted`.

Only meaningful for v0/v1 charter runs (the `groundedSources` provenance buckets are
only populated when `BEAT_ENTITY_LIST_VARIANT` is set). These are the "Aldric overfire
despite bible grounding" pattern from exp #254.

**Formation of a training pair from a Class-B candidate:**
- Same pair shape as Class-A.
- Label should be flipped to PASS (i.e., `{"pass":true,"issues":[]}`) after Sonnet
  adjudication confirms the entity was actually grounded. The adapter should learn NOT to
  fire when the entity appears in the provenance.

---

## 3. Current Candidate Count

All counts as of 2026-04-20 DB snapshot.

### 3.1 Source pools

| Source | Solo-ungrounded fires | Notes |
|---|---|---|
| Production panel (7 novels, 2026-04-19, `groundedSources.variant=null`) | 85 | Production report sampled 20; ~90% precision |
| Charter V0 (novel-1776698676238, `variant=v0`) | 38 | Beat-entity-list disabled |
| Charter V1 (novel-1776698676238-v1, `variant=v1`) | 45 | Beat-entity-list enabled |
| Production-other (post-wire-in, non-panel, `variant=null`) | 544 | All fantasy/epic-fantasy genre; 2026-04-19 onward |
| **Total** | **712** | |

### 3.2 Class-B candidates (entity-in-grounded-sources FPs)

Across all rows that have `groundedSources` with non-null provenance buckets (charter
V0 + V1 only):

- 10 issue-level Class-B candidates across 93 total fires (10.8% FP rate at issue level)
- 9 of these are `Aldric` firing despite appearing in `derived_outline_fact`
- All 10 are from the charter V0/V1 runs (the production panel fires lack structured
  provenance because `BEAT_ENTITY_LIST_VARIANT` was not set on those novels)

Class-B is structurally sparse because only the charter runs produced structured
`groundedSources`. Until `BEAT_ENTITY_LIST_VARIANT=v1` is promoted to default (pending
per exp #254 conclusion), production fires lack the per-bucket metadata needed to
identify Class-B candidates automatically.

### 3.3 Deduplicated unique (novel, chapter, beat_index) tuples

Many of the 712 fires are repeat attempts on the same beat (cleared-on-retry: 185,
persistent: 527). For training data we want unique beats, not unique attempts.

Approximate unique-beat count: 712 total minus ~185 cleared-retry fires leaves ~527
unique persistent-beat fires. Cleared fires can be included as PASS examples (next
attempt passed) to provide negative examples of the same prose shape.

---

## 4. Harvest Methodology

### 4.1 Sampling strategy for 200-candidate target

With 712 solo-fire rows available, we do not need to use all of them. Active-learning
harvest should be stratified to avoid novel-level clustering (don't harvest all beats
from a single novel that produces many fires):

1. **Cap per novel at 20 solo fires.** With 32 distinct novels, this limits any single
   novel to 10% of the harvest.
2. **Prioritize persistent fires over cleared ones.** Cleared fires on attempt N+1
   imply the entity was removed by the retry-context wording change — these are less
   informative training examples.
3. **Stratify by groundedSources.variant** when available: include the 38 v0 and 45
   v1 charter fires as-is (small set, fully adjudicated via exp #254 Sonnet panel).
4. **Random sample from production-other pool** to fill remaining slots up to 200.

Expected composition of a 200-candidate harvest:
- 38 Charter V0 (all) — already have exp #254 Sonnet adjudication on 10 of them
- 45 Charter V1 (all)
- 10 Class-B candidates (entity-in-grounded overfire)
- ~107 random sample from production-other pool (capped per novel)

### 4.2 Adjudication via Sonnet subagents

Each candidate needs a TP/FP adjudication label. Exp #254 demonstrated the pattern:

**Subagent task:** Given the full `user_prompt` (BEAT BRIEF + WORLD BIBLE + SPEAKERS +
PROSE TO CHECK) and the adapter's `response_content` (fired issues), adjudicate each
issue as:
- `TP` — entity genuinely absent from grounded context; adapter correct to fire
- `FP_SURFACE_MISMATCH` — entity present in grounded context but not the narrow
  checker surface (`beat.description` + world-bible names + speaker names); this is a
  context-engineering FP, not an adapter error
- `FP_OVERFIRE` — entity clearly in the grounded sources (a Class-B error); adapter
  should not have fired

**Batch sizing:** 15 candidates per subagent (each has a moderate-length user prompt),
~14 batches for 200 candidates.

**Label application:**
- `TP` fires → training FAIL pair (keep adapter's label)
- `FP_SURFACE_MISMATCH` fires → keep as FAIL pair (adapter is correct to fire given its
  narrow surface; do NOT relabel to PASS — these are load-bearing true positives)
- `FP_OVERFIRE` fires → relabel to PASS (`{"pass":true,"issues":[]}`)

Note: the production report corrected the initial Sonnet subagent miscalibration that
labeled `FP_SURFACE_MISMATCH` as FP. For v4 harvest subagents, the rubric must
explicitly define the narrow checker surface (beat.description + world-bible names +
speaker names) and note that transition bridge / chapter outline / resolved refs are
NOT part of the checker's grounded surface.

### 4.3 PASS examples from cleared fires

Cleared fires (185 total) are fires at attempt N where attempt N+1 passed. The
attempt-N+1 `user_prompt` + `{"pass":true,"issues":[]}` label forms a natural PASS
example — the writer removed or grounded the entity after the retry-context wording. Cap
these at 100 (to avoid overwhelming the training mix) and include only from novels with
≥3 cleared fires.

---

## 5. Expected Cost

### Labeling (200 candidates via Sonnet subagents)

Per docs/synthetic-labeling-sop.md methodology (Claude Code subagents, $0 marginal
cost under subscription):

- 200 candidates / 15 per subagent = 14 parallel subagents
- Estimated wall time: ~20 min (subagents run in parallel)
- API cost: $0 (Claude Code subscription)

### Training (estimate for planning purposes only)

W&B Serverless SFT at current pricing (pay-as-you-go, ~$3.76/month across all active
adapters):

- Estimated training pairs: 200 labeled new fires + ~100 PASS cleared fires + 1273
  existing v2 pool = ~1573 pairs total
- Training runs on Qwen3-14B-Instruct base; estimated cost similar to prior adapter
  runs (~$0.50–$1.50/run based on pair count)

---

## 6. Proposed Training-Data Blend for v4

| Shard | Source | Pairs | Label type |
|---|---|---|---|
| Legacy v2 pool (synth) | finetune-data/halluc-ungrounded-v1-train.jsonl | 1273 | Sonnet-flipped |
| Active-learning FAIL | Harvest: adjudicated TP fires | ~180 (of 200) | Production-natural |
| Active-learning PASS (cleared) | Attempt N+1 passed rows | ~100 | Production-natural |
| Class-B PASS relabels | Entity-in-grounded FP overfire | ~10 | Production-natural |
| **Total** | | **~1563** | |

Class balance target: 50/50 PASS/FAIL (match v2 formatter behavior). Oversample
PASS shard if needed (production fires are FAIL-heavy by definition).

Eval set: keep the existing `halluc-ungrounded-v1-val-synth.jsonl` plus a small
natural-production held-out set (20 fires from novels NOT in the harvest, adjudicated by
Sonnet). This gives both synth-distribution and natural-distribution eval coverage.

---

## 7. Eval Plan

### 7.1 Gates before training

| Gate | Threshold | Source |
|---|---|---|
| Sonnet adjudication precision on 10 pilot candidates | ≥80% match with known exp #254 labels | Pilot batch from charter V1 |
| Adjudicated FP rate on 200 candidates | Between 5–25% | Expect ~10% based on production report |
| Training-data PASS:FAIL balance | 45:55 – 55:45 | After oversampling if needed |

### 7.2 Post-training eval

Run the existing natural-val holdout plus a fresh 5-novel production panel:

| Metric | v2 baseline | v4 target |
|---|---|---|
| Natural P/R/F1 | 77.8% / 85.4% / 81.4% | ≥80% / ≥83% / ≥81% |
| Class-B FP rate | ~17% of solo fires | ≤10% |
| Solo-fire production rate | 46.7% (beat-level) | No regression target |

The primary objective for v4 is to reduce Class-B FP rate (entity-in-grounded overfire)
while not regressing natural recall.

### 7.3 Promotion gate

Promote v4 to `deployed` only if:
- Natural F1 ≥ v2 baseline (81.4%)
- Class-B FP rate ≤ 10% on the charter V1 panel (currently 17%)
- Solo-fire production beat rate does not increase ≥ 5pp over v2 baseline

---

## 8. Open Questions

### 8.1 Missing human-accept signal infrastructure (BLOCKER for training)

There is no mechanism in the DB or harness to tag a `llm_calls` row as TP/FP post-hoc.
Sonnet adjudication results currently live only in flat JSONL files under `/tmp/` (per
synthetic-labeling-sop.md). For a production active-learning loop we need one of:

**Option A (minimal):** Add a `llm_call_adjudications` table:
```sql
CREATE TABLE llm_call_adjudications (
  id          serial PRIMARY KEY,
  llm_call_id integer REFERENCES llm_calls(id),
  label       text NOT NULL,   -- 'TP' | 'FP_SURFACE_MISMATCH' | 'FP_OVERFIRE'
  adjudicated_by text,          -- 'sonnet-4-6' | 'human'
  adjudicated_at timestamptz DEFAULT now(),
  notes       text
);
```
This is a single migration (sql/029) and allows the harvest script to query labeled rows
directly rather than joining against flat JSONL files.

**Option B (ad hoc):** Continue with the flat-JSONL adjudication approach from
synthetic-labeling-sop.md — Sonnet subagents write to `/tmp/`, aggregated locally, then
merged into the training file. No DB infrastructure required. Works for a one-shot v4
harvest but cannot accumulate labels across runs.

Recommendation: Option A before training submission, Option B for the first harvest run
if time-constrained. Do not train without adjudication labels — raw production fires
include ~10% FPs that will degrade v4 precision if included unlabeled.

### 8.2 `BEAT_ENTITY_LIST_VARIANT=v1` promotion to default

Exp #254 conclusion says V1 should be promoted to default. Until that happens:
- Production fires have `groundedSources.variant=null` and lack per-bucket provenance
- Class-B candidates cannot be auto-detected from production fires
- The harvest script must skip the entity-in-grounded check for null-variant rows

### 8.3 Cleared-fire PASS labeling fidelity

A cleared fire at attempt N+1 may have passed because the writer *removed* the entity
or because the writer *renamed* it to something else (still ungrounded, just a different
name). The adapter correctly passes on the new prose. These PASS examples may introduce
noise if the new entity is still technically ungrounded. The harvest script should cap
cleared-fire PASS examples at 100 and flag this for post-training review.

### 8.4 Non-Salvatore production fires

The production panel is 100% Salvatore-routed (fantasy genre). Production-other fires
are also all fantasy/epic-fantasy/dark-fantasy. v4 will be trained entirely on
Salvatore-route prose distribution. This is intentional (per project philosophy:
per-writer adapters); document in adapter_registry.notes.

---

## 9. Timeline

| Step | Dependency | Estimate |
|---|---|---|
| BEAT_ENTITY_LIST_VARIANT=v1 promoted to default | Pending | 1 commit |
| sql/029 adjudication table | Option A decision | 0.5h |
| harvest-v4-candidates.ts extraction script | sql/029 or Option B | 1h |
| Sonnet adjudication run (14 parallel subagents) | Extraction script | 20 min wall |
| Adjudication result aggregation + blend | Sonnet run complete | 0.5h |
| Training submission (W&B SFT) | Blend file + experiment ID | 1 commit |
| Eval + promotion decision | Training complete (~2h W&B) | 1h |

Total estimated elapsed (excluding W&B training): ~4h of active work.
