---
status: active
date: 2026-05-06
---

# L088: Upstream Native Planning Contract

## Decision

Treat downstream calibration, hard caps, and `calibrated:packed` as diagnostic
evidence, not the product direction for shaping novels. The next active lever
is upstream: concept/planning should author a native chapter contract and a
small set of complete story-turn beats before drafting starts.

Ship this only as a default-off experiment until evidence proves it improves
planning shape, downstream obligation mapping, drafting length, and semantic
stability.

## Rationale

Hard caps delete context. Deterministic packing preserves obligations better,
but it still starts from an unrealistic source artifact and repairs it after
the fact. That is useful for measuring failure classes, but it is the wrong
production shape for a novel harness.

The system should instead ask the planner to create realistic chapter units:
one chapter purpose that names protagonist pressure, irreversible change, and
endpoint/hook, followed by a small number of native story-turn beats that can
each draft into roughly 300-450 words. The state mapper then attaches
obligations to those native beats rather than to micro-actions or packed lists.

## Initial Implementation

`pipelineOverrides.nativePlanningContractV1=true` enables the first experiment:

- `planning-plotter` context asks chapter purposes to state the upstream
  contract, not a hidden beat list.
- `planning-beats` context asks for exact recommended story-turn beats and
  warns against micro-actions, transit-only beats, and packed bullet lists.
- Planning enforcement retries over-fragmented chapters and rejects them if
  they still exceed the native budget. It does not slice or pack.
- `scripts/test-planner-isolated.ts --native-planning-contract` can run
  concept -> planning and report beat counts before drafting.

## Evidence Gate

First compare legacy vs native-contract planning from concept/planning:

- beat count by chapter vs target words;
- purpose quality: protagonist pressure, irreversible change, endpoint/hook;
- obligation coverage after state mapping;
- planning LLM call failures/truncation/headroom;
- downstream drafting word ratio and semantic-gate signals on selected samples.

Promotion requires a cohort showing better native plan shape without worse
semantic stability. A passing planner-only smoke is not enough to make this a
default.

## 2026-05-06 Smoke

Command:

```bash
bun scripts/test-planner-isolated.ts phase-parity-smoke --native-planning-contract
```

Result:

- Novel: `test-planner-phase-parity-smoke-1778112963497`
- Scope: concept -> planning only, 1 chapter, `nativePlanningContractV1=true`
- Output shape: chapter 1 target `1500w`, native beat count `5`
- Planning calls: `planning-plotter`, `planning-beats`, and
  `planning-state-mapper` all finished without truncation.
- Minimum token headroom: `70%` on the state mapper.

Interpretation: the flag can produce a plausible native 5-beat chapter shape
from concept/planning on the smallest fixture. This is only a smoke pass; the
next evidence step is a legacy-vs-native comparison on at least one 3-chapter
seed, then downstream drafting/semantic-gate comparison if planning shape holds.

## Non-Goals

- Do not promote `calibrated:packed`.
- Do not use hard caps as runtime defaults.
- Do not add a global promise ledger, scene-turn blocker, or prose-quality
  heuristic as part of this slice.
- Do not change manual review/autonomy posture.
