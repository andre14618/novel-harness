# Endpoint Contract Hygiene Lane

Date: 2026-05-14

## Objective

Repair the Rillgate chapter 4 endpoint-contract duplicate defects through the
main production path, gather narrow redraft evidence, and decide whether this
endpoint hygiene lane is promotable.

## Changes

- `SCENE-ENDPOINT-DUPLICATE` Plan Readiness candidates now target scalar
  `scene_plan:<sceneId>:consequence` edits instead of whole scene replacement.
- `test-drafting-isolated` supports clone-only `--chapter-start` windows for
  narrow production-path redrafts without replaying earlier chapters.
- Rillgate chapter 4 duplicate endpoint repairs were applied through reviewed
  `planning_edit` proposals on source
  `rillgate-ch4-endpoint-hygiene-1778723371`.

## Evidence

- Repaired source readiness:
  `bun run diagnostics:planning-context-readiness -- --novel rillgate-ch4-endpoint-hygiene-1778723371`
  reported `Groups: 0`, `Findings: 0`.
- Weighted checker sidecars were refreshed for:
  `rillgate-endpoint-landing-1778717740-production-path`,
  `rillgate-mainpath-1778714560-baseline`, and
  `rillgate-full-write-headroom-1778693370-baseline`.
- Narrow run:
  `rillgate-ch4-endpoint-hygiene-redraft-1778758843-production-path`.
  Command shape: `test-drafting-isolated --writer-arms production-path
  --chapter-start 4 --chapter-limit 1 --quality-telemetry-packet
  --scene-semantic-max-tokens 12000`.
- Draft result: chapter 4 only, `2810/3100` words, ratio `0.906`.
- Runtime context: writer drafting brief `5/5` events,
  `scene-budget-tight-anchored-v1`; downstream scene-contract coverage `5/5`;
  endpoint guidance `5/5`.
- Checkers: Plan-Assist `0`, checker readiness `0`, blockers `0`,
  warnings `0`, weight-bearing `0`.
- Prose semantic diagnostics: `0/4` lows, no errors.
- Scene semantic diagnostics: `14` tasks, `6` applicability skips, `1` low,
  no errors. The remaining low is `ch4` scene 3 `endpointLanding ENDPOINT-1`:
  the prose implies Kael notices the side-route opportunity, but does not
  execute the consequence by actively searching the ward edge before the reset
  window closes.
- Planning-to-drafting context readiness after the redraft surfaced one
  separate `REFERENCE-CONTEXT-UNRESOLVED` item on chapter 4 scene 5, tied to an
  implicit guild-salvage marker reference.

## Initial Decision

Promote the mechanics, not the quality conclusion.

The scalar consequence readiness target and clone-only chapter window are
useful production-path harness improvements. The specific Rillgate duplicate
endpoint defects are repaired deterministically and no longer appear as
planning-context readiness findings.

At this point, do not treat this as endpoint-quality solved. The narrow redraft
still has one semantic endpoint low, so the next endpoint-quality work should
target action-level consequence fulfillment in scene contracts/prose, not
duplicate field hygiene or generic word-count control.

## Semantic Adjudication Follow-Up

The remaining scene 3 endpoint low was not handled with a deterministic
keyword rule. A small semantic adjudication panel reviewed the exact scene
contract, prior prose endpoint, and prior semantic finding. The completed
Flash/Pro rows agreed the issue was real enough to repair: the source contract
asked Kael to search/probe the ward edge, while the prose only implied the
action through noticing ripples.

Plan Readiness imported this as a scalar
`scene_plan:ch-004-brine-wards-scene-003-kael-tessa-debate-whether-risk:consequence`
item with label `ENDPOINT-ACTION-NOT-EXECUTED`. Reviewed `planning_edit`
changed the consequence to:

> With the reset window closing, Kael begins probing the ward's edge and
> follows the faint draft toward a possible side passage before they commit to
> the cooldown crossing.

Bounded production-path redraft:
`rillgate-ch4-endpoint-action-redraft-1778760152-production-path`.

Evidence: chapter 4 only, `2852/3100` words, ratio `0.92`; Plan-Assist `0`;
checker readiness `0`; prose semantic lows `0/4`; scene semantic lows `0/14`.
The repaired scene 3 endpoint row was `ENDPOINT-3` with final action: Kael
probes the edge, finds a crack with a draft, and identifies another way in.

Interpretation: this supports semantic adjudication plus scalar upstream repair
for ambiguous endpoint lows. It does not support adding brittle deterministic
word-index checks for endpoint fulfillment.
