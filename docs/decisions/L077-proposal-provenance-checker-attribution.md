---
status: active
date: 2026-05-04
decision: proposal-provenance-checker-attribution
---

# L77 Proposal Provenance And Checker Attribution

## Decision

Treat proposals as first-class change requests, not as direct mutations.

A proposal can be produced by a human-triggered tool, a deterministic producer,
an LLM/checker module, or a scheduler/policy lane. The fictional author is not
the producer. The producer is the Novel Harness subsystem that emits the review
item, usually in response to an operator action or runtime check.

Keep `downstream_checker_fired` unset until a checker run can be explicitly
correlated to a resolved proposal. Do not infer checker fires from nearby
chapter/checker activity without a proposal-id correlation contract.

## Proposal Source Model

Current proposal kinds:

- `artifact_patch`: proposed change to world bible, character, story spine, or
  related planning artifact.
- `prose_edit`: proposed draft-text edit.
- `editorial_flag`: review item saying a draft likely has a problem; usually
  not directly machine-applied.
- `canon_update`: proposed Canon substrate update.

Typical producers:

- Operator-triggered adjusters, such as artifact adjustment UI actions.
- Deterministic checks, such as lint-to-prose-edit.
- LLM/checker modules, such as editorial beat-coverage.
- Planner/Canon extraction or substrate flows.
- Policy/scheduler lanes that decide whether an existing proposal can be
  resolved automatically.

Every persisted proposal should make these facts inspectable: producer,
reason, affected surface, evidence, precondition hash/generation, policy
recommendation, resolution actor, and final audit outcome.

## Why Checker Attribution Is Blocked

`proposal_resolution_outcomes` already stores downstream outcome fields. Route
resolution seams can honestly write immediate observations such as edit churn
or Canon admit/reject conflict signals.

Checker-fire attribution is different. Runtime checkers currently know their
normal execution context, such as novel id, chapter, beat, checker name, and
result. They do not know which proposal, if any, caused the checked state.

Therefore a row like `downstream_checker_fired=true` would be misleading
unless the checker was run against a surface known to have resulted from a
specific proposal.

## Recommended Follow-Up Design

Add a narrow proposal-impact correlation layer before writing checker-fire
outcomes.

Implemented for `prose_edit`:

- On approve, record an impact context: proposal id, source table, proposal
  kind, novel id, chapter ref, prior draft hash, resulting draft hash, and
  resolved timestamp.
- When lint, validation, or editorial checkers run on that resulting draft hash,
  attach their pass/fail result to the impact context.
- Only then update or derive `proposal_resolution_outcomes.downstream_checker_fired`.

Current implementation records approved `prose_edit` draft impacts in
`proposal_resolution_impacts` and writes validation-phase observations to
`proposal_checker_observations` when the approved draft hash exactly matches an
impact. The rollup updates `proposal_resolution_outcomes.downstream_checker_fired`.
Lint/editorial checker observation calls can use the same helper once they run
against post-proposal draft hashes.

Then extend to `artifact_patch`:

- Record artifact kind/id, prior hash, resulting hash, and resolved timestamp.
- Correlate only checker runs that inspect that exact artifact state or an
  explicitly declared dependent surface.

Current implementation records applied `artifact_patch` impacts with stable
target refs (`character:<id>`, `world_bible`, or `story_spine`) plus prior and
result hashes. No artifact checker observation is written yet because no
artifact-aware checker currently runs against those exact artifact hashes.

Defer Canon correlation until Canon-specific observers exist:

- Canon updates often affect future planning/context reads indirectly.
- Correlation needs a Canon snapshot/generation-aware observer before it is
  honest to claim a downstream checker fire was caused by a Canon proposal.

## Operational Rule

Manual review remains the default. Mechanical deterministic proposals may be
eligible for assisted autonomy, but expansion beyond that should wait for
replay evidence that includes explicit downstream outcome attribution.

Local guard remains sufficient for now:

```bash
bun run policy:promotion-guard -- --report <report.json>
```

External CI is on hold indefinitely per L78 unless the user reopens a concrete
CI need. Do not add a CI surface speculatively.
