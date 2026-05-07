---
status: active
eval: method-pack-planner-semantic-judge-v0
updated: 2026-05-07
---

# Method-Pack Planner Semantic Judge Prompt V0

**Judge model:** DeepSeek V4 Flash by default. DeepSeek V4 Pro may be sampled
only after narrowing the prompt/output shape enough to avoid timeout.
**Format:** blind pairwise with AB/BA swap control. Every cell is judged twice:
`control/method` and `method/control`. Unblinding happens only during
aggregation.
**Rubric:** which upstream plan is more likely to produce a stronger commercial
fantasy/adventure novel if drafted by the same downstream writer/checker stack.

## Purpose

This is a semantic layer on top of deterministic planner diagnostics. It does
not replace structural gates for IDs, scene contracts, or schema validity.

Use it when deterministic checks are saturated and the real question is whether
one plan gives the writer richer story material.

## Blinding

The judge sees only `Plan A` and `Plan B`.

The packet strips:

- `armId`, `label`, `methodPackEnabled`, `methodPackId`, `templateId`;
- raw `structureSlotId` values such as `CFA-01` and `BASE-01`;
- file paths and method/control labels.

The judge sees the same frozen concept once, then both plans in the same
rendered format. Aggregation maps A/B back to method/control after both judge
responses are locked.

## Bias Control

One A/B judgment is not promotion evidence. Each pair must run as:

- `control-vs-method`: Plan A is control, Plan B is method.
- `method-vs-control`: Plan A is method, Plan B is control.

A win counts only when the same underlying arm wins both orientations and the
mean score delta clears the configured minimum, currently `2` on the 25-point
scale.

If the judge picks the same screen side both times, the pair is
`position-biased`. If either pass ties or the score delta is too small, the pair
is a weak/tie outcome.

The runner also supports same-plan calibration pairs. A same-plan packet should
return `TIE` with near-equal scores. Calibration failures keep the semantic
judge at `HOLD`.

## System Prompt

```text
You are a blind semantic judge for upstream novel planning contracts.

You compare Plan A and Plan B for likely usefulness in producing a compelling commercial fantasy/adventure novel.
Do not reward schema completeness by itself. Do not reward a plan for using named methodology, templates, IDs, or formal labels.
Prefer the plan that gives a future scene/chapter writer stronger semantic material.
Presentation order is not evidence. If the plans are equivalent or the preference is not clear, choose TIE.

Score each plan 1-5 on:
- characterAgency: characters want specific things, make choices under pressure, and change the plot.
- causalMomentum: chapters/scenes escalate through cause and effect instead of listing events.
- worldAsEngine: world facts/rules create costs, constraints, revelations, or turns, not just decoration.
- endpointForce: chapter endpoints/hooks land as consequences that create forward momentum.
- proseReadiness: the plan is specific, dramatizable, and likely to produce vivid prose without inventing core context.

Use this scale:
1 = generic, inert, or unusable.
2 = some useful material but mostly vague/list-like.
3 = workable but uneven; a writer would need to repair it.
4 = strong; a writer can draft from it with limited repair.
5 = excellent; clear story engine, pressure, turns, and consequences.

Return only JSON:
{
  "winner": "A" | "B" | "TIE",
  "confidence": 0.0-1.0,
  "scores": {
    "A": {"characterAgency": 1-5, "causalMomentum": 1-5, "worldAsEngine": 1-5, "endpointForce": 1-5, "proseReadiness": 1-5, "total": 5-25},
    "B": {"characterAgency": 1-5, "causalMomentum": 1-5, "worldAsEngine": 1-5, "endpointForce": 1-5, "proseReadiness": 1-5, "total": 5-25}
  },
  "rationale": "one concise paragraph",
  "decisiveEvidence": ["quote or paraphrase concrete evidence from the plans"],
  "concerns": {"A": ["specific concern"], "B": ["specific concern"]}
}
```

## Aggregation

Primary promotion signal:

- method wins at least two-thirds of all pairs after AB/BA swap control;
- mean method score delta is at least `+2` on the 25-point scale;
- position-biased pairs stay below `25%`;
- same-plan calibration pass rate is at least two-thirds;
- deterministic structural gates remain clean.

Otherwise the result is `SEMANTIC-HOLD` or `SEMANTIC-NO-PROMOTION`.

## Known Limits

- This still judges plans, not prose.
- It is an LLM judge, not ground truth.
- It should be calibrated against operator side-by-side review before becoming
  a promotion gate.
