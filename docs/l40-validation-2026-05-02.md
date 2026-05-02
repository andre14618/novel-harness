---
status: result
date: 2026-05-02
experiment: 365
parent: L40
seed: fantasy-system-heretic
chapters_attempted: 3
chapters_completed: 0
stop_condition: (b) NEW out-of-scope cluster found (writer invents unsanctioned named entities)
---

# L40-validation — Heretic re-smoke after NER post-filter ship

## Summary

Re-smoked `fantasy-system-heretic` (3 chapters, $4 budget) on commit `d356443` to validate the L40 NER post-filter (`isNerGrounded` applied to `output.issues` after the LLM call in `checkHallucUngrounded`). **L40 fix VALIDATED via retroactive simulation against the L39-val novel — the prior bail cluster (LLM-only-blocker on `System`) would have been rescued.** The current L40-val novel did not stochastically trigger the same `System` case (writer prose was different) but bailed on a NEW cluster: writer hallucinated unsanctioned named entities at beat 4.

**Stop condition: (b) — NEW out-of-scope cluster found.**

## L40 mechanistic + retroactive validation

### Mechanistic — at the exact L39-val bail point

L39-val novel (`novel-1777712370271`) bailed at `chapter 1 beat 1 attempt 3` with `llm-only-blocker` flagging `[System]`. Reconstructed that call's grounded surface from `request_json.groundedSources` and ran the L40 grounding check:

```
Candidate: System
groundedSurface.lower has "system":      true   (tier 1)
groundedSurface.normalized has "system": true   (tier 3)
isNerGrounded("System", surface):        TRUE
L40 outcome:                             RESCUE → drop from issues → andGateDecision = pass
```

Bible evidence at that call: `worldBible.systems[]` contained `"The System"`. Outline entities also contained `"System"` and `"The System"`. Both NER's normalize and the per-token shard logic ground the entity. The LLM checker had the same surface in its prompt context but flagged anyway — exactly the disagreement class L40 addresses.

**Without L40:** chapter bailed at beat 1 attempt 3.
**With L40:** call would pass → chapter continues → no bail at this point.

### Retroactive — entire L39-val novel

Re-ran the L40 grounding check across all 43 L39-val halluc-ungrounded calls:

| Metric | Value |
|---|---|
| Total LLM-flagged entities | 7 |
| Would-be rescued by L40 | **3 (43%)** |
| Rescues per decision class | `llm-only-blocker`: 3, others: 0 |

Specifically:
- `ch1 b5 a1 [Guild, System]` (llm-only-blocker) → both rescued (Guild in `cultures[]`, System in `systems[]`)
- `ch1 b1 a3 [System]` (llm-only-blocker) → rescued (the actual bail point)
- `ch1 b1 a2 [Quartermaster, Third Circle, System Archives, Third Ward]` (ner+llm-blocker) → 0 rescued (genuinely ungrounded; L40 correctly does NOT touch these)

**100% of LLM-only-blocker entities in L39-val would be rescued. 0% of genuine `ner+llm-blocker` entities are touched.** L40 is precise — it only rescues the disagreement class, never overrides the consensus class.

## L40-val novel telemetry

Direct telemetry on the new run (`novel-1777716659610`):

| Metric | Value |
|---|---|
| Total halluc-ungrounded calls | 19 |
| AND-gate decisions | `pass`: 13, `ner-only-warning`: 5, `llm-only-blocker`: 1 |
| `llmRescuedByNer` events | **0 (the rescue path never activated this run)** |

Why no rescue activated: the writer's stochastic prose this run never produced a `(LLM flags grounded entity)` disagreement on `System`. The single `llm-only-blocker` call (beat 3 attempt 3) flagged genuinely-ungrounded names (next section). L40 correctly stayed out of the way.

Backstop confirmation: L40 telemetry payload (`llmRescuedByNer` int field) is being persisted to `llm_calls.ner_prepass_json` as designed.

## NEW finding (L40-val-NEW): Writer-invented unsanctioned named entities

The L40-val novel bailed at chapter 1 plan-assist gate. Beat 3's writer prose enacted beat 4's planner obligations and emitted three new named entities NOT in any grounded surface:

```
Beat 4 obligation:  "Maret deflects Theo's concern with a question about his latest dungeon run"
Writer prose:        "Theo: 'You've been twitchy all week...' Maret: 'The guild's tax reconciliation is due next month.'"
                     ↑ adherence FN: deflection topic differs from obligation

Other writer additions in same beat:
  "Journeyman Veth has been misplacing folios."
  "Senior Scribe Haldor crossed the threshold..."
  "Standards for the *Chronicle of Northern Incursions* were revised yesterday."
                     ↑ three new named entities not in:
                       - worldBible.locations / cultures / systems
                       - characterRoster (only Maret + Theo + Cassel)
                       - outlineEntities (no Journeyman Veth / Haldor / Chronicle...)
                       - allowedNewEntities (planner emitted [] for beat 4)
```

