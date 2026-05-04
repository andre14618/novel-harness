/**
 * Phase 6 commit 1 — Approval Policy evaluator tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 6"
 *
 * Pure unit tests — no DB, no network. Pin: each mode (manual / assisted
 * / autonomous / eval) returns the right decision shape; producer reject
 * overrides every approve path; manualKinds (default canon_update) always
 * queues; autoApproveRiskCeiling threshold ordering is correct;
 * policyVersion always surfaces.
 */

import { describe, expect, test } from "bun:test"
import {
  evaluatePolicy,
  type ApprovalPolicy,
  type PolicyDecision,
} from "./approval-policy"
import type {
  ReviewProposalEnvelope,
  ProposalEnvelopeKind,
  ProposalEnvelopeRisk,
} from "./proposal-envelope"

function makeEnvelope(args: {
  kind: ProposalEnvelopeKind
  risk: ProposalEnvelopeRisk
  recommendation?: PolicyDecision
}): ReviewProposalEnvelope {
  return {
    id: "test-env",
    kind: args.kind,
    novelId: "novel-test-1",
    target: { kind: "character", ref: "char-x", currentVersion: "v1" },
    source: { agent: "test" },
    status: "pending",
    risk: args.risk,
    summary: "test envelope",
    rationale: "test",
    evidence: [],
    payload: {},
    precondition: { kind: "artifact_hash", hash: "x".repeat(64) },
    policyRecommendation: {
      decision: args.recommendation ?? "queue",
      reasons: ["producer baseline"],
    },
    createdAt: "2026-05-04T00:00:00.000Z",
  } as ReviewProposalEnvelope
}

const baseManual: ApprovalPolicy = { version: "v1", mode: "manual" }
const baseAssisted: ApprovalPolicy = { version: "v1", mode: "assisted" }
const baseAutonomous: ApprovalPolicy = { version: "v1", mode: "autonomous" }
const baseEval: ApprovalPolicy = { version: "v1", mode: "eval" }

describe("evaluatePolicy — manual mode", () => {
  test("every proposal queues, regardless of risk or kind", () => {
    const cases: Array<[ProposalEnvelopeKind, ProposalEnvelopeRisk]> = [
      ["artifact_patch", "mechanical"],
      ["artifact_patch", "low"],
      ["prose_edit", "mechanical"],
      ["prose_edit", "high"],
      ["editorial_flag", "low"],
    ]
    for (const [kind, risk] of cases) {
      const env = makeEnvelope({ kind, risk })
      const result = evaluatePolicy(env, baseManual)
      expect(result.decision).toBe("queue")
      expect(result.policyVersion).toBe("v1")
      expect(result.reasons.some(r => r.includes("manual"))).toBe(true)
    }
  })
})

describe("evaluatePolicy — assisted mode", () => {
  test("prose_edit at risk=mechanical auto-approves", () => {
    const env = makeEnvelope({ kind: "prose_edit", risk: "mechanical" })
    const result = evaluatePolicy(env, baseAssisted)
    expect(result.decision).toBe("approve")
    expect(result.policyVersion).toBe("v1")
    expect(result.reasons.join(" ")).toContain("prose_edit at risk=mechanical")
  })

  test("prose_edit at risk=low queues (not mechanical)", () => {
    const env = makeEnvelope({ kind: "prose_edit", risk: "low" })
    const result = evaluatePolicy(env, baseAssisted)
    expect(result.decision).toBe("queue")
  })

  test("artifact_patch at risk=mechanical queues (not prose_edit)", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "mechanical" })
    const result = evaluatePolicy(env, baseAssisted)
    expect(result.decision).toBe("queue")
  })

  test("editorial_flag at any risk queues", () => {
    const env = makeEnvelope({ kind: "editorial_flag", risk: "low" })
    const result = evaluatePolicy(env, baseAssisted)
    expect(result.decision).toBe("queue")
  })
})

describe("evaluatePolicy — autonomous mode (default ceiling=low)", () => {
  test("risk=mechanical auto-approves", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "mechanical" })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("approve")
    expect(result.reasons.join(" ")).toContain("ceiling=low")
  })

  test("risk=low auto-approves", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "low" })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("approve")
  })

  test("risk=medium queues (above ceiling)", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "medium" })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("queue")
  })

  test("risk=high queues (above ceiling)", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "high" })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("queue")
  })

  test("explicit ceiling=medium auto-approves up to medium", () => {
    const policy: ApprovalPolicy = {
      version: "v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "medium",
    }
    const env = makeEnvelope({ kind: "artifact_patch", risk: "medium" })
    expect(evaluatePolicy(env, policy).decision).toBe("approve")
    const env2 = makeEnvelope({ kind: "artifact_patch", risk: "high" })
    expect(evaluatePolicy(env2, policy).decision).toBe("queue")
  })

  test("explicit ceiling=mechanical auto-approves only mechanical", () => {
    const policy: ApprovalPolicy = {
      version: "v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "mechanical",
    }
    const env = makeEnvelope({ kind: "artifact_patch", risk: "mechanical" })
    expect(evaluatePolicy(env, policy).decision).toBe("approve")
    const env2 = makeEnvelope({ kind: "artifact_patch", risk: "low" })
    expect(evaluatePolicy(env2, policy).decision).toBe("queue")
  })
})

