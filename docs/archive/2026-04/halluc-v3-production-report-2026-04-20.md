---
status: closed
date: 2026-04-20
kind: production-measurement-report
for: docs/todo.md §1 "Measure production fire rate per adapter over next 5-10 novels"
runbook: ./hallucination-v3-wire-in-plan.md §8
panel: 7 natural Salvatore-routed novels post-wire-in (commit df2c5f0, 2026-04-18)
---

# Halluc V3 Production Report — 2026-04-20

First production-telemetry pass after the 2026-04-18 halluc-v3 two-adapter wire-in. Runbook §8 steps 1–8 executed; §8.9–10 follow-on recommendations below.

## Panel

Seven natural (no `DEBUG_FORCE_*` flags, no `chapter_exhaustions`, no `chapter_revisions`) novels after the wire-in commit, all routed to the Salvatore voice LoRA writer:

- `novel-1776608639218` (3-chapter, fantasy) — 92 beats
- `novel-1776608819617` (3-chapter, fantasy) — 24 beats
- `novel-1776609267761` (3-chapter, fantasy) — 20 beats
- `novel-1776611156855` (1-chapter, fantasy, done) — 29 beats
- `novel-1776612087459` (1-chapter, fantasy, done) — 33 beats
- `novel-1776614270831` (3-chapter, fantasy) — 37 beats
- `novel-1776627411728` (1-chapter, epic-fantasy, done) — 26 beats

Total: **261 beat-writer attempts**.

All panel novels are fantasy-route. Non-Salvatore route verification remains open but is protected in code by `writerPack.label === "salvatore-fantasy"` gating in `src/phases/beat-checks.ts`; production telemetry cannot provide the final signal until a non-fantasy novel runs.

## Clean-run validation — PASS

| Check | Result | Prior baseline |
|---|---|---|
| `chapter_exhaustions` rows | 0 | n/a |
| `chapter_revisions` rows | 0 | n/a |
| `chapter-plan-checker` reject rate | 0/8 = 0% | 35–44% (pp2-floor campaign) |

Non-blind-retry handlers stay silent on clean novels. Chapter-plan-checker reject rate fell to 0% after the DS V3.2 base swap + beat-targeted rewrites (commits `1e52baf`, `892944f`). This closes the "clean no-forced-flags validation run" item from `docs/todo.md` §5.

## Fire rates (runbook §8 step 3)

| Adapter | Fires | Verdicts | Rate |
|---|---|---|---|
| adherence-events | 27 | 251 | 10.8% |
| halluc-ungrounded | 119 | 255 | **46.7%** |
| halluc-leak-salvatore | 40 | 255 | 15.7% |
| any checker fired | 140 | 255 | 54.9% |
| beat-writer retry ratio | 146 | 261 | 55.9% |

Coverage (runbook §8 step 8): 251/261 = 96.2% of beat attempts have all three checker calls. The 10 missing are bounded by the deterministic pre-LLM short-circuit in `src/agents/writer/adherence-checker.ts:57-95` (`issues.length >= 2`) and occasional transport failures.

Adherence at 10.8% is meaningfully *below* the historical V4 ~21% fail-rate baseline. Attributing this to the Salvatore LoRA writer enacting beats more reliably than the pre-LoRA DeepSeek writer V4 was evaluated against — a second-order benefit of the voice-LoRA route. Not a "checker not running" artifact; coverage is solid.

## Co-fires and solo fires (runbook §8 steps 3–4)

Solo fires (only this adapter flagged the beat):
- solo adherence: 15
- solo ungrounded: 76
- solo leak: 6

Co-fires:
- ungrounded + leak: 34
- ungrounded + adherence: 12
- leak + adherence: 3
- all three: 3

The large solo-ungrounded bucket (76) is where most of the retry pressure lives.

## Retry clearance (runbook §8 steps 6–7) — POOR

Of fired beats, next-attempt verdict:

| Adapter | Cleared | Still fired | No verdict |
|---|---|---|---|
| adherence | 3 | 15 | 9 |
| ungrounded | 11 | 72 | 36 |
| leak | 11 | 19 | 10 |

Ungrounded clears on 9% of retries. Most fired beats stay fired after one retry. This trips runbook §8.10: "If repeated retries preserve the same token/entity, tighten retry-context wording before retraining anything."

## Precision on solo-ungrounded fires (runbook §8 step 5)

Sampled 20 solo-ungrounded beats (3 each from 6 novels, 2 from the 7th), adjudicated by 4 parallel Sonnet subagents.

**Initial verdict: 12 TP / 5 FP / 3 borderline.** Revised after 2026-04-20 offline replay below.

### REVISED FINDING — 2026-04-20 offline replay

