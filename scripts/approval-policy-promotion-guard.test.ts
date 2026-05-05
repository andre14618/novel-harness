import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  evaluatePromotionGuard,
  isPolicyChangeFile,
  parseArgs,
} from "./approval-policy-promotion-guard"

describe("approval-policy-promotion-guard parseArgs", () => {
  test("parses explicit changed files and report", () => {
    expect(parseArgs([
      "--base",
      "origin/main",
      "--changed-file",
      "src/canon/approval-policy.ts",
      "--changed-files",
      "README.md,src/orchestrator/policy-decide-routes.ts",
      "--report",
      "/tmp/replay.json",
    ])).toEqual({
      base: "origin/main",
      reportPath: "/tmp/replay.json",
      changedFiles: [
        "src/canon/approval-policy.ts",
        "README.md",
        "src/orchestrator/policy-decide-routes.ts",
      ],
    })
  })

  test("rejects unknown args", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("unknown argument")
  })
})

describe("approval-policy-promotion-guard", () => {
  test("identifies approval-policy behavior files", () => {
    expect(isPolicyChangeFile("./src/canon/approval-policy.ts")).toBe(true)
    expect(isPolicyChangeFile("src/orchestrator/policy-decide-routes.ts")).toBe(true)
    expect(isPolicyChangeFile("docs/current-state.md")).toBe(false)
  })

  test("passes when no policy behavior files changed", () => {
    const result = evaluatePromotionGuard({
      changedFiles: ["docs/current-state.md", "scripts/approval-policy-replay-report.ts"],
    })
    expect(result.ok).toBe(true)
    expect(result.policyChanged).toBe(false)
  })

  test("fails when policy behavior changed without a replay report", () => {
    const result = evaluatePromotionGuard({
      changedFiles: ["src/canon/approval-policy.ts"],
    })
    expect(result.ok).toBe(false)
    expect(result.policyChanged).toBe(true)
    expect(result.reasons[0]).toContain("provide --report")
  })

  test("fails when replay report did not pass promotion", () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-guard-"))
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify(replayReport({ pass: false })), "utf8")

    try {
      const result = evaluatePromotionGuard({
        changedFiles: ["src/canon/approval-policy.ts"],
        reportPath,
      })
      expect(result.ok).toBe(false)
      expect(result.reasons[0]).toBe("replay report promotion.pass must be true")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails when generator replay report contains envelope drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-guard-"))
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify({
      ...replayReport({ pass: true }),
      generatorReplay: {
        policyVersion: "candidate-v1",
        caseCount: 1,
        generatedEnvelopeCount: 1,
        matchedEnvelopeCount: 0,
        missingExpected: [{ caseId: "case-1", envelopeId: "env-expected" }],
        unexpectedGenerated: [],
      },
    }), "utf8")

    try {
      const result = evaluatePromotionGuard({
        changedFiles: ["src/canon/approval-policy.ts"],
        reportPath,
      })
      expect(result.ok).toBe(false)
      expect(result.reasons[0]).toBe("generator replay report contains envelope drift")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("passes when generator replay report has no envelope drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-guard-"))
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify({
      ...replayReport({ pass: true }),
      generatorReplay: {
        policyVersion: "candidate-v1",
        caseCount: 1,
        generatedEnvelopeCount: 1,
        matchedEnvelopeCount: 1,
        missingExpected: [],
        unexpectedGenerated: [],
      },
    }), "utf8")

    try {
      const result = evaluatePromotionGuard({
        changedFiles: ["src/orchestrator/proposal-envelope-routes.ts"],
        reportPath,
      })
      expect(result.ok).toBe(true)
      expect(result.changedPolicyFiles).toEqual(["src/orchestrator/proposal-envelope-routes.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("passes when policy behavior changed with a passing replay report", () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-guard-"))
    const reportPath = join(dir, "report.json")
    writeFileSync(reportPath, JSON.stringify(replayReport({ pass: true })), "utf8")

    try {
      const result = evaluatePromotionGuard({
        changedFiles: ["src/orchestrator/policy-decide-routes.ts"],
        reportPath,
      })
      expect(result.ok).toBe(true)
      expect(result.policyChanged).toBe(true)
      expect(result.changedPolicyFiles).toEqual(["src/orchestrator/policy-decide-routes.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function replayReport(opts: { pass: boolean }) {
  return {
    generatedAt: "2026-05-04T00:00:00.000Z",
    totalRows: 1,
    byKind: [
      {
        key: "kind=artifact_patch",
        kind: "artifact_patch",
        total: 1,
        statusCounts: { approved: 1 },
        policyCounts: { approve: 1, queue: 0, reject: 0, shadow: 0 },
        humanApprove: 1,
        humanReject: 0,
        policyApprovePrecision: 1,
        policyRejectPrecision: null,
        autoPrecision: 1,
        agreementRate: 1,
        interventionRate: 0,
        autonomousResolutionRate: 0,
        canonAutoApproveRate: 0,
      },
    ],
    byKindRisk: [],
    overall: {
      key: "overall",
      total: 1,
      statusCounts: { approved: 1 },
      policyCounts: { approve: 1, queue: 0, reject: 0, shadow: 0 },
      humanApprove: 1,
      humanReject: 0,
      policyApprovePrecision: 1,
      policyRejectPrecision: null,
      autoPrecision: 1,
      agreementRate: 1,
      interventionRate: 0,
      autonomousResolutionRate: 0,
      canonAutoApproveRate: 0,
    },
    promotion: {
      pass: opts.pass,
      reasons: opts.pass ? ["promotion thresholds passed"] : ["failed"],
      thresholds: {
        minRows: 1,
        minAutoPrecision: 0.95,
        maxCanonAutoApproveRate: 0,
      },
    },
  }
}
