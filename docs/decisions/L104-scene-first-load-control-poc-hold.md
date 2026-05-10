---
status: active
date: 2026-05-10
amended_by: L106
---

# L104: Scene-First Load-Control POC Hold

## Decision

Do not promote the scene-first load-control experiments into production
defaults. Keep `scenePlanContractV1`, `sceneCallWriterV1`, and
`writerExpansionMode` default-off.

The parallel POC batch confirms that obligation load is a real lever, but
obligation reduction alone does not yet satisfy the promotion gate. The next
production-path integration slice should target endpoint-preserving
scene-contract compression before drafting: reduce the amount of story work
each scene contract asks for while holding 9 scenes, complete traceability, and
3/3/3 endpoints.

## Evidence

Baseline:

- Density-cap P3:
  `poc/scene-first-novella/output/poc-scene-first-density-1778431235`

Load-control batch:

- Prompt-only hard cap:
  `poc/scene-first-novella/output/poc-load-prompt-1778436524`
- Deterministic chapter-budget compactor:
  `poc/scene-first-novella/output/poc-load-compact-v2-1778437157`
- State-mapper minimal prompt:
  `poc/scene-first-novella/output/poc-load-mapper-min-v3-1778437234`

Metrics:

| Run | Scenes | Load-bearing obligations | Obligations/scene | Words/target | Endpoint scores |
| --- | ---: | ---: | ---: | ---: | --- |
| Density-cap baseline | 9 | 17 | 1.89 | 7426/3900 = 1.90x | 3, 3, 3 |
| Prompt-only hard cap | 9 | 8 | 0.89 | 6456/3900 = 1.66x | 2, 2, 3 |
| Deterministic compactor | 9 | 10 | 1.11 | 8424/3900 = 2.16x | 3, 3, 3 |
| State-mapper minimal v3 | 9 | 9 | 1.00 | 7360/3900 = 1.89x | 3, 3, 3 |

Additional observations:

- Prompt-only hard cap produced the best length result and cut obligation load
  below one per scene, but endpoint landing regressed in chapters 1 and 2.
- Deterministic compaction successfully removed 12 pre-drafting obligations
  to chapter budgets of 3/3/4, but final prose worsened to 2.16x and choice
  alternatives dropped to 7/9 scenes.
- State-mapper minimal v3 preserved endpoint scores and reached one
  obligation per scene, but word ratio stayed effectively at the density-cap
  baseline.
- Mapper-min v1 failed schema shape; v2 failed chapter-3 scene-contract
  production. The v3 prompt fixed feasibility by requiring exact schema fields
  and one `beatMappings[]` entry per input scene.
- Browser evidence for the rendered review artifacts is under
  `output/playwright/2026-05-10/load-control-*.png`.

## Implications

- Do not promote deterministic post-planning obligation compaction as a
  production strategy. It is useful diagnostic evidence, but it can sever the
  planner's intended story payload from writer-visible contract shape.
- Prompt-only load control is the most promising evidence lead, but only if
  paired with endpoint-preserving contract compression; lower obligations
  without endpoint quality is not promotable.
- State-mapper minimization needs explicit schema/mapping discipline and does
  not by itself solve prose overshoot.
- The next evidence gate remains <=1.5x target words, 3/3/3 endpoints, 9 scene
  contracts, complete scene IDs, complete diagnostics/traces, and no production
  default change before a new decision record.
