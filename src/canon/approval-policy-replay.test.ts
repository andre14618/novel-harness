import { describe, expect, test } from "bun:test"
import {
  actualDecisionForStatus,
  buildPolicyReplayReport,
  replayProposalGenerator,
  replayCandidatePolicy,
  renderPolicyReplayMarkdown,
  type FrozenPolicyReplayCase,
  type PolicyReplayRow,
} from "./approval-policy-replay"
import { buildProseEditEnvelopesFromLintIssues } from "./lint-to-prose-edit"
import type { ProposalEnvelopeKind, ProposalEnvelopeRisk, ReviewProposalEnvelope } from "./proposal-envelope"
import type { LintIssue } from "../lint/types"

const baseRow = {
  novelId: "novel-replay-test",
  risk: "low",
  resolvedByKind: "human",
  policyVersion: "auto-v1",
  resolvedAt: "2026-05-04T12:00:00.000Z",
  sourceTable: "proposal_envelopes",
} satisfies Partial<PolicyReplayRow>

function row(args: Partial<PolicyReplayRow> & Pick<PolicyReplayRow, "id" | "kind" | "status" | "policyDecision">): PolicyReplayRow {
  return {
    ...baseRow,
    ...args,
  } as PolicyReplayRow
}

function envelope(args: {
  id: string
  kind: ProposalEnvelopeKind
  risk: ProposalEnvelopeRisk
  recommendation?: "queue" | "approve" | "reject" | "shadow"
}): ReviewProposalEnvelope {
  return {
    id: args.id,
    kind: args.kind,
    novelId: "novel-replay-test",
    target: { kind: "character", ref: "char-1", currentVersion: "v1" },
    source: { agent: "fixture" },
    status: "pending",
    risk: args.risk,
    summary: "fixture envelope",
    rationale: "fixture",
    evidence: [],
    payload: {},
    precondition: { kind: "artifact_hash", hash: "x".repeat(64) },
    policyRecommendation: {
      decision: args.recommendation ?? "queue",
      reasons: [],
    },
    createdAt: "2026-05-04T12:00:00.000Z",
  } as ReviewProposalEnvelope
}

function replayCase(args: {
  id: string
  kind: ProposalEnvelopeKind
  risk: ProposalEnvelopeRisk
  status: "approved" | "rejected" | "modified"
  sourceTable?: "proposal_envelopes" | "canon_proposals"
  recommendation?: "queue" | "approve" | "reject" | "shadow"
}): FrozenPolicyReplayCase {
  return {
    id: args.id,
    status: args.status,
    resolvedByKind: "human",
    resolvedAt: "2026-05-04T12:00:00.000Z",
    sourceTable: args.sourceTable ?? "proposal_envelopes",
    envelope: envelope({
      id: args.id,
      kind: args.kind,
      risk: args.risk,
      recommendation: args.recommendation,
    }),
  }
}

describe("actualDecisionForStatus", () => {
  test("maps apply-like statuses to approve and rejected to reject", () => {
    expect(actualDecisionForStatus("approved")).toBe("approve")
    expect(actualDecisionForStatus("modified")).toBe("approve")
    expect(actualDecisionForStatus("rejected")).toBe("reject")
    expect(actualDecisionForStatus("pending")).toBe("other")
    expect(actualDecisionForStatus("shadowed")).toBe("other")
  })
})

