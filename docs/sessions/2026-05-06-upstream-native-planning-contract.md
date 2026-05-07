---
status: active
updated: 2026-05-06
role: session-record
---

# Upstream Native Planning Contract

## Change Packet

- Phase/surface: concept/planning, specifically `planning-plotter`,
  `planning-beats`, planning enforcement, and planner-isolated diagnostics.
- Exact change: add default-off `pipelineOverrides.nativePlanningContractV1`.
  The plotter names a chapter contract in purpose text; beat expansion authors
  native story-turn beats; enforcement retries/rejects over-fragmented chapters
  without slicing or packing.
- Expected benefit: test realistic upstream planning shape instead of
  downstream calibration over unrealistic source outlines.
- Downstream projection: persisted `chapter_outlines.scenes` should carry
  fewer, denser native beats; state mapping attaches obligations to those
  native beats; drafting/checkers can then evaluate the new source shape.
- Evidence gate: focused unit tests, typecheck, docs gates, and planner-only
  smoke before any downstream drafting comparison.
- Non-goal: no production default, no hard cap promotion, no `calibrated:packed`
  promotion, no new creative heuristic blocker.

## Implementation

- Added `nativePlanningContractV1` to `SeedInput.pipelineOverrides` and
  `src/config/pipeline.ts`.
- `planning-plotter` context now adds native chapter-contract guidance only
  when the flag is enabled.
- `planning-beats` context now adds native story-turn guidance and retry
  feedback only when the flag/retry path applies.
- Planning enforcement rejects over-fragmented native-contract outlines above
  `recommendedBeats + 1`.
- Planning retries under-planned chapters as before; native-contract runs also
  retry over-fragmented chapters before final enforcement.
- `scripts/test-planner-isolated.ts` accepts `--native-planning-contract` and
  reports per-chapter beat counts.

## Smoke Evidence

Command:

```bash
bun scripts/test-planner-isolated.ts phase-parity-smoke --native-planning-contract
```

Result:

- Novel: `test-planner-phase-parity-smoke-1778112963497`
- Scope: concept -> planning only.
- Chapter 1 target: `1500w`
- Beat count: `5`
- Calls: `planning-plotter`, `planning-beats`, `planning-state-mapper`
- Truncation: `0`
- Minimum headroom: `70%`

The generated chapter purpose named the jammed bell, failing wall, Kade's
dismissal, and Mira's decision to seek Orin. The beat list was five native
story-turn beats rather than a sliced or packed legacy outline.

## Next

Run a paired legacy-vs-native planner-only comparison on a 3-chapter seed
(`fantasy-system-heretic`, `fantasy-echo-mage`, or `fantasy-inscription`) and
compare beat counts, purpose contracts, mapper obligation coverage, and token
headroom. Only move to downstream drafting comparison if the planning shape
looks coherent.
