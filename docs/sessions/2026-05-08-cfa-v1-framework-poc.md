---
status: active
updated: 2026-05-09
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

## Single-Concept Readiness Diagnostic

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

## Six-Concept Cohort Fixtures

Added a deterministic fixture builder:

```bash
bun run diagnostics:build-cfa-v1-fixtures
```

The builder reads the existing CFA v0 cohort concepts and writes six CFA v1
diagnostic fixtures under:

```text
docs/fixtures/method-packs/commercial-fantasy-adventure-v1/cohort/
```

Each v1 fixture adds an authored Snowflake-lite `strategyPacket`, two
`storyDebts`, and explicit constraints requiring the planner to route strategy
and story-debt IDs into chapter obligations and scene required sources. This is
diagnostic input only; it does not change production planning behavior.

## Six-Concept Planner Cohort

Command:

```bash
bun run diagnostics:method-pack-planner-cohort -- --live \
  --fixture-dir docs/fixtures/method-packs/commercial-fantasy-adventure-v1/cohort \
  --replicates 1 \
  --concurrency 4 \
  --scenes-per-chapter 2 \
  --obligations-per-chapter 2 \
  --output-dir output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/cohort
```

Artifacts:

- `output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/cohort/cohort-report.md`
- `output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/cohort/cohort-report.json`

Result:

| Measure | Result |
| --- | ---: |
| Fixtures | 6 |
| Paired cells | 6 |
| Planner calls | 12 |
| Aggregate verdict | `HOLD` |
| Mean delta | +0.2 points |
| Median delta | -0.2 points |
| Win rate | 50% |
| Method structural issue rate | 0% |

Deterministic dimension movement:

| Dimension | Control | CFA v1 | Direction |
| --- | ---: | ---: | --- |
| Character materiality | 72% | 81% | improved |
| World relevance | 47% | 58% | improved |
| Character arc pressure | 94% | 86% | regressed |
| Story debt traceability | 75% | 94% | improved |
| Endpoint landing | 53% | 44% | regressed |

Per-concept outcomes:

| Concept | Verdict | Delta |
| --- | --- | ---: |
| desert-clockwork-pilgrimage | `NO-PROMOTION` | -0.9 |
| ember-library-heist | `NO-PROMOTION` | -0.5 |
| ironwood-succession | `HOLD` | +0.1 |
| mapmaker-erased-province | `NO-PROMOTION` | -0.4 |
| saltglass-curse | `HOLD` | +1.7 |
| skybridge-rebellion | `HOLD` | +1.2 |

Interpretation:

- CFA v1 improved traceability and made characters/world facts more visible in
  the generated plan contracts.
- It did not yet improve the part that matters before prose: each chapter
  ending must land as a concrete action or consequence that drives the next
  chapter.
- It also softened some arc pressure. Adding strategy/story debt is not enough
  if want/need/lie/truth stop shaping scene choices.
- This is not promotion evidence. Do not draft a prose POC from this arm until
  v1 is revised and rerun.

## Six-Concept Readiness Labels

Command:

```bash
bun run diagnostics:planner-discernment-real-data -- --live \
  --cohort-dir output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/cohort \
  --model deepseek-v4-flash \
  --no-thinking \
  --concurrency 12 \
  --max-tokens 1400 \
  --mode evidence-first \
  --dimension characterMateriality \
  --dimension worldFactPressure \
  --dimension endpointLanding \
  --output-dir output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/discernment
```

Artifacts:

- `output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/discernment/planner-discernment-real-data-report.md`
- `output/method-pack-diagnostics/2026-05-08-cfa-v1-cohort-r1/discernment/planner-discernment-real-data-report.json`

Result:

| Dimension | Control | CFA v1 | Delta |
| --- | ---: | ---: | ---: |
| Character materiality | 2.00 | 2.04 | +0.04 |
| World fact pressure | 1.98 | 1.98 | +0.00 |
| Endpoint landing | 2.17 | 2.28 | +0.11 |

The readiness labels mostly saturated, but the examples are useful:

- weak world pressure means the world rule is referenced without changing the
  available action, outcome, or cost;
- weak endpoint landing means the chapter ends on a stated decision or mood
  instead of a concrete action/consequence that creates propulsion.

## Cohort Decision

Hold CFA v1. The next valuable slice is a method-pack revision that targets:

- endpoint landing as a concrete final action plus consequence;
- world rules as active constraints on scene options or outcomes;
- arc pressure that keeps want/need/lie/truth visible in choices rather than
  treating them as background metadata.

Only after that revised planner arm beats the current six-concept baseline
should the lane move to chapter or short-story prose generation.
