---
status: active
updated: 2026-05-10
role: reference
source: docs/current-state.md compaction
---

# Proposal Review And Autonomy Reference

This reference preserves the proposal and Phase 7 details that used to live in
`docs/current-state.md`. Load it when working on proposal envelopes,
ApprovalPolicy, replay/promotion evidence, Canon review, or autonomy posture.

## Operating Posture

- Manual review remains the runtime default.
- Assisted autonomy is limited to deterministic mechanical prose edits with
  local replay/guard evidence.
- Autonomous approval is limited to scheduler/eval lanes for low-risk
  artifact/prose proposals.
- Canon and planning edits remain manual by default through
  `manualKinds: ["canon_update", "planning_edit"]`.
- Canon autonomy requires a new explicit decision.
- External CI for `policy:promotion-guard` is on hold indefinitely; the local
  guard is the supported safety gate unless reopened.

## Proposal Model

A proposal is a durable change request, not the change itself. Producers can be
operator-triggered tools, deterministic checks, LLM/checker modules,
planner/Canon flows, or scheduler/policy lanes. The fictional author is not the
producer; the producer is the Novel Harness subsystem that emitted the review
item.

Current kinds:

- `artifact_patch`: proposed artifact change.
- `prose_edit`: proposed draft-text edit.
- `editorial_flag`: review item for a likely draft issue.
- `canon_update`: proposed Canon substrate update.
- `planning_edit`: proposed planning artifact edit for scalar
  chapter/scene/legacy-beat/obligation/directive/character/world/spine fields,
  plus structural beat and beat-obligation replace/reorder actions.

Every proposal should preserve producer, rationale, evidence, affected surface,
precondition hash/generation, policy recommendation, resolution actor, and audit
outcome. See L077.

## Phase 7 Replay And Promotion

Phase 7 has a read-only replay harness and local promotion guard:

- Pure replay metrics: `src/canon/approval-policy-replay.ts`.
- DB replay loader: `src/db/approval-policy-replay.ts`.
- Downstream outcomes: `sql/042_proposal_resolution_outcomes.sql` and
  `src/db/proposal-resolution-outcomes.ts`.
- Impact/correlation sources:
  `sql/043_proposal_resolution_impacts.sql`,
  `sql/044_proposal_checker_observations.sql`, and
  `src/db/proposal-resolution-outcomes.ts`.
- CLI report: `scripts/approval-policy-replay-report.ts`.
- Local guard: `bun run policy:promotion-guard -- --report <report.json>`.

Replay supports historical row fixtures, frozen-envelope candidate fixtures, and
generator replay for artifact patches, deterministic lint-to-prose-edit, and
frozen-output editorial beat coverage.

Promotion tiers:

- `--tier dev`: local tracer default, `minRows=1`, `minAutoPrecision=0.95`,
  zero Canon auto-approve.
- `--tier assisted`: mechanical assisted rollout, `minRows=25`,
  `minAutoPrecision=0.95`, zero Canon auto-approve.
- `--tier autonomous`: scheduler/eval gate, `minRows=100`,
  `minAutoPrecision=0.98`, zero Canon auto-approve.

## Existing Hooks

- Deterministic lint proposal hook: set
  `seed.pipelineOverrides.lintProseEditProposals=true` to persist fixable lint
  issues as `prose_edit` envelopes after draft save and skip inline lint apply.
- Editorial beat-coverage proposal hook: set
  `seed.pipelineOverrides.editorialBeatCoverageProposals=true` to run the
  validator-backed coverage producer after a chapter draft settles and persist
  uncovered beats as `editorial_flag` envelopes.
- Route-observed outcome writers exist for `prose_edit`, `artifact_patch`, and
  `canon_update` resolutions.
- Prose-edit checker-fire attribution exists for exact draft-hash matches:
  approve writes a draft impact context, and validation checks roll up
  `downstream_checker_fired` only when the checked draft hash matches that
  impact.
- Applied artifact patches record artifact impact contexts with target refs and
  before/after hashes.

## Parked Work

- Artifact checker observations and Canon checker attribution are backlog until
  concrete observer sources exist.
- Do not add new proposal kinds, replay sources, policy tiers, or external CI
  unless the active lane requires them and a decision record justifies the cost.

## Related Decisions

- L074-L078: Phase 6/7 proposal, replay, UI/browser, and CI posture.
- L084: continuity is diagnostic/review evidence, not a drafting gate by
  itself.
- L091: Plan Readiness Review feeds manual `planning_edit` proposals.
- L099: traceability IDs remain mandatory outside the narrow prose-writer raw-ID
  rendering question.
- L100: POC work may defer proposal/UI hardening unless directly tested.
