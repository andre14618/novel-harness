---
status: active
date: 2026-05-10
---

# L103: Scene-First POC Promotion Hold

## Decision

Hold production-default promotion for the scene-first planning/writing stack.
Do not flip `scenePlanContractV1`, `sceneCallWriterV1`, or
`writerExpansionMode` defaults yet.

The POC evidence supports the direction that story scope belongs at the
scene/chapter planning layer, but the best artifact still overshoots the target
by 1.90x and the density cap was only partially obeyed. The next promotion
work should target planner/state-mapper obligation load and chapter endpoint
packing before any runtime default flip.

## Evidence

Artifacts:

- Original P3 baseline:
  `poc/scene-first-novella/output/poc-scene-first-1778423752`
- Tight-scope P3:
  `poc/scene-first-novella/output/poc-scene-first-tight-1778430600`
- Density-cap P3:
  `poc/scene-first-novella/output/poc-scene-first-density-1778431235`
- Fixed-plan expansion A/B:
  `poc/scene-first-novella/output/poc-density-expab-1778432275-scene-call-no-expansion`
  and
  `poc/scene-first-novella/output/poc-density-expab-1778432275-scene-call-v1`

Metrics:

| Run | Scenes | Load-bearing obligations | Obligations/scene | Words/target | Endpoint scores |
| --- | ---: | ---: | ---: | ---: | --- |
| Original P3 | 18 | 40 | 2.22 | 17817/5300 = 3.36x | 2, 3, 3 |
| Tight-scope P3 | 9 | 27 | 3.00 | 8772/3900 = 2.25x | 3, 3, 3 |
| Density-cap P3 | 9 | 17 | 1.89 | 7426/3900 = 1.90x | 3, 3, 3 |
| Fixed-plan no-expansion | 9 | 17 | 1.89 | 8233/3900 = 2.11x | 3, 3, 3 |
| Fixed-plan scene-call-v1 | 9 | 17 | 1.89 | 8835/3900 = 2.27x | 3, 3, 3 |

Findings:

- Scene count and endpoint/hook fit improved the reader-visible artifact:
  original P3 had 18 scenes, 3.36x overshoot, and chapter-1 endpoint score 2;
  tight-scope P3 held to 9 scenes and all endpoints scored 3.
- The first tight-scope fixture did not isolate obligation density because
  obligations rose to 3.00 per scene.
- The density-cap fixture held the 9-scene shape, reduced load to 1.89
  obligations per scene, and cut another 1,346 words versus tight-scope.
- The density cap did not reach its 9-11 obligation target; the mapper still
  emitted 17 load-bearing obligations, with overload concentrated in chapter 1.
- Fixed-plan expansion A/B found zero `writer-expansion` events in both arms.
  The retry-short-scenes expansion path did not fire, so it is not the direct
  overshoot cause for this plan.
- None of the POC artifacts hit the promotion threshold of <=1.5x target words
  while preserving complete diagnostics and traceability.

## Implications

- Keep scene-first runtime flags default-off.
- Treat the next POC as planner/state-mapper calibration, not writer numeric
  forcing.
- Promotion evidence should require a comparable artifact at <=1.5x words,
  all endpoints scored 3, complete scene IDs/diagnostics, and a demonstrated
  obligation-density cap that the planner/state mapper actually follows.
- If the next loop cannot reduce load below roughly one obligation per scene
  without losing endpoint quality, record a stronger methodology no-go instead
  of widening the writer/checker surface.
