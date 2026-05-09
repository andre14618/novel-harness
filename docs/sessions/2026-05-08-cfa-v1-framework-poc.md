---
status: active
updated: 2026-05-08
role: session-record
lane: upstream-planning-methodology
---

# CFA V1 Framework POC Slice

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: add diagnostic-only `commercial-fantasy-adventure-v1`
  framework shape and extend the planner diagnostic scorer with v1-only
  dimensions.
- Held constant: production planner, writer, checker policy, UI, proposal
  flow, model policy, auth, and runtime defaults.
- Expected benefit: test whether an upstream craft stack improves scene-ready
  plans before changing prose generation.
- Downstream projection: if v1 produces better scene contracts and Plan
  Readiness outcomes, the next step is a small framework-to-prose POC using the
  same writer/checker settings.
- Evidence gate: local deterministic scorer tests first, then live planner
  diagnostics, then readiness/operator review, then prose comparison.

## Implemented

- Added `docs/method-packs/commercial-fantasy-adventure-v1.md`.
- Added first frozen v1 concept fixture:
  `docs/fixtures/method-packs/commercial-fantasy-adventure-v1/frozen-concept.json`.
- Extended `scripts/evals/method-pack-planner-diagnostic.ts` additively:
  - v0 fixtures keep existing dimensions and get `n/a` for v1-only checks;
  - v1 fixtures add strategy packet and story debt inputs;
  - scene contracts can now carry Story Grid fields:
    `opposition`, `turningPoint`, `crisisChoice`, `climaxAction`,
    `resolution`, `valueIn`, and `valueOut`;
  - source refs now accept `story_debt`;
  - live method arm IDs use the fixture's `methodPackId` instead of hardcoded
    v0.
- Added deterministic v1 scorer tests.

## V1 Diagnostic Dimensions

- `strategyConservation`: verifies the generated plan visibly conserves the
  Snowflake-lite strategy packet.
- `storyGridSceneContract`: verifies scene contract fields cover a complete
  scene unit and value shift.
- `characterArcPressure`: verifies chapter contracts pressure protagonist
  want/need and lie/truth through material character refs.
- `storyDebtTraceability`: verifies story-debt IDs route through obligations
  and scene required sources.

## Verification

Commands run:

```bash
bun test scripts/evals/method-pack-planner-diagnostic.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
bun run test:fast
bun run docs:weight
bun -e 'import { loadFixture } from "./scripts/evals/method-pack-planner-diagnostic"; const f = loadFixture("docs/fixtures/method-packs/commercial-fantasy-adventure-v1/frozen-concept.json"); console.log(f.methodPackId, f.concept.strategyPacket?.strategyPacketId, f.concept.storyDebts.length)'
```

Result:

- focused diagnostic tests passed: 4 tests;
- TypeScript passed;
- fast tier passed: 527 pass, 3 skip, 0 fail;
- docs weight passed;
- v1 fixture loaded with method pack `commercial-fantasy-adventure-v1`,
  strategy packet `strategy-mapmaker-erased-province-v1`, and two story debts.

## First Live Diagnostic

Command:

```bash
bun run diagnostics:method-pack-planner -- --live \
  --fixture docs/fixtures/method-packs/commercial-fantasy-adventure-v1/frozen-concept.json \
  --scenes-per-chapter 2 \
  --obligations-per-chapter 2 \
  --output output/method-pack-diagnostics/2026-05-08-cfa-v1-mapmaker-live/planner-diagnostic.json
```

Artifacts:

- Raw live report:
  `output/method-pack-diagnostics/2026-05-08-cfa-v1-mapmaker-live/planner-diagnostic.json`
- Rescored report after diagnostic calibration:
  `output/method-pack-diagnostics/2026-05-08-cfa-v1-mapmaker-live/planner-diagnostic-rescored.json`

Initial raw result surfaced scorer false negatives:

- one-word or two-word `valueIn`/`valueOut` labels such as `hope` were treated
  as missing by the generic three-token meaningfulness rule;
- world operations such as `true-ink burns` and `road shifts` were missed by
  the narrow action-pressure term list.

The scorer was adjusted before interpretation. Rescored live result:

| Dimension | Control | CFA v1 | Note |
| --- | ---: | ---: | --- |
| Total | 98% | 98% | `HOLD`, +0.1 points only |
| Template slot fit | n/a | 100% | v1 preserved macro slots |
| Character materiality | 50% | 83% | directional improvement |
| World relevance | 50% | 50% | no lift |
| Strategy conservation | 100% | 100% | saturated |
| Story Grid scene contract | 100% | 98% | near-saturated |
| Character arc pressure | 67% | 67% | no lift |
| Story debt traceability | 100% | 100% | saturated |
| Endpoint landing | 50% | 50% | no lift |

Interpretation:

- CFA v1 improved the most important live weak point from prior runs:
  character materiality.
- It did not yet improve endpoint landing, operational world pressure, or
  want/need/lie/truth arc pressure.
- Several dimensions now saturate, so the next data loop should use richer
  review/readiness findings rather than treating the aggregate deterministic
  score as the promotion signal.

## Next Step

Semantic/readiness diagnostic command:

```bash
bun run diagnostics:planner-discernment-real-data -- \
  --cell output/method-pack-diagnostics/2026-05-08-cfa-v1-mapmaker-live/planner-diagnostic-rescored.json \
  --live \
  --model deepseek-v4-flash \
  --no-thinking \
  --mode evidence-first \
  --dimension characterMateriality \
  --dimension worldFactPressure \
  --dimension endpointLanding \
  --output-dir output/method-pack-diagnostics/2026-05-08-cfa-v1-mapmaker-live/discernment
```

Result:

- `characterMateriality`: control `2.00`, v1 `2.00`.
- `worldFactPressure`: control `2.00`, v1 `2.00`.
- `endpointLanding`: control `2.17`, v1 `2.33`.
- Applicability skips worked: relationship/world-style checks did not run on
  scenes where the required refs were absent.

Interpretation:

- Evidence-first semantic labels did not prove a meaningful v1 improvement.
- The endpoint signal is directionally positive but too small and saturated.
- The current single-concept run is useful smoke evidence only. Next either run
  3-6 concepts for sample size or sharpen sensors before prose POC; do not
  promote runtime behavior from this result.
