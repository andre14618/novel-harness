---
status: active
updated: 2026-05-07
role: session-record
lane: upstream-planning-methodology
---

# Method-Pack Planner Cohort

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: add a multi-concept planner-only cohort runner for
  `commercial-fantasy-adventure-v0`.
- Held constant: no drafting, checker policy, UI, proposal flow, or runtime
  default changes.
- Expected benefit: gather higher-sample evidence on whether a story-method
  scaffold improves chapter/scene contract quality before prose generation.
- Downstream projection: if the method scaffold wins upstream, only then test
  whether those plans improve drafting adherence and story quality.
- Evidence gate: paired frozen-concept cohort with disposable/test data only.

## Implementation

- Added six frozen concepts under
  `docs/fixtures/method-packs/commercial-fantasy-adventure-v0/cohort/`.
- Added `scripts/evals/method-pack-planner-cohort.ts`.
- Updated `scripts/evals/method-pack-planner-diagnostic.ts` to support
  realistic two-scene chapter contracts, repeated live runs, direct DeepSeek
  Flash/Pro diagnostic calls, prefix-cache-friendly shared prompt prefixes,
  and bounded timeout/retry.
- Added package script:
  `bun run diagnostics:method-pack-planner-cohort`.

## Flash Cohort

Command:

```bash
bun run diagnostics:method-pack-planner-cohort -- --live \
  --fixture-dir docs/fixtures/method-packs/commercial-fantasy-adventure-v0/cohort \
  --replicates 3 \
  --concurrency 4 \
  --scenes-per-chapter 2 \
  --obligations-per-chapter 2
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T13-51-44-961Z/cohort/`

Result:

- Cells: 18 paired Flash cells.
- Verdict: `HOLD`.
- Mean delta: `+0.013 percentage points`.
- Median delta: `-0.074 percentage points`.
- Method win rate: `44%`.
- Method structural issue rate: `6%` (`1/18` cells).

Dimension notes:

- Method pack preserved template slot fit: `100%`.
- Both arms were near ceiling on contract completeness, obligations,
  overfragmentation, and ID completeness.
- The method arm did not improve the weak areas that matter most:
  character materiality, world relevance, and endpoint landing.
- Control was already strong, so the current deterministic rubric may be too
  saturated for simple method-pack lift detection.

## Pro Sample

Combined Flash+Pro cohort attempts showed DeepSeek V4 Pro with thinking enabled
is too slow for the current bulk diagnostic shape. A single-fixture Pro sample
on `mapmaker-erased-province` timed out twice on the first Pro control call at
the 300s bound.

A narrower Pro smoke on the same fixture also timed out twice at the 300s bound
after reducing the generated contract to one scene and one obligation per
chapter. Flash completed both control and method calls in that smoke and logged
`768` prompt-cache hit tokens on each repeated shared prefix.

Operational conclusion:

- DeepSeek V4 Flash is viable for high-throughput planner cohorts.
- DeepSeek V4 Pro thinking should be treated as sampled adjudication only, or
  given a smaller judge-style prompt/output shape before use.
- Do not use Pro-thinking as the default bulk planner-diagnostic model in this
  two-scene, six-chapter contract shape.

## Cache Evidence

The live run logged DeepSeek prompt-cache hits on repeated shared prefixes,
commonly `768`, `1408`, or `1664` cached prompt tokens depending on fixture and
arm. The cohort prompts intentionally place stable schema/contract text before
arm-specific instructions to preserve prefix-cache eligibility.

## Interpretation

The current method pack is not a promotion win. It enforces structural slot fit
and ID discipline, but it does not yet make plans more character-driven,
world-operational, or endpoint-strong than the no-method control.

Next useful data step:

- revise the planning methodology/rubric to target character pressure,
  operational world constraints, and endpoint landing directly; or
- add an LLM/human comparative judge for plan quality, because the current
  deterministic rubric is near-saturated on schema completeness.
