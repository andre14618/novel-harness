---
status: active
date: 2026-05-09
role: decision-record
---

# L094: Production Writer Character Context Default

## Decision

Promote `thread-character-context-v1` from corpus-recreation POC evidence into
the production drafting context path as the default writer-context mode.

Keep a per-novel `seed.pipelineOverrides.writerContextMode="legacy"` escape
hatch and keep the standalone `buildBeatContext()` default legacy-compatible so
byte-parity fixtures and offline callers remain stable unless they opt in.

## Changed Layer

Drafting context assembly only.

This does not change planner defaults, checker gating, autonomy posture, or UI
review behavior.

## Exact Change

Production drafting now passes `writerContextMode` into beat/scene-level writer
context and chapter-level fallback context. The default mode adds
`CHARACTER CONTEXT CAPSULES` with exact `characterId`, optional `beatId`, POV
stake, LTWN fields, drives/fears/avoids/conflict/voice, current state, and
exact source obligation/thread/promise/payoff IDs when available.

`sceneBeatSchema.povPersonalStake` is optional and advisory. It is not a
checker blocker.

## Expected Benefit

The writer sees the local character motive/voice contract next to the scene
obligations instead of only broad character profiles. This should improve scene
expansion, make POV choices more causally grounded, and preserve exact ID
traceability for later diagnostics and proposal review.

## Evidence

Fixed-plan corpus POC evidence compared `thread-context-v1` against
`thread-character-context-v1` with the same plan:

- Chapter 1 improved from 0.70 to 0.94 target-word ratio and removed the floor
  warning.
- Chapter 2 improved from 0.77 to 0.88 target-word ratio and reduced floor
  warnings from two to one near-miss.
- Semantic/prose reviews stayed low-free.
- Sequence audit remained clean: 18 movements, 0 findings.

## Guardrails

- Legacy prompt shape remains available via `writerContextMode="legacy"`.
- Byte-parity tests protect callers that do not opt in.
- Variant clones can set `--writer-context-mode` for disposable A/B runs.
- Future writer-quality changes should remain separate from this context
  upgrade unless they are measured as a distinct lane.
