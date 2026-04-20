---
status: closed
date: 2026-04-20
kind: production-measurement-report
for: docs/todo.md §1 "Measure production fire rate per adapter over next 5-10 novels"
runbook: docs/hallucination-v3-wire-in-plan.md §8
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

Sampled 20 solo-ungrounded beats (3 each from 6 novels, 2 from the 7th), adjudicated by 4 parallel Sonnet subagents reading the exact `halluc_ungrounded_user_prompt` the adapter saw.

**Verdict: 12 TP / 5 FP / 3 borderline (lean-FP)** → precision 60% (conservative) to 75% (charitable). Below the 77.8% combined natural-val reported in `docs/decisions.md`, but with a clear single-class failure mode.

**Dominant FP pattern — adapter overfires on brief-grounded entities.** Verified directly on one sample (novel-1776608639218 ch=3 beat=5): the `BEAT BRIEF: Summary` the adapter saw literally contained "a cursed artifact called the **Heartstone**", and the adapter flagged `Heartstone` as ungrounded anyway. The adapter is treating `WORLD BIBLE (names only)` as the canonical grounded-entity set and under-weighting proper nouns introduced in the brief summary.

Other examples of the same pattern: "Baldur's Gate" and "Spine of the World" (verbatim in brief), "Frostbite Citadel" and "Council" (verbatim in brief), "Syndicate" (in brief dialogue), "Lake Communities" (in transition bridge).

True positives were consistently clean — Salvatore-corpus leaks the leak adapter missed (Bremen's Run, Harpells) plus writer-invented polities (Rimeport, Southhold, Orc Kingdoms, Balennar Keep).

## Leak-route gating (runbook §8 step 8)

All 7 panel novels are Salvatore-routed. `halluc-leak-salvatore` fired on 40/255 (15.7%) and never on a non-Salvatore beat because every panel beat is Salvatore-routed. In-code gating at `beat-checks.ts` guarantees non-Salvatore silence; production verification awaits a non-fantasy novel run.

## Actions (ordered by leverage)

1. **Tighten retry-context wording for halluc-ungrounded.** Runbook §8.10 prescribed action. Current retry line is "remove or ground `<entity>`." Writer often preserves the entity across retries because the prompt doesn't surface *what should replace it* or that the entity may be a Salvatore-corpus leak. Proposal: add "This entity is not in your beat brief or world bible. Either replace with a grounded entity from the list below, or remove the reference entirely." Measure clearance rate on the next 5 novels.

2. **Address brief-grounded-entity FP class.** Two options, in order of cost:
   - (a) **Context fix (cheap, try first):** extract proper-noun candidates from `beat.description` and add them to `WORLD BIBLE (names only)` → `Locations` or a new `This Beat's Grounded Entities` bullet. No retraining; changes only `src/agents/halluc-ungrounded/context.ts`. Measure FP rate on the next 5 novels.
   - (b) **Retraining (only if 2a doesn't close the gap):** regenerate `format-v3-two-adapters.ts` training set with brief-introduced proper nouns treated as grounded. Tag `docs/decisions.md` and rebuild adapter.

3. **Non-fantasy route verification.** Open — when the next non-fantasy novel runs, confirm `halluc-leak-salvatore` generates zero `llm_calls` rows on that route.

4. **v4 active-learning harvest.** Still open (`docs/todo.md` §1). The 76 solo-ungrounded fires are a candidate seed for v4 disagreement mining.

## What I'm NOT recommending

- Retraining halluc-ungrounded from scratch. The adapter is not broken; it has a specific context-weighting failure that can be addressed cheaper.
- Switching to voting / soft-signal aggregation. Runbook §8.9 fires only if solo-fire precision is *poor* (below 50%). 60–75% is not poor enough to abandon OR-gating.
- Generating fresh novels. Panel is sufficient for first-pass signal.

## Scripts

- `scripts/hallucination/halluc-v3-fire-rate.ts` — fire-rate report
- `scripts/hallucination/sample-solo-ungrounded.ts` — precision sampler
- `scripts/hallucination/solo-ungrounded-samples.jsonl` — 20 adjudicated samples
