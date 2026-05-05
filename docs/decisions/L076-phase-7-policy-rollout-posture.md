---
status: active
updated: 2026-05-04
supersedes: full-log-2026-05-04.md#l76--phase-7-policy-decisions-persistence-timing-posture-outcomes-thresholds-2026-05-04
---

# L76 — Phase 7 Policy Rollout Posture

## Decision

Adopt the conservative Phase 7 rollout posture and implement the mechanical
pieces now.

- Persist proposal envelopes at existing review checkpoints instead of applying
  inline.
- Keep runtime default manual.
- Limit assisted autonomy to deterministic mechanical prose edits.
- Allow autonomous approval only in scheduler/eval lanes for low-risk
  `artifact_patch` and `prose_edit`.
- Keep Canon manual by default through `manualKinds: ["canon_update"]`.

## Why

This keeps proposal review cards load-bearing while Phase 7 gathers replay
evidence. The system can measure policy precision, generator drift, and
downstream impact before changing production apply behavior. Canon remains safe
because a broad autonomous-mode toggle cannot approve Canon unless callers
explicitly opt out of `manualKinds`.

## Concrete Shape

- Downstream observations live in `proposal_resolution_outcomes`, keyed by
  `(source_table, proposal_id)`.
- Replay loader joins the outcome table for both `proposal_envelopes` and
  `canon_proposals`.
- Prose-edit resolution records concrete edit-churn observations: approved
  edits write `downstreamEditChurn=1`; rejected edits write `0`; checker and
  Canon fields remain null because that route observes neither signal.
- Deterministic lint can now persist reviewable `prose_edit` proposals after
  draft checks via `seed.pipelineOverrides.lintProseEditProposals=true`.
  Those lint envelopes are marked `risk=mechanical` with a producer
  recommendation of `approve`, so assisted mechanical prose policy can approve
  them while default runtime behavior remains unchanged.
- CLI promotion checks accept `--tier dev|assisted|autonomous`.
- External CI wiring is superseded by L78: keep `policy:promotion-guard` local
  unless the user reopens a concrete CI need.

## Promotion Tiers

- `dev`: `minRows=1`, `minAutoPrecision=0.95`, zero Canon auto-approve.
- `assisted`: `minRows=25`, `minAutoPrecision=0.95`, zero Canon auto-approve.
- `autonomous`: `minRows=100`, `minAutoPrecision=0.98`, zero Canon
  auto-approve.

Explicit threshold flags may override the tier.

## Verification

- Focused replay/outcome tests: 35 pass / 4 DB-skipped.
- Full touched Phase 6/7/drafting suite: 100 pass / 20 DB-skipped.
- TypeScript clean.
