---
status: complete
date: 2026-05-03
lane: 2026-05-03-world-bible-architecture-step-0
charter: docs/charters/world-bible-architecture.md §0e
experiment: 403
verdict: PASS
---

# Step 0e — Pre-Step-4 Cost Probe Results

## Verdict

**PASS.** Charter stop gate (d) does not fire. Projected per-chapter editorial cost at K=5 V4 Flash warm is **$0.0008/chapter** vs the $0.50 threshold — ~600× under. Cost is decisively not a bottleneck for the editorial layer.

## Probe Setup

- **Script:** `scripts/_step0e-cost-probe.ts`
- **Model:** DeepSeek V4 Flash, thinking disabled, temperature 0.3, maxTokens 1024
- **Payload:** synthetic structured canon prefix (~1.7K tokens) + chapter prose (~2.5K tokens) + judge prompt (~250 tokens). Total prompt ~4000 tokens per call.
- **K:** 10 sequential calls (to measure cold-vs-warm cache behavior on the same prefix).
- **Total spend:** $0.0012 across all 10 calls. Way under the $0.10–$0.50 estimate in the charter.
- **Cache hit ratio:** 99.2% on calls 2–10 (warm).

## Per-Call Results

| Call | Prompt tokens | Cached tokens | Cache hit % | Output tokens | Latency (ms) |
|---|---|---|---|---|---|
| 1 (cold) | 4000 | 0 | 0.0% | 8 | 1348 |
| 2 | 4000 | 3968 | 99.2% | 8 | 988 |
| 3 | 4000 | 3968 | 99.2% | 8 | 1153 |
| 4 | 4000 | 3968 | 99.2% | 8 | 1097 |
| 5 | 4000 | 3968 | 99.2% | 478 | 7214 |
| 6 | 4000 | 3968 | 99.2% | 933 | 13306 |
| 7 | 4000 | 3968 | 99.2% | 317 | 5324 |
| 8 | 4000 | 3968 | 99.2% | 8 | 1023 |
| 9 | 4000 | 3968 | 99.2% | 8 | 1024 |
| 10 | 4000 | 3968 | 99.2% | 8 | 922 |

Note: calls 5–7 returned non-empty findings (the prose contains a deliberately-engineered Aldric's-brother-death detail vs. fact-014 which says brother's death is at chapter 5 — judge correctly flags or correctly doesn't flag depending on its read of fact-017's "this is a coincidence" qualifier). Output token count varies with finding density. The variation in output cost is ~$0.0001 per call at the high end and is dominated by the input cost story regardless.

## Per-Chapter Cost Projections (Charter §0e Required Output)

| Configuration | K=5 judges | K=10 judges |
|---|---|---|
| V4 Flash, warm prefix (1 cold + N−1 warm) | **$0.0008/chapter** | $0.0012/chapter |
| V4 Flash, cold every call (cache TTL miss) | $0.0028/chapter | $0.0056/chapter |
| V4 Pro (75%-off promo), warm prefix | $0.0025/chapter | $0.0035/chapter |

### Headroom analysis

The probe used a 4K-token total prompt. A real production bible+chapter prefix could be substantially larger. Conservative scaling at a 50K-token full-novel bible:

| Configuration | K=5 judges | K=10 judges |
|---|---|---|
| V4 Flash, warm prefix, 50K-token bible | ~$0.0087/chapter | ~$0.0108/chapter |
| V4 Pro promo, warm prefix, 50K-token bible | ~$0.026/chapter | ~$0.031/chapter |

Even at the worst-case configuration tested (V4 Pro promo + 50K-token bible + K=10), projected cost is ~$0.03/chapter — **~17× under the $0.50 threshold**. For a 50-chapter novel, full editorial layer cost ≈ $1.50, which is well within the existing per-novel cost envelope.

## What This Result Means

1. **Charter stop gate (d) does not fire.** Cost is not a kill-gate for the architecture under any plausible production configuration.
2. **K=10 multi-judge editorial is economically free.** The prefix-cache discount (98% off input on cached prefix) makes the marginal cost of an additional judge call trivial.
3. **V4 Pro is viable as a judge.** At promo pricing it's only ~3× more expensive than V4 Flash on warm prefix — and Pro's reasoning quality may well justify the cost on a subset of high-stakes judges.
4. **Cache TTL design matters.** The "warm prefix" projections assume the K judges fire within the cache TTL (5 minutes typical for OpenAI-style providers; DeepSeek similar). Production design must batch judge calls per chapter so they all hit the warm prefix. If the editorial loop spreads judges across hours, costs degrade toward the cold-every-call projection — still under threshold but ~7× more expensive.

## What This Probe Does NOT Cover

- Real bible content (used synthetic prefix). Production bible structure may have different cache stability characteristics.
- Long-context judges (the chapter prose was ~2.5K tokens; some chapters are ~5K).
- Output-token variance across realistic findings volumes (the probe's output range was 8–933 tokens; production may be wider).
- V4 Pro at base pricing (post-promo). Promo expires 2026-05-31; charter Step 4 should re-validate at base pricing if the promo lapses before the editorial layer ships.

These are not blockers for the verdict — the headroom is large enough that even ~3× pessimism in real-production costs leaves the architecture economic. They are caveats for Step 4's actual cost model when it lands.

## Stop-Gate Verdict (Charter §0e)

> **Stop gate.** If projected per-chapter editorial cost at K=5 with V4 Flash exceeds $0.50/chapter, the architecture is uneconomic at production scale.

**Projected: $0.0008/chapter at K=5 V4 Flash warm. Threshold: $0.50/chapter. Verdict: PASS.**