describe("buildPolicyReplayReport", () => {
  test("keeps metrics separated by kind and risk", () => {
    const report = buildPolicyReplayReport([
      row({ id: "ap-1", kind: "artifact_patch", risk: "low", status: "approved", policyDecision: "approve" }),
      row({ id: "ap-2", kind: "artifact_patch", risk: "medium", status: "approved", policyDecision: "queue" }),
      row({ id: "pe-1", kind: "prose_edit", risk: "mechanical", status: "rejected", policyDecision: "reject" }),
      row({ id: "cn-1", kind: "canon_update", risk: "high", status: "approved", policyDecision: "queue", sourceTable: "canon_proposals" }),
    ], { generatedAt: "2026-05-04T13:00:00.000Z" })

    expect(report.totalRows).toBe(4)
    expect(report.byKind.map((b) => b.key)).toEqual([
      "kind=artifact_patch",
      "kind=canon_update",
      "kind=prose_edit",
    ])
    expect(report.byKindRisk.map((b) => b.key)).toEqual([
      "kind=artifact_patch risk=low",
      "kind=artifact_patch risk=medium",
      "kind=canon_update risk=high",
      "kind=prose_edit risk=mechanical",
    ])
    expect(report.overall.policyCounts).toEqual({
      approve: 1,
      queue: 2,
      reject: 1,
      shadow: 0,
    })
    expect(report.overall.autoPrecision).toBe(1)
    expect(report.overall.interventionRate).toBe(0.5)
    expect(report.overall.approvalRate).toBe(0.75)
    expect(report.overall.downstreamCheckerFireRate).toBe(null)
  })

  test("tracks downstream-impact metrics when rows provide them", () => {
    const report = buildPolicyReplayReport([
      row({
        id: "ap-1",
        kind: "artifact_patch",
        risk: "low",
        status: "approved",
        policyDecision: "approve",
        downstreamCheckerFired: false,
        downstreamEditChurn: 4,
        downstreamCanonConflict: false,
      }),
      row({
        id: "ap-2",
        kind: "artifact_patch",
        risk: "medium",
        status: "modified",
        policyDecision: "queue",
        downstreamCheckerFired: true,
        downstreamEditChurn: 10,
        downstreamCanonConflict: true,
      }),
      row({
        id: "ap-3",
        kind: "artifact_patch",
        risk: "high",
        status: "rejected",
        policyDecision: "queue",
      }),
    ])

    expect(report.overall.approvalRate).toBe(2 / 3)
    expect(report.overall.downstreamCheckerFireRate).toBe(0.5)
    expect(report.overall.averageEditChurn).toBe(7)
    expect(report.overall.canonConflictRate).toBe(0.5)
  })

  test("fails promotion when policy auto-approves canon rows", () => {
    const report = buildPolicyReplayReport([
      row({
        id: "canon-bad",
        kind: "canon_update",
        risk: "high",
        status: "approved",
        policyDecision: "approve",
        sourceTable: "canon_proposals",
      }),
    ])

    expect(report.promotion.pass).toBe(false)
    expect(report.promotion.reasons.join(" ")).toContain("canon auto-approve rate")
  })

  test("fails promotion when auto precision is below threshold", () => {
    const report = buildPolicyReplayReport([
      row({ id: "ap-bad", kind: "artifact_patch", status: "rejected", policyDecision: "approve" }),
    ], {
      thresholds: { minAutoPrecision: 0.9 },
    })

    expect(report.promotion.pass).toBe(false)
    expect(report.overall.autoPrecision).toBe(0)
    expect(report.promotion.reasons.join(" ")).toContain("auto precision below threshold")
  })

  test("undefined threshold fields do not override defaults", () => {
    const report = buildPolicyReplayReport([
      row({
        id: "canon-bad",
        kind: "canon_update",
        risk: "high",
        status: "approved",
        policyDecision: "approve",
        sourceTable: "canon_proposals",
      }),
    ], {
      thresholds: {
        minRows: undefined,
        minAutoPrecision: undefined,
        maxCanonAutoApproveRate: undefined,
      },
    })

    expect(report.promotion.thresholds).toEqual({
      minRows: 1,
      minAutoPrecision: 0.95,
      maxCanonAutoApproveRate: 0,
    })
    expect(report.promotion.pass).toBe(false)
    expect(report.promotion.reasons.join(" ")).toContain("canon auto-approve rate")
  })

  test("empty report fails promotion with insufficient rows", () => {
    const report = buildPolicyReplayReport([])
    expect(report.promotion.pass).toBe(false)
    expect(report.promotion.reasons[0]).toContain("insufficient replay rows")
  })
})

describe("replayCandidatePolicy", () => {
  test("re-evaluates frozen envelopes with the candidate policy", () => {
    const result = replayCandidatePolicy([
      replayCase({ id: "ap-low", kind: "artifact_patch", risk: "low", status: "approved" }),
      replayCase({ id: "pe-mech", kind: "prose_edit", risk: "mechanical", status: "approved" }),
      replayCase({ id: "ap-high", kind: "artifact_patch", risk: "high", status: "rejected" }),
    ], {
      version: "candidate-v1",
      mode: "autonomous",
    }, {
      generatedAt: "2026-05-04T13:00:00.000Z",
    })

    expect(result.policyVersion).toBe("candidate-v1")
    expect(result.rows.map((r) => [r.id, r.policyDecision])).toEqual([
      ["ap-low", "approve"],
      ["pe-mech", "approve"],
      ["ap-high", "queue"],
    ])
    expect(result.report.totalRows).toBe(3)
    expect(result.report.byKind.map((b) => b.key)).toEqual([
      "kind=artifact_patch",
      "kind=prose_edit",
    ])
  })

  test("candidate replay preserves manualKinds safety for canon fixtures", () => {
    const result = replayCandidatePolicy([
      replayCase({
        id: "canon-high",
        kind: "canon_update",
        risk: "high",
        status: "approved",
        sourceTable: "canon_proposals",
      }),
    ], {
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
    })

    expect(result.rows[0].policyDecision).toBe("queue")
    expect(result.report.promotion.pass).toBe(true)
  })

  test("candidate replay catches unsafe canon manualKinds opt-out", () => {
    const result = replayCandidatePolicy([
      replayCase({
        id: "canon-high",
        kind: "canon_update",
        risk: "high",
        status: "approved",
        sourceTable: "canon_proposals",
      }),
    ], {
      version: "candidate-v2",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
      manualKinds: [],
    })

    expect(result.rows[0].policyDecision).toBe("approve")
    expect(result.report.promotion.pass).toBe(false)
    expect(result.report.promotion.reasons.join(" ")).toContain("canon auto-approve")
  })
})

