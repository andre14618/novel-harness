import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { main, parseArgs } from "./approval-policy-replay-report"

describe("approval-policy-replay-report parseArgs", () => {
  test("defaults to markdown report over recent replay rows", () => {
    expect(parseArgs([])).toEqual({
      limit: 500,
      format: "markdown",
      check: false,
      tier: "dev",
      novelId: undefined,
      since: undefined,
      fixture: undefined,
      minRows: undefined,
      minAutoPrecision: undefined,
      maxCanonAutoApproveRate: undefined,
    })
  })

  test("parses filters and promotion thresholds", () => {
    expect(parseArgs([
      "--novel", "novel-1",
      "--since=2026-05-04T00:00:00.000Z",
      "--limit", "25",
      "--format", "json",
      "--check",
      "--min-rows", "10",
      "--min-auto-precision", "0.98",
      "--max-canon-auto-approve-rate", "0",
    ])).toEqual({
      novelId: "novel-1",
      since: "2026-05-04T00:00:00.000Z",
      fixture: undefined,
      limit: 25,
      format: "json",
      check: true,
      tier: "dev",
      minRows: 10,
      minAutoPrecision: 0.98,
      maxCanonAutoApproveRate: 0,
    })
  })

  test("rejects invalid format", () => {
    expect(() => parseArgs(["--format", "yaml"])).toThrow("--format must be json or markdown")
  })

  test("parses fixture path", () => {
    expect(parseArgs(["--fixture", "tmp/fixture.json", "--format", "json"])).toEqual({
      novelId: undefined,
      since: undefined,
      fixture: "tmp/fixture.json",
      limit: 500,
      format: "json",
      check: false,
      tier: "dev",
      minRows: undefined,
      minAutoPrecision: undefined,
      maxCanonAutoApproveRate: undefined,
    })
  })

  test("requires candidate policy and frozen fixture together", () => {
    expect(() => parseArgs(["--candidate-policy", "tmp/candidate-policy.json"])).toThrow(
      "--candidate-policy requires --frozen-fixture or --generator-fixture",
    )
    expect(() => parseArgs(["--frozen-fixture", "tmp/frozen.fixture.json"])).toThrow(
      "--candidate-policy is required with --frozen-fixture or --generator-fixture",
    )
  })

  test("rejects multiple replay fixture modes", () => {
    expect(() => parseArgs([
      "--fixture",
      "tmp/rows.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
      "--frozen-fixture",
      "tmp/frozen.fixture.json",
    ])).toThrow("--fixture, --frozen-fixture, and --generator-fixture are mutually exclusive")
  })

  test("accepts both candidate policy and frozen fixture paths together", () => {
    expect(parseArgs([
      "--candidate-policy",
      "tmp/candidate-policy.json",
      "--frozen-fixture",
      "tmp/frozen.fixture.json",
    ])).toMatchObject({
      candidatePolicy: "tmp/candidate-policy.json",
      frozenFixture: "tmp/frozen.fixture.json",
    })
  })

  test("accepts generator fixture with generator and candidate policy", () => {
    expect(parseArgs([
      "--generator",
      "lint-to-prose-edit",
      "--generator-fixture",
      "tmp/generator.fixture.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toMatchObject({
      generator: "lint-to-prose-edit",
      generatorFixture: "tmp/generator.fixture.json",
      candidatePolicy: "tmp/candidate-policy.json",
    })
  })

  test("accepts editorial beat-coverage generator name", () => {
    expect(parseArgs([
      "--generator",
      "editorial-beat-coverage",
      "--generator-fixture",
      "tmp/editorial.fixture.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toMatchObject({
      generator: "editorial-beat-coverage",
      generatorFixture: "tmp/editorial.fixture.json",
    })
  })

  test("accepts artifact patch envelope generator name", () => {
    expect(parseArgs([
      "--generator",
      "artifact-patch-envelope",
      "--generator-fixture",
      "tmp/artifact.fixture.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toMatchObject({
      generator: "artifact-patch-envelope",
      generatorFixture: "tmp/artifact.fixture.json",
    })
  })

  test("rejects incomplete generator fixture args", () => {
    expect(() => parseArgs([
      "--generator-fixture",
      "tmp/generator.fixture.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toThrow("--generator-fixture requires --generator")
    expect(() => parseArgs([
      "--generator",
      "lint-to-prose-edit",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toThrow("--generator requires --generator-fixture")
    expect(() => parseArgs([
      "--generator",
      "unknown",
      "--generator-fixture",
      "tmp/generator.fixture.json",
      "--candidate-policy",
      "tmp/candidate-policy.json",
    ])).toThrow("--generator must be artifact-patch-envelope, lint-to-prose-edit, or editorial-beat-coverage")
  })

  test("validates numeric threshold flags", () => {
    expect(() => parseArgs(["--min-rows", "abc"])).toThrow("expected number")
    expect(() => parseArgs(["--min-auto-precision", "abc"])).toThrow("expected number")
    expect(() => parseArgs(["--max-canon-auto-approve-rate", "abc"])).toThrow("expected number")
    expect(() => parseArgs(["--limit", "-1"])).toThrow("expected positive number")
  })

  test("parses promotion tier", () => {
    expect(parseArgs(["--tier", "assisted"])).toMatchObject({ tier: "assisted" })
    expect(parseArgs(["--tier=autonomous"])).toMatchObject({ tier: "autonomous" })
    expect(() => parseArgs(["--tier", "unknown"])).toThrow("--tier must be dev, assisted, or autonomous")
  })
})

describe("approval-policy-replay-report main", () => {
  test("builds report from fixture JSON without DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "rows.json")
    const fixtureRows = [
      {
        id: "replay-1",
        novelId: "novel-1",
        kind: "artifact_patch",
        risk: "low",
        status: "approved",
        resolvedByKind: "policy",
        policyDecision: "approve",
        policyVersion: "policy-1",
        resolvedAt: "2026-05-04T00:00:00.000Z",
        sourceTable: "proposal_envelopes",
      },
    ]
    writeFileSync(fixturePath, JSON.stringify(fixtureRows), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main(["--fixture", fixturePath, "--format", "json"])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(1)
    expect(report.overall.total).toBe(1)
    expect(report.promotion.pass).toBe(true)
    expect(report.promotion.thresholds.minRows).toBe(1)
  })

  test("uses assisted promotion tier thresholds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "rows.json")
    writeFileSync(fixturePath, JSON.stringify({
      rows: [
        {
          id: "replay-1",
          novelId: "novel-1",
          kind: "artifact_patch",
          risk: "low",
          status: "approved",
          resolvedByKind: "policy",
          policyDecision: "approve",
          policyVersion: "policy-1",
          resolvedAt: "2026-05-04T00:00:00.000Z",
          sourceTable: "proposal_envelopes",
        },
      ],
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main(["--fixture", fixturePath, "--format", "json", "--check", "--tier", "assisted"])
      expect(status).toBe(1)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.promotion.thresholds).toMatchObject({
      minRows: 25,
      minAutoPrecision: 0.95,
      maxCanonAutoApproveRate: 0,
    })
    expect(report.promotion.reasons).toContain("insufficient replay rows: 1 < 25")
  })

  test("accepts documented { rows: [...] } fixture shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "rows-object.json")
    writeFileSync(fixturePath, JSON.stringify({
      fixtureId: "test-fixture",
      formatVersion: "approval-policy-replay-row-v1",
      rows: [
        {
          id: "replay-1",
          novelId: "novel-1",
          kind: "artifact_patch",
          risk: "low",
          status: "approved",
          resolvedByKind: "policy",
          policyDecision: "approve",
          policyVersion: "policy-1",
          resolvedAt: "2026-05-04T00:00:00.000Z",
          sourceTable: "proposal_envelopes",
        },
      ],
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main(["--fixture", fixturePath, "--format", "json"])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(1)
  })

  test("respects --check with thresholds when using fixture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "rows.json")
    const fixtureRows = [
      {
        id: "replay-1",
        novelId: "novel-1",
        kind: "artifact_patch",
        risk: "low",
        status: "approved",
        resolvedByKind: "policy",
        policyDecision: "approve",
        policyVersion: "policy-1",
        resolvedAt: "2026-05-04T00:00:00.000Z",
        sourceTable: "proposal_envelopes",
      },
    ]
    writeFileSync(fixturePath, JSON.stringify(fixtureRows), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--fixture",
        fixturePath,
        "--format",
        "json",
        "--check",
        "--min-rows",
        "2",
      ])
      expect(status).toBe(1)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.promotion.pass).toBe(false)
    expect(report.promotion.reasons).toContain("insufficient replay rows: 1 < 2")
  })

  test("builds candidate-policy report from frozen fixture JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "frozen.json")
    const policyPath = join(dir, "policy.json")
    writeFileSync(fixturePath, JSON.stringify({
      fixtureId: "candidate-test",
      formatVersion: "approval-policy-frozen-envelope-v1",
      cases: [
        {
          id: "case-artifact-low",
          status: "approved",
          resolvedByKind: "human",
          resolvedAt: "2026-05-04T00:00:00.000Z",
          sourceTable: "proposal_envelopes",
          envelope: frozenEnvelope({
            id: "env-artifact-low",
            kind: "artifact_patch",
            risk: "low",
            policyRecommendation: { decision: "queue", policyVersion: "producer-v1", reasons: [] },
          }),
        },
        {
          id: "case-prose-mechanical",
          status: "approved",
          resolvedByKind: "human",
          resolvedAt: "2026-05-04T00:01:00.000Z",
          sourceTable: "proposal_envelopes",
          envelope: frozenEnvelope({
            id: "env-prose-mechanical",
            kind: "prose_edit",
            risk: "mechanical",
            policyRecommendation: { decision: "queue", policyVersion: "producer-v1", reasons: [] },
          }),
        },
        {
          id: "case-artifact-high",
          status: "rejected",
          resolvedByKind: "human",
          resolvedAt: "2026-05-04T00:02:00.000Z",
          sourceTable: "proposal_envelopes",
          envelope: frozenEnvelope({
            id: "env-artifact-high",
            kind: "artifact_patch",
            risk: "high",
            policyRecommendation: { decision: "queue", policyVersion: "producer-v1", reasons: [] },
          }),
        },
        {
          id: "case-canon-high",
          status: "approved",
          resolvedByKind: "human",
          resolvedAt: "2026-05-04T00:03:00.000Z",
          sourceTable: "canon_proposals",
          envelope: frozenEnvelope({
            id: "env-canon-high",
            kind: "canon_update",
            risk: "high",
            policyRecommendation: { decision: "queue", policyVersion: "producer-v1", reasons: [] },
          }),
        },
      ],
    }), "utf8")
    writeFileSync(policyPath, JSON.stringify({
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "low",
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--frozen-fixture",
        fixturePath,
        "--candidate-policy",
        policyPath,
        "--format",
        "json",
        "--check",
        "--min-rows",
        "4",
      ])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(4)
    expect(report.overall.policyCounts).toEqual({
      approve: 2,
      queue: 2,
      reject: 0,
      shadow: 0,
    })
    expect(report.promotion.pass).toBe(true)
  })

  test("builds generator replay report from lint-to-prose-edit fixture JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "generator.json")
    const policyPath = join(dir, "policy.json")
    writeFileSync(fixturePath, JSON.stringify({
      fixtureId: "generator-test",
      formatVersion: "approval-policy-generator-replay-v1",
      generator: "lint-to-prose-edit",
      cases: [
        {
          id: "lint-case-1",
          input: {
            novelId: "novel-1",
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
              },
            ],
            agent: "lint-fixture",
            now: "2026-05-04T12:00:00.000Z",
          },
          expected: [
            {
              envelopeId: "prose-edit:novel-1:0a22987f95d28f75",
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
      ],
    }), "utf8")
    writeFileSync(policyPath, JSON.stringify({
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--generator",
        "lint-to-prose-edit",
        "--generator-fixture",
        fixturePath,
        "--candidate-policy",
        policyPath,
        "--format",
        "json",
        "--check",
      ])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(1)
    expect(report.overall.policyCounts.approve).toBe(1)
    expect(report.overall.averageEditChurn).toBe(1)
    expect(report.generatorReplay).toMatchObject({
      caseCount: 1,
      generatedEnvelopeCount: 1,
      matchedEnvelopeCount: 1,
      missingExpected: [],
      unexpectedGenerated: [],
    })
  })

  test("builds generator replay report from checked-in editorial beat-coverage fixture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const policyPath = join(dir, "policy.json")
    writeFileSync(policyPath, JSON.stringify({
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--generator",
        "editorial-beat-coverage",
        "--generator-fixture",
        "docs/fixtures/approval-policy-replay/editorial-beat-coverage-generator-replay.json",
        "--candidate-policy",
        policyPath,
        "--format",
        "json",
        "--check",
      ])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(1)
    expect(report.byKind[0].kind).toBe("editorial_flag")
    expect(report.generatorReplay).toMatchObject({
      caseCount: 1,
      generatedEnvelopeCount: 1,
      matchedEnvelopeCount: 1,
      missingExpected: [],
      unexpectedGenerated: [],
    })
  })

  test("builds generator replay report from checked-in artifact patch fixture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const policyPath = join(dir, "policy.json")
    writeFileSync(policyPath, JSON.stringify({
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "low",
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--generator",
        "artifact-patch-envelope",
        "--generator-fixture",
        "docs/fixtures/approval-policy-replay/artifact-patch-generator-replay.json",
        "--candidate-policy",
        policyPath,
        "--format",
        "json",
        "--check",
      ])
      expect(status).toBe(0)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.totalRows).toBe(1)
    expect(report.byKind[0].kind).toBe("artifact_patch")
    expect(report.overall.policyCounts.approve).toBe(1)
    expect(report.generatorReplay).toMatchObject({
      caseCount: 1,
      generatedEnvelopeCount: 1,
      matchedEnvelopeCount: 1,
      missingExpected: [],
      unexpectedGenerated: [],
    })
  })

  test("fails --check when generator replay has missing expected envelopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "approval-policy-replay-"))
    const fixturePath = join(dir, "generator-drift.json")
    const policyPath = join(dir, "policy.json")
    writeFileSync(fixturePath, JSON.stringify({
      fixtureId: "generator-drift-test",
      formatVersion: "approval-policy-generator-replay-v1",
      generator: "lint-to-prose-edit",
      cases: [
        {
          id: "lint-case-1",
          input: {
            novelId: "novel-1",
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
              },
            ],
            agent: "lint-fixture",
            now: "2026-05-04T12:00:00.000Z",
          },
          expected: [
            {
              envelopeId: "prose-edit:novel-1:missing",
              status: "approved",
              resolvedByKind: "human",
              resolvedAt: "2026-05-04T12:05:00.000Z",
              sourceTable: "proposal_envelopes",
            },
          ],
        },
      ],
    }), "utf8")
    writeFileSync(policyPath, JSON.stringify({
      version: "candidate-v1",
      mode: "autonomous",
      autoApproveRiskCeiling: "high",
    }), "utf8")

    const output: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => output.push(args.join(" "))

    try {
      const status = await main([
        "--generator",
        "lint-to-prose-edit",
        "--generator-fixture",
        fixturePath,
        "--candidate-policy",
        policyPath,
        "--format",
        "json",
        "--check",
      ])
      expect(status).toBe(1)
    } finally {
      console.log = originalLog
      rmSync(dir, { recursive: true, force: true })
    }

    const report = JSON.parse(output.join(""))
    expect(report.generatorReplay.missingExpected).toEqual([
      { caseId: "lint-case-1", envelopeId: "prose-edit:novel-1:missing" },
    ])
    expect(report.generatorReplay.unexpectedGenerated).toEqual([
      { caseId: "lint-case-1", envelopeId: "prose-edit:novel-1:0a22987f95d28f75" },
    ])
  })
})

function frozenEnvelope(overrides: {
  id: string
  kind: "artifact_patch" | "prose_edit" | "canon_update"
  risk: "mechanical" | "low" | "medium" | "high"
  policyRecommendation: { decision: "approve" | "queue" | "reject" | "shadow"; policyVersion: string; reasons: string[] }
}) {
  return {
    id: overrides.id,
    kind: overrides.kind,
    novelId: "novel-1",
    target: {
      kind: "character",
      ref: "char-1",
      currentVersion: "v1",
    },
    source: {
      agent: "test",
      userMessage: "fixture",
    },
    status: "pending",
    risk: overrides.risk,
    summary: "Frozen replay case",
    rationale: "Test fixture",
    evidence: [],
    payload: {},
    precondition: {
      kind: "artifact_hash",
      hash: "abc123",
    },
    policyRecommendation: overrides.policyRecommendation,
    createdAt: "2026-05-04T00:00:00.000Z",
  }
}
