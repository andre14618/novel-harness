import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "./connection"
import { dbReachable } from "./test-helpers"
import { listPolicyReplayRows } from "./approval-policy-replay"
import {
  deleteProposalResolutionOutcomesForNovel,
  recordProposalResolutionOutcome,
} from "./proposal-resolution-outcomes"

const reachable = await dbReachable()
const novelId = `test-policy-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function clean(): Promise<void> {
  await deleteProposalResolutionOutcomesForNovel(novelId)
  await db`DELETE FROM proposal_envelopes WHERE novel_id = ${novelId}`
  await db`DELETE FROM canon_proposals WHERE novel_id = ${novelId}`
}

async function insertProposalEnvelope(args: {
  id: string
  kind: "artifact_patch" | "prose_edit" | "editorial_flag"
  risk: "mechanical" | "low" | "medium" | "high"
  status: "approved" | "rejected" | "modified" | "shadowed"
  policyDecision: "approve" | "queue" | "reject" | "shadow"
  resolvedAt: string
}): Promise<void> {
  await db`
    INSERT INTO proposal_envelopes (
      id, novel_id, kind,
      target_kind, target_ref, target_current_version,
      source_agent,
      status, risk, summary, rationale, evidence, payload,
      precondition_kind, precondition_hash,
      policy_decision, policy_reasons,
      resolved_at, resolved_by_kind,
      resolution_policy_decision, resolution_policy_version, resolution_policy_reasons,
      created_at
    ) VALUES (
      ${args.id}, ${novelId}, ${args.kind},
      'character', 'char-1', 'v1',
      'test',
      ${args.status}, ${args.risk}, 'summary', 'rationale', ${"[]"}::jsonb, ${"{}"}::jsonb,
      'artifact_hash', ${"x".repeat(64)},
      'queue', ${"[]"}::jsonb,
      ${args.resolvedAt}::timestamptz, 'human',
      ${args.policyDecision}, 'test-policy-v1', ${"[]"}::jsonb,
      ${args.resolvedAt}::timestamptz
    )
  `
}

async function insertCanonProposal(args: {
  id: string
  status: "approved" | "rejected" | "modified"
  policyDecision: "approve" | "queue" | "reject" | "shadow"
  resolvedAt: string
}): Promise<void> {
  await db`
    INSERT INTO canon_proposals (
      id, novel_id, source, target_logical_id, proposed_payload,
      status, resolved_at, resolved_by_kind,
      resolution_policy_decision, resolution_policy_version, resolution_policy_reasons,
      created_at
    ) VALUES (
      ${args.id}, ${novelId}, 'planner-output', null, ${JSON.stringify({
        id: "fact-1",
        kind: "established_fact",
        text: "test fact",
        provenance: {
          source: "planner-output",
          chapter: 1,
          extractorVersion: "test",
          approvalStatus: "proposed",
          origin: "derived",
          createdAt: args.resolvedAt,
          updatedAt: args.resolvedAt,
        },
      })}::jsonb,
      ${args.status}, ${args.resolvedAt}::timestamptz, 'human',
      ${args.policyDecision}, 'test-policy-v1', ${"[]"}::jsonb,
      ${args.resolvedAt}::timestamptz
    )
  `
}

describe.skipIf(!reachable)("listPolicyReplayRows", () => {
  beforeEach(clean)
  afterEach(clean)

  test("loads resolved audit rows from proposal_envelopes and canon_proposals", async () => {
    await insertProposalEnvelope({
      id: "env-artifact",
      kind: "artifact_patch",
      risk: "low",
      status: "approved",
      policyDecision: "approve",
      resolvedAt: "2026-05-04T12:00:00.000Z",
    })
    await insertCanonProposal({
      id: "canon-proposal",
      status: "approved",
      policyDecision: "queue",
      resolvedAt: "2026-05-04T12:01:00.000Z",
    })
    await db`
      INSERT INTO proposal_envelopes (
        id, novel_id, kind,
        target_kind, target_ref, target_current_version,
        source_agent,
        status, risk, summary, rationale, evidence, payload,
        precondition_kind, precondition_hash,
        policy_decision, policy_reasons,
        created_at
      ) VALUES (
        'pending-env', ${novelId}, 'artifact_patch',
        'character', 'char-1', 'v1',
        'test',
        'pending', 'low', 'summary', 'rationale', ${"[]"}::jsonb, ${"{}"}::jsonb,
        'artifact_hash', ${"x".repeat(64)},
        'queue', ${"[]"}::jsonb,
        '2026-05-04T12:02:00.000Z'::timestamptz
      )
    `

    const rows = await listPolicyReplayRows({ novelId })

    expect(rows.map((r) => r.id)).toEqual(["canon-proposal", "env-artifact"])
    expect(rows[0]).toMatchObject({
      kind: "canon_update",
      risk: "high",
      sourceTable: "canon_proposals",
      policyDecision: "queue",
    })
    expect(rows[1]).toMatchObject({
      kind: "artifact_patch",
      risk: "low",
      sourceTable: "proposal_envelopes",
      policyDecision: "approve",
    })
  })

  test("joins downstream outcome observations for replay metrics", async () => {
    await insertProposalEnvelope({
      id: "env-with-outcome",
      kind: "prose_edit",
      risk: "mechanical",
      status: "approved",
      policyDecision: "approve",
      resolvedAt: "2026-05-04T12:00:00.000Z",
    })
    await insertCanonProposal({
      id: "canon-with-outcome",
      status: "rejected",
      policyDecision: "queue",
      resolvedAt: "2026-05-04T12:01:00.000Z",
    })
    await recordProposalResolutionOutcome({
      id: "outcome-env-with-outcome",
      proposalId: "env-with-outcome",
      proposalKind: "prose_edit",
      novelId,
      sourceTable: "proposal_envelopes",
      resolvedAt: "2026-05-04T12:00:00.000Z",
      observedAt: "2026-05-04T12:10:00.000Z",
      downstreamCheckerFired: true,
      downstreamEditChurn: 3,
      downstreamCanonConflict: false,
      metadata: { checker: "chapter-lint" },
    })
    await recordProposalResolutionOutcome({
      id: "outcome-canon-with-outcome",
      proposalId: "canon-with-outcome",
      proposalKind: "canon_update",
      novelId,
      sourceTable: "canon_proposals",
      resolvedAt: "2026-05-04T12:01:00.000Z",
      observedAt: "2026-05-04T12:11:00.000Z",
      downstreamCheckerFired: false,
      downstreamEditChurn: 0,
      downstreamCanonConflict: true,
    })

    const rows = await listPolicyReplayRows({ novelId })

    expect(rows.find((r) => r.id === "env-with-outcome")).toMatchObject({
      downstreamCheckerFired: true,
      downstreamEditChurn: 3,
      downstreamCanonConflict: false,
    })
    expect(rows.find((r) => r.id === "canon-with-outcome")).toMatchObject({
      downstreamCheckerFired: false,
      downstreamEditChurn: 0,
      downstreamCanonConflict: true,
    })
  })

  test("supports since and limit filters", async () => {
    await insertProposalEnvelope({
      id: "old-env",
      kind: "artifact_patch",
      risk: "low",
      status: "approved",
      policyDecision: "approve",
      resolvedAt: "2026-05-04T12:00:00.000Z",
    })
    await insertProposalEnvelope({
      id: "new-env",
      kind: "prose_edit",
      risk: "mechanical",
      status: "rejected",
      policyDecision: "reject",
      resolvedAt: "2026-05-04T13:00:00.000Z",
    })

    const rows = await listPolicyReplayRows({
      novelId,
      since: "2026-05-04T12:30:00.000Z",
      limit: 1,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("new-env")
  })
})