describe("replayProposalGenerator", () => {
  test("runs an injected generator, evaluates matched envelopes, and reports generator drift", async () => {
    const expectedEnvelope = envelope({
      id: "env-expected",
      kind: "artifact_patch",
      risk: "low",
    })
    const unexpectedEnvelope = envelope({
      id: "env-unexpected",
      kind: "prose_edit",
      risk: "mechanical",
    })

    const result = await replayProposalGenerator([
      {
        id: "case-1",
        input: { fixture: "one" },
        expected: [
          {
            envelopeId: "env-expected",
            status: "approved",
            resolvedByKind: "human",
            resolvedAt: "2026-05-04T12:00:00.000Z",
            sourceTable: "proposal_envelopes",
            downstreamCheckerFired: false,
            downstreamEditChurn: 2,
            downstreamCanonConflict: false,
          },
          {
            envelopeId: "env-missing",
            status: "approved",
            resolvedByKind: "human",
            resolvedAt: "2026-05-04T12:01:00.000Z",
            sourceTable: "proposal_envelopes",
          },
        ],
      },
    ], {
      version: "candidate-v1",
      mode: "autonomous",
    }, async () => [expectedEnvelope, unexpectedEnvelope], {
      thresholds: { minRows: 1 },
    })

    expect(result.caseCount).toBe(1)
    expect(result.generatedEnvelopeCount).toBe(2)
    expect(result.matchedEnvelopeCount).toBe(1)
    expect(result.missingExpected).toEqual([
      { caseId: "case-1", envelopeId: "env-missing" },
    ])
    expect(result.unexpectedGenerated).toEqual([
      { caseId: "case-1", envelopeId: "env-unexpected" },
    ])
    expect(result.rows.map((row) => [row.id, row.policyDecision])).toEqual([
      ["case-1:env-expected", "approve"],
    ])
    expect(result.report.overall.downstreamCheckerFireRate).toBe(0)
    expect(result.report.promotion.pass).toBe(true)
  })

  test("can replay the deterministic lint-to-prose-edit generator on frozen prose input", async () => {
    const input = {
      novelId: "novel-replay-test",
      chapterRef: "chapter:1",
      prose: "She paused in order to listen.",
      issues: [
        {
          patternId: 1,
          charOffset: 11,
          category: "FILLER_PHRASE",
          match: "in order to",
          sentence: "She paused in order to listen.",
          fixTemplate: "to",
        } satisfies LintIssue,
      ],
      agent: "lint-fixture",
      now: new Date("2026-05-04T12:00:00.000Z"),
    }
    const generated = buildProseEditEnvelopesFromLintIssues(input)
    expect(generated).toHaveLength(1)

    const result = await replayProposalGenerator([
      {
        id: "lint-case-1",
        input,
        expected: [
          {
            envelopeId: generated[0]!.id,
            status: "approved",
            resolvedByKind: "human",
            resolvedAt: "2026-05-04T12:05:00.000Z",
            sourceTable: "proposal_envelopes",
            downstreamCheckerFired: false,
            downstreamEditChurn: 1,
            downstreamCanonConflict: false,
          },
        ],
      },
    ], {
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
    }, (frozenInput) => buildProseEditEnvelopesFromLintIssues(frozenInput), {
      thresholds: { minRows: 1 },
    })

    expect(result.missingExpected).toEqual([])
    expect(result.unexpectedGenerated).toEqual([])
    expect(result.rows[0]!.kind).toBe("prose_edit")
    expect(result.rows[0]!.policyDecision).toBe("approve")
    expect(result.report.overall.approvalRate).toBe(1)
    expect(result.report.overall.averageEditChurn).toBe(1)
  })
})

describe("renderPolicyReplayMarkdown", () => {
  test("renders promotion status and kind buckets", () => {
    const report = buildPolicyReplayReport([
      row({ id: "ap-1", kind: "artifact_patch", status: "approved", policyDecision: "approve" }),
    ], { generatedAt: "2026-05-04T13:00:00.000Z" })

    const markdown = renderPolicyReplayMarkdown(report)
    expect(markdown).toContain("# ApprovalPolicy Replay Report")
    expect(markdown).toContain("Promotion: PASS")
    expect(markdown).toContain("kind=artifact_patch")
    expect(markdown).toContain("checkerFire=n/a")
  })
})