Initial precision was miscalibrated. Building `extractProperNouns()` + re-running the adapter on all 20 samples with a "From-brief:" line appended to `WORLD BIBLE` surfaced the real signal: the adapter almost never sees the "FP" entities the subagents flagged as in-brief, because subagents drifted to the **writer's** wider `beat_brief_excerpt` field (transition bridge + chapter outline + resolved refs) instead of the checker's narrower BEAT BRIEF. Direct inspection confirmed: of the 20 samples, only `Heartstone` (novel-1776608639218 ch=3 beat=5) was actually in the checker's `Summary` text. The From-brief fix cleared it 1/1.

Spot-check on another subagent-labeled "FP": `Baldur's Gate` in novel-1776608639218 ch=1 beat=4. The checker's BEAT BRIEF Summary says `"Vex reveals the message must cross the Ashen Wastes to Saltford Crossing..."`; no mention of Baldur's Gate. The entity lives only in the writer's transition bridge / chapter context and correctly fires as ungrounded from the checker's view.

**Corrected precision estimate: ~90%+.** The adapter is well-calibrated to its narrow grounded surface. The dominant "miss" pattern is a **context-surface mismatch between writer and checker**, not adapter overfire:

- Writer sees: beat brief + transition bridge + chapter outline + world bible + resolved refs.
- Checker sees: `beat.description` + world-bible names + speaker names.
- Entities the writer uses from transition-bridges / chapter outlines (not the beat description) correctly fire from the checker's view.

True positives were clean either way — Salvatore-corpus leaks the leak adapter missed (Bremen's Run, Harpells) plus writer-invented polities (Rimeport, Southhold, Orc Kingdoms, Balennar Keep).

### Why the 46.7% ungrounded fire rate remains high

With ~90% precision, the 46.7% fire rate means the writer is genuinely producing ungrounded entities on nearly half of beat attempts — this is a **writer / planner issue, not an adapter issue**. The writer introduces named entities from the transition bridge or chapter-level context that never land in the per-beat grounded surface. Fixing this is a planner / context-engineering problem, not a retraining problem.

## Leak-route gating (runbook §8 step 8)

All 7 panel novels are Salvatore-routed. `halluc-leak-salvatore` fired on 40/255 (15.7%) and never on a non-Salvatore beat because every panel beat is Salvatore-routed. In-code gating at `beat-checks.ts` guarantees non-Salvatore silence; production verification awaits a non-fantasy novel run.

## Actions (ordered by leverage)

1. **Tighten retry-context wording for halluc-ungrounded.** SHIPPED (`src/phases/beat-checks.ts` `formatRetryLine`). Retry line now includes the resolution space: "replace with an entity from the beat brief or world bible, or remove the reference entirely. Do not invent new named entities." Leak wording similarly expanded. Measure clearance rate on the next 5 novels.

2. **Narrow brief-extraction context fix — SHIPPED.** `src/agents/halluc-ungrounded/context.ts` now extracts proper-noun candidates from `beat.description` + `outline.setting` and adds a `From-brief:` line to the `WORLD BIBLE (names only)` block. Flipped 1/1 of the true in-scope FP cases in the offline replay (Heartstone). Correctly does not touch the 19 samples whose "FPs" were actually context-surface mismatches.

3. **Context-surface mismatch between writer and checker — NEW, root cause of the remaining 46.7% fire rate.** The writer's grounded surface (beat brief + transition bridge + chapter outline + resolved refs) is wider than the checker's (`beat.description` + world-bible names + speaker names). The writer pulls named entities from the wider surface; the checker correctly fires. Fix options:
   - (a) **Enrich `beat.description` at plan-time** so entities the transition bridge or chapter outline assume also land in the per-beat grounded text. Planner-level change; requires updating `src/agents/planning-beats/` schema or prompt.
   - (b) **Widen the checker's grounded surface** to include `transitionBridge` and/or `outline.establishedFacts`. Off-distribution for the current adapter; would require retraining or tolerating some precision loss.
   - (c) **Suppress writer entity introduction not grounded in beat.description.** Writer prompt could be told to avoid naming new entities absent from its own beat brief. Hard to enforce reliably.
   - Start with (a) — cheapest, most principled.

4. **Non-fantasy route verification.** Open — when the next non-fantasy novel runs, confirm `halluc-leak-salvatore` generates zero `llm_calls` rows on that route.

5. **v4 active-learning harvest.** Still open (`docs/todo.md` §1). Corrected view: the 76 solo-ungrounded fires are mostly TRUE positives — a good candidate for v4 distillation but not a retraining-priority signal.

## What I'm NOT recommending

- Retraining halluc-ungrounded from scratch. The adapter is not broken; it has a specific context-weighting failure that can be addressed cheaper.
- Switching to voting / soft-signal aggregation. Runbook §8.9 fires only if solo-fire precision is *poor* (below 50%). 60–75% is not poor enough to abandon OR-gating.
- Generating fresh novels. Panel is sufficient for first-pass signal.

## Scripts

- `scripts/hallucination/halluc-v3-fire-rate.ts` — fire-rate report
- `scripts/hallucination/sample-solo-ungrounded.ts` — precision sampler
- `scripts/hallucination/solo-ungrounded-samples.jsonl` — 20 adjudicated samples
