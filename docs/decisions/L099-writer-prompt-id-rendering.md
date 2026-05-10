---
status: active
date: 2026-05-10
role: decision-record
---

# L099: Writer-Prompt ID Rendering — Principles + Planned Ablation

## Decision

**Traceability IDs are mandatory infrastructure across system state, DB
rows, telemetry, checker findings, proposal targets, traceability views,
eval artifacts, and audit logs.** They are how the harness knows which
scene/beat/obligation produced which prose, which fact was supposed to
land, which promise/payoff moved, what becomes stale after edits, and
which checker finding maps back to which source. This decision does not
remove or relocate any ID from those surfaces.

The narrower question this decision opens is whether **raw machine ID
strings should be rendered into the prose-writer prompt**. The model
typically needs the *meaning* of the dependency, not the literal ID.
Replacing raw IDs with human-readable dependency text in the prose-
writer prompt is to be evaluated as an A/B ablation (adjusted-B1 in
`docs/research/user-adjusted-backlog-2026-05-10.md`), not promoted on
token savings alone.

This is a principles + planned-ablation decision. **No runtime code
changes ship with this record.**

## Scope

In scope:

- Prose-writer prompt rendering (`character-context.ts` capsule headers,
  per-card bracket annotations, per-card thread/promise/payoff lines).
  These are the four Cluster-1 sites in
  `docs/research/id-rendering-audit-2026-05-10.md`.

Out of scope (IDs **stay visible** to the LLM):

- Mapper / checker / reviewer / repair / artifact-adjuster prompts where
  the model must emit structured output referencing exact IDs.
- Plan-update / proposal-target prompts where the model is editing a
  specific addressable target.
- Disambiguation sites where two similarly named things require exact
  reference (audit found zero such sites today, but the carve-out is
  preserved for future render sites).
- All non-prompt surfaces: trace metadata, DB rows, telemetry,
  proposals, eval artifacts, audit logs, `llm_calls.scene_id`, lineage
  fields.

## Exception classes (verbatim)

Raw IDs stay visible to the LLM when:

1. The LLM must emit structured JSON referencing those exact IDs.
2. The call is a mapper / checker / reviewer, not creative prose.
3. The prompt asks the model to update a plan or proposal target.
4. Two similarly named things require exact disambiguation.

## Planned A/B (adjusted-B1)

- **Arm A**: current writer prompt with raw IDs visible.
- **Arm B**: prose-readable dependency text rendered in place of raw IDs;
  raw IDs preserved in trace metadata, DB, telemetry, and all
  downstream consumers.
- **Surface**: only the four Cluster-1 sites listed in the audit.
- **Fixture**: the mixed set proposed in
  `docs/research/scene-write-fixture-design-2026-05-10.md` (P1 over-
  target primary, plus P2 undershoot, P3 pre-resolved, P4 real-runtime-
  derived). At least one fixture must declare real
  `threadId`/`promiseId`/`payoffId` refs, otherwise Arm A and Arm B are
  trivially identical on those lines and the test is uninformative.
- **Promotion gate**: Arm B promotes only on parity-or-better across
  plan drift, hallucination, obligation coverage, AND prose quality.
  Token savings alone do not promote.
- **Rollback**: a flag the operator can flip to revert to Arm A
  rendering if a regression appears post-ship.

## Cross-references

- Audit: `docs/research/id-rendering-audit-2026-05-10.md` (29 render
  sites surveyed; 4 in Cluster 1).
- Operator-adjusted backlog: `docs/research/user-adjusted-backlog-
  2026-05-10.md` (adjusted-B1 names this ablation; Correction 2 states
  the principle).
- Lineage decisions: L093 (run/thread/payoff refs are additive,
  warning-only), L094 (exact-ID character context capsules, default
  on), L097 (scene-call writer rendering wiring), L098 (scene-
  satisfaction structural wiring).

## Non-goals

- Do not strip IDs from telemetry, DB rows, checker findings, proposals,
  eval artifacts, or audit logs. IDs are non-negotiable infrastructure.
- Do not change ID rendering in mapper / checker / reviewer / planner /
  proposal-update prompts.
- Do not promote Arm B on token-savings alone.
- Do not act on Cluster 5 cosmetic / orphan render sites in the same
  slice. They are removable independently and should be addressed in a
  separate cleanup commit so the A/B's signal is not confounded.

## Status

Active — principle landed; ablation planned. No code changed in this
record. Promotion of Arm B (or rejection) requires a follow-up
decision record citing the A/B evidence.