These ARE genuinely ungrounded — `isNerGrounded` returns false for all three. NER also doesn't fire (sentence-initial filter for "Journeyman Veth"/"Senior Scribe Haldor"; italics filter for `*Chronicle of Northern Incursions*`). So decision is correctly `llm-only-blocker`. L40 has nothing to rescue here, which is the right behavior.

**This is a planner-writer interface gap at the `allowedNewEntities` layer.** The writer wanted to set the scene with ambient junior characters and a document title; the planner did not pre-sanction them. Three remediation options:

1. **Writer-side:** instruct the writer to use generic descriptors (`a junior scribe`, `a Northern records ledger`) when introducing ambient entities not in `allowedNewEntities`. Lowest cost, highest controllability.
2. **Planner-side:** planner pre-fills `allowedNewEntities` with a small budget of ambient walk-on capacity (e.g. "may introduce up to 2 minor scribes / staff names per scene"). Higher quality but more tokens to plan.
3. **Lint-fixer-side:** detect new named entities in beat output and replace with generic descriptors before the checker runs. Most invasive — risks breaking valid named entity usage.

Option (1) is cheapest and most aligned with current architecture. Recommended for L42 sprint.

## Cluster verification

| Cluster | Status |
|---|---|
| L17 entity grounding (character_roster + outline_entities) | ✅ HOLDS — no L17 fires |
| L22 FN entity expansion (derived titles + suffix matching) | ✅ HOLDS — no L22 fires |
| L24-(a) NER-only-warning exhaust (L31a) | ✅ HOLDS — 5 NER-only-warnings, all `pass: true` |
| L24-(b) adherence stage-1 stochastic (L31c) | ✅ HOLDS |
| L26/L32 mapper allowedNewEntities dup-FPs (L32) | ✅ HOLDS |
| L39 adherence prose truncation | ✅ HOLDS — no truncation FNs |
| **L40 NER post-filter** | ✅ **VALIDATED** — mechanistic + retroactive evidence; 0 spurious rescues this run |
| **L40-val-NEW writer-invented unsanctioned entities** | ⚠ NEW |

## Telemetry summary

| Metric | Value |
|---|---|
| Total cost | $0.0492 / $4 (1.2%) — preliminary, full novel ran 1 chapter only |
| Total LLM calls | ~140 (chapter 1 only) |
| Halluc-ungrounded calls | 19 |
| AND-gate `pass` rate | 13/19 (68%) |
| AND-gate `ner-only-warning` | 5/19 (26%) |
| AND-gate `llm-only-blocker` | 1/19 (5%) |
| AND-gate `ner+llm-blocker` | 0/19 (0%) |
| L40 rescues activated | 0 (writer didn't trigger the disagreement case this run) |
| Plan-assist gates | 1 (chapter 1, pending) |

## Conclusion + Action

**L40 fix: VALIDATED.** The NER post-filter mechanistically closes the L39-val `System` cluster (proven at the exact bail point + 100% of L39-val LLM-only-blocker entities). The current run did not stochastically trigger the same case but L40 is now a deterministic safety net for the exact disagreement class. Zero spurious rescues; zero touched ner+llm-blocker entities; zero production behavior change for variants v0/v2. L40 ships clean.

**L40-val-NEW writer-invented unsanctioned entities:** open follow-up sprint. Candidate name: **L42**. Charter: instruct the writer to either (a) use generic descriptors for ambient walk-on entities not in `allowedNewEntities`, or (b) get the planner to pre-sanction a small ambient walk-on budget. Acceptance: heretic re-smoke ch1 doesn't bail on writer-invented junior-character / document names that lack planner sanction.

**L41 prose-integrity instability** remains queued. Did not fire this L40-val run (chapter prose passed integrity on attempt 1) but L37-data + L39-val both hit it.

## References

- `docs/decisions.md` §L40, §L40-validation
- `docs/sessions/2026-05-02-L40-validation.md` (session retro)
- Smoke log: LXC `/tmp/smoke-l40val-heretic-1777716659.log`
- L40 source change: commit `d356443`
- L40 docs: commit `f2a8bfa`
- L39-validation result (parent context): `docs/l39-validation-2026-05-02.md`
