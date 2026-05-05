---
status: draft-2026-05-04
---

# Approval Policy Replay Fixtures

These fixtures support Phase 7’s replay pass over frozen proposal artifacts by
comparing policy decisions against historical human outcomes and frozen gold
labels.

The fixture format stores a compact proposal-row payload plus two decision labels:

- `historicalDecision`: what happened in the historical source run.
- `goldDecision`: the target label for replay comparisons.

## File format

Top-level object:

```json
{
  "fixtureId": "basic-policy-replay",
  "formatVersion": "approval-policy-replay-row-v1",
  "rows": [
    ProposalReplayRow
  ]
}
```

Each `ProposalReplayRow` is:

```json
{
  "id": string,
  "novelId": string,
  "kind": "artifact_patch" | "prose_edit" | "canon_update",
  "risk": "mechanical" | "low" | "medium" | "high",
  "status": "approved" | "modified" | "rejected" | "shadowed" | "pending" | "expired",
  "resolvedByKind": "human" | "policy" | "script" | "test" | null,
  "policyDecision": "approve" | "reject" | "queue" | "shadow",
  "policyVersion": string,
  "resolvedAt": string,
  "sourceTable": "proposal_envelopes" | "canon_proposals",
  "downstreamCheckerFired": boolean | null,
  "downstreamEditChurn": number | null,
  "downstreamCanonConflict": boolean | null,
  "historicalDecision": "approve" | "reject" | "other",
  "goldDecision": "approve" | "reject" | "queue"
}
```

Downstream fields are optional in seed fixtures. Omit them or set `null` when
the replay source has not observed post-resolution checker fires, edit churn,
or Canon conflict outcomes yet.

For DB-backed replay, these fields come from
`proposal_resolution_outcomes` (`sql/042_proposal_resolution_outcomes.sql`),
joined by `(source_table, proposal_id)`. Resolution audit rows stay immutable;
downstream systems attach observations later through the outcome table.

`historicalDecision` uses the same semantic mapping used by replay:

- `approved` / `modified` → `approve`
- `rejected` → `reject`
- all other final statuses → `other`

### Candidate-policy frozen-envelope fixture

`approval-policy-frozen-envelope-v1` stores replay cases that pair a frozen
proposal outcome label with a frozen `ReviewProposalEnvelope` snapshot.

Top-level object:

```json
{
  "fixtureId": "frozen-envelope-replay",
  "formatVersion": "approval-policy-frozen-envelope-v1",
  "cases": [
    FrozenPolicyReplayCase
  ]
}
```

Each `FrozenPolicyReplayCase` is:

```json
{
  "id": string,
  "status": "approved" | "modified" | "rejected" | "shadowed" | "pending" | "expired",
  "resolvedByKind": "human" | "policy" | "script" | "test" | null,
  "resolvedAt": string,
  "sourceTable": "proposal_envelopes" | "canon_proposals",
  "downstreamCheckerFired": boolean | null,
  "downstreamEditChurn": number | null,
  "downstreamCanonConflict": boolean | null,
  "envelope": ReviewProposalEnvelope
}
```

For seed fixtures, each envelope is intentionally minimal and keeps only the
fields needed for deterministic `evaluatePolicy` calls:

- `id`, `kind`, `novelId`, `target`, `source`, `status`, `risk`
- `summary`, `rationale`, `evidence`, `createdAt`
- `policyRecommendation`, `precondition`, and a minimal `payload`

`docs/fixtures/approval-policy-replay/frozen-envelope-replay.json` is the
candidate-policy seed fixture for this format.

Replay it with a candidate policy JSON file:

```bash
bun scripts/approval-policy-replay-report.ts \
  --frozen-fixture docs/fixtures/approval-policy-replay/frozen-envelope-replay.json \
  --candidate-policy /tmp/policy.json \
  --format json \
  --check
```

### Generator replay harness

`replayProposalGenerator(cases, policy, generate)` is the pure Phase 7 harness
for frozen-artifact generator replay. Each case provides frozen generator input
and expected envelope ids with historical/gold outcomes; the caller injects the
actual generator function. The harness records:

- matched generated envelopes as normal replay rows
- `missingExpected` envelope ids when a generator fails to reproduce expected output
- `unexpectedGenerated` envelope ids when a generator emits extra proposals
- the same policy and downstream-impact metrics as historical-row replay

This keeps generator replay read-only and deterministic: the harness evaluates
generated envelopes and never applies proposals or reloads mutable artifacts.

CLI-supported generator fixtures use:

```json
{
  "fixtureId": "lint-to-prose-edit-generator-replay",
  "formatVersion": "approval-policy-generator-replay-v1",
  "generator": "artifact-patch-envelope" | "lint-to-prose-edit" | "editorial-beat-coverage",
  "cases": [
    {
      "id": string,
      "input": BuildLintProseEditEnvelopesArgs,
      "expected": [
        FrozenGeneratorExpectedEnvelope
      ]
    }
  ]
}
```

Each `FrozenGeneratorExpectedEnvelope` is:

```json
{
  "envelopeId": string,
  "status": "approved" | "modified" | "rejected" | "shadowed" | "pending" | "expired",
  "resolvedByKind": "human" | "policy" | "script" | "test" | null,
  "resolvedAt": string,
  "sourceTable": "proposal_envelopes" | "canon_proposals",
  "downstreamCheckerFired": boolean | null,
  "downstreamEditChurn": number | null,
  "downstreamCanonConflict": boolean | null
}
```

As with row fixtures, downstream fields may be omitted or set `null` when the
fixture has not observed post-resolution impact yet. The generator fixture does
not store a frozen envelope body in `expected`; it pins the generated
`envelopeId` and replay outcome metadata, then compares those ids against the
envelopes produced from the frozen `input`.

Replay the checked-in deterministic lint fixture with:

```bash
bun scripts/approval-policy-replay-report.ts \
  --generator lint-to-prose-edit \
  --generator-fixture docs/fixtures/approval-policy-replay/lint-to-prose-edit-generator-replay.json \
  --candidate-policy /tmp/policy.json \
  --format json \
  --check
```

Promotion checks support explicit rollout tiers:

```bash
bun scripts/approval-policy-replay-report.ts --fixture docs/fixtures/approval-policy-replay/basic-policy-replay.json --check --tier dev
bun scripts/approval-policy-replay-report.ts --fixture docs/fixtures/approval-policy-replay/basic-policy-replay.json --check --tier assisted
bun scripts/approval-policy-replay-report.ts --fixture docs/fixtures/approval-policy-replay/basic-policy-replay.json --check --tier autonomous
```

`dev` is the local tracer default. `assisted` raises the replay-row floor while
keeping auto precision at 0.95. `autonomous` raises the floor again and requires
0.98 auto precision. All tiers require zero Canon auto-approve by default.

Replay the checked-in artifact patch fixture with:

```bash
bun scripts/approval-policy-replay-report.ts \
  --generator artifact-patch-envelope \
  --generator-fixture docs/fixtures/approval-policy-replay/artifact-patch-generator-replay.json \
  --candidate-policy /tmp/policy.json \
  --format json \
  --check
```

Replay the checked-in frozen beat-coverage fixture with:

```bash
bun scripts/approval-policy-replay-report.ts \
  --generator editorial-beat-coverage \
  --generator-fixture docs/fixtures/approval-policy-replay/editorial-beat-coverage-generator-replay.json \
  --candidate-policy /tmp/policy.json \
  --format json \
  --check
```

## Minimal seed fixture

`docs/fixtures/approval-policy-replay/basic-policy-replay.json` is the minimal
seed used for Phase 7 replay harness bootstrapping. It includes:

- `artifact_patch` with policy `approve` and historical/gold `approve`
- `prose_edit` with policy `reject` and historical/gold `reject`
- `canon_update` with policy `queue` and historical/gold `approve`
- one `canon_update` candidate with policy `approve` that is intentionally bad
  (historical/gold `reject`)

Use this fixture as the input seed for replay drivers until a larger fixture
suite replaces it.

`docs/fixtures/approval-policy-replay/lint-to-prose-edit-generator-replay.json`
is the first concrete generator replay fixture. It exercises the deterministic
`FILLER_PHRASE`, `REDUNDANT_BODY`, and `SAID_BOOKISM` lint producers and pins
the generated prose-edit envelope ids, so the report catches both policy
regressions and generator-output drift.

`docs/fixtures/approval-policy-replay/editorial-beat-coverage-generator-replay.json`
is the first frozen LLM-output generator replay fixture. It injects a stored
`BeatCoverageLlmOutput` into `editorial-beat-coverage`, so replay runs never
call a live model while still catching envelope-id drift and policy regressions.

`docs/fixtures/approval-policy-replay/artifact-patch-generator-replay.json`
pins a pure `buildArtifactPatchEnvelope` case for an artifact-adjuster-style
character update. It covers artifact patch envelope id/precondition drift
without invoking the live artifact-adjuster transport.
