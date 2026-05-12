---
status: active
date: 2026-05-12
---

# L108 Drafting Quality Telemetry Packet

## Decision

The stable production-path quality packet for drafting evidence is
`test-drafting-isolated --quality-telemetry-packet`.

The packet is default-off and advisory. It enables prose-semantic telemetry,
scene-semantic replay for `endpointLanding`, `sceneDramaturgy`,
`characterMateriality`, and `worldFactPressure`, persists scene-semantic rows,
uses a larger scene-semantic token cap, and keeps scene-semantic readiness import
off unless explicitly requested.

## Rationale

The recent P1/P2/P3 evidence has enough data to close arm-search and word-count
policing loops. Additional diagnostics should not become the product. Future
main-path work should use this packet to observe quality while improving
plotline shape, endpoint pressure, character-driven turns, and chapter
propulsion.

## Implications

- Semantic telemetry remains fail-open and does not block drafting.
- Deterministic prose compaction is not the active lever.
- New one-off runs should use production code and this packet instead of POC
  branches or bespoke judge bundles.
- Promotion still requires compare/cohort evidence over clean sources, not one
  successful arm on one source.