describe("evaluatePolicy — manualKinds (canon_update default)", () => {
  test("canon_update always queues even at risk=mechanical in autonomous mode", () => {
    const env = makeEnvelope({ kind: "canon_update", risk: "mechanical" })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("queue")
    expect(result.reasons.join(" ")).toContain("manualKinds")
  })

  test("explicit empty manualKinds opts out — canon_update can auto-approve", () => {
    const policy: ApprovalPolicy = {
      version: "v1",
      mode: "autonomous",
      manualKinds: [],
    }
    const env = makeEnvelope({ kind: "canon_update", risk: "mechanical" })
    expect(evaluatePolicy(env, policy).decision).toBe("approve")
  })

  test("custom manualKinds blocks editorial_flag too", () => {
    const policy: ApprovalPolicy = {
      version: "v1",
      mode: "autonomous",
      manualKinds: ["canon_update", "editorial_flag"],
    }
    const env = makeEnvelope({ kind: "editorial_flag", risk: "mechanical" })
    expect(evaluatePolicy(env, policy).decision).toBe("queue")
  })
})

describe("evaluatePolicy — producer reject override", () => {
  test("producer reject overrides autonomous auto-approve", () => {
    const env = makeEnvelope({
      kind: "artifact_patch",
      risk: "mechanical",
      recommendation: "reject",
    })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("reject")
    expect(result.reasons.join(" ")).toContain("producer recommended reject")
  })

  test("producer reject overrides assisted queue", () => {
    const env = makeEnvelope({
      kind: "prose_edit",
      risk: "mechanical",
      recommendation: "reject",
    })
    const result = evaluatePolicy(env, baseAssisted)
    expect(result.decision).toBe("reject")
  })

  test("producer reject in manual mode still rejects (not queue)", () => {
    const env = makeEnvelope({
      kind: "prose_edit",
      risk: "low",
      recommendation: "reject",
    })
    const result = evaluatePolicy(env, baseManual)
    expect(result.decision).toBe("reject")
  })

  test("manualKinds takes precedence over producer reject", () => {
    // canon_update with producer reject — manualKinds is checked first,
    // so the operator sees the proposal rather than a silent reject.
    // This is conservative: rejecting Canon without an operator's eyes
    // would lose information about the producer's reasoning.
    const env = makeEnvelope({
      kind: "canon_update",
      risk: "low",
      recommendation: "reject",
    })
    const result = evaluatePolicy(env, baseAutonomous)
    expect(result.decision).toBe("queue")
  })
})

describe("evaluatePolicy — eval mode", () => {
  test("eval mode never mutates: returns shadow with shadowOf showing the autonomous decision", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "mechanical" })
    const result = evaluatePolicy(env, baseEval)
    expect(result.decision).toBe("shadow")
    expect(result.shadowOf).toBe("approve")
    expect(result.policyVersion).toBe("v1")
    expect(result.reasons.join(" ")).toContain("would-have=approve")
  })

  test("eval mode shadows queue decisions", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "high" })
    const result = evaluatePolicy(env, baseEval)
    expect(result.decision).toBe("shadow")
    expect(result.shadowOf).toBe("queue")
  })

  test("eval mode shadows reject decisions (producer reject still detected)", () => {
    const env = makeEnvelope({
      kind: "prose_edit",
      risk: "low",
      recommendation: "reject",
    })
    const result = evaluatePolicy(env, baseEval)
    expect(result.decision).toBe("shadow")
    expect(result.shadowOf).toBe("reject")
  })

  test("eval mode shadows canon_update queue (manualKinds still applies)", () => {
    const env = makeEnvelope({ kind: "canon_update", risk: "mechanical" })
    const result = evaluatePolicy(env, baseEval)
    expect(result.decision).toBe("shadow")
    expect(result.shadowOf).toBe("queue")
  })
})

describe("evaluatePolicy — policyVersion always surfaces", () => {
  test("each decision carries the policy version verbatim", () => {
    const env = makeEnvelope({ kind: "artifact_patch", risk: "low" })
    for (const policy of [baseManual, baseAssisted, baseAutonomous, baseEval]) {
      const result = evaluatePolicy(env, { ...policy, version: "policy-v42" })
      expect(result.policyVersion).toBe("policy-v42")
    }
  })
})
