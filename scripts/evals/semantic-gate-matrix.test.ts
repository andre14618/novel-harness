import { describe, expect, test } from "bun:test"

import type { SemanticGateBaselineReport } from "./semantic-gate-baseline"
import {
  assertDisposableMatrixAllowed,
  buildMatrixReport,
  buildVariantAssessment,
  parseArgs,
  parseVariantSpec,
  riskScoreBreakdownFor,
  runBounded,
  type MatrixVariantResult,
} from "./semantic-gate-matrix"

describe("semantic-gate-matrix parseArgs", () => {
  test("uses a small default matrix", () => {
    const args = parseArgs(["--source", "fixture-novel"])

    expect(args.source).toBe("fixture-novel")
    expect(args.chapters).toBe(2)
    expect(args.parallel).toBe(2)
    expect(args.allowDisposableMatrix).toBe(false)
    expect(args.childTimeoutMinutes).toBe(30)
    expect(args.outputBase).toContain("output/evals/semantic-gate-matrix/fixture-novel-")
    expect(args.variants.map(variant => ({
      id: variant.id,
      label: variant.label,
      maxBeatsPerChapter: variant.maxBeatsPerChapter,
      packStrategy: variant.packStrategy,
    }))).toEqual([
      { id: "beats-4", label: "beats 4", maxBeatsPerChapter: 4, packStrategy: "tail-slice" },
      { id: "beats-5", label: "beats 5", maxBeatsPerChapter: 5, packStrategy: "tail-slice" },
      { id: "beats-6", label: "beats 6", maxBeatsPerChapter: 6, packStrategy: "tail-slice" },
    ])
  })

  test("requires explicit disposable matrix acknowledgement", () => {
    expect(() => assertDisposableMatrixAllowed(parseArgs(["--source", "fixture-novel"])))
      .toThrow(/disposable clone matrix/)
    expect(() => assertDisposableMatrixAllowed(parseArgs(["--allow-disposable-matrix", "--source", "fixture-novel"])))
      .not.toThrow()
    expect(() => assertDisposableMatrixAllowed(parseArgs(["--allow-disposable-eval", "--source", "fixture-novel"])))
      .not.toThrow()
  })

  test("parses labelled variants and source outline control", () => {
    const args = parseArgs([
      "--allow-disposable-matrix",
      "--source=fixture-novel",
      "--chapters", "3",
      "--parallel", "4",
      "--child-timeout-minutes", "14",
      "--variant", "tight:beats=4",
      "--variant", "control:source",
      "--keep-novels",
      "--continuity-editorial-flag-proposals",
    ])

    expect(args.chapters).toBe(3)
    expect(args.parallel).toBe(4)
    expect(args.allowDisposableMatrix).toBe(true)
    expect(args.childTimeoutMinutes).toBe(14)
    expect(args.keepNovels).toBe(true)
    expect(args.continuityEditorialFlagProposals).toBe(true)
    expect(args.variants).toEqual([
      { id: "tight", label: "tight", maxBeatsPerChapter: 4, packStrategy: "tail-slice" },
      { id: "control", label: "control", maxBeatsPerChapter: null, packStrategy: null },
    ])
  })

  test("parses calibrated:packed variant spec", () => {
    const args = parseArgs([
      "--source", "fixture-novel",
      "--variant", "calibrated:packed",
    ])

    expect(args.variants).toEqual([
      { id: "calibrated", label: "calibrated", maxBeatsPerChapter: null, packStrategy: "calibrated-packed" },
    ])
  })

  test("rejects duplicate variant ids", () => {
    expect(() => parseArgs([
      "--source", "fixture-novel",
      "--variant", "beats=4",
      "--variant", "beats=4",
    ])).toThrow("duplicate variant id: beats-4")
  })

  test("rejects unsupported variant specs", () => {
    expect(() => parseVariantSpec("chapters=short")).toThrow("unsupported variant spec")
  })
})

describe("buildVariantAssessment", () => {
  test("classifies a clean completed baseline", () => {
    const assessment = buildVariantAssessment(minimalBaseline(), 2)

    expect(assessment).toMatchObject({
      completed: true,
      approvedChapters: 2,
      requestedChapters: 2,
      terminalStatus: "completed",
      totalWords: 3000,
      draftedTargetWords: 3000,
      wordRatio: 1,
      meanChapterWordRatio: 1,
      pendingPlanAssistGate: false,
      proposalCount: 0,
      actionCount: 4,
      llmCalls: 12,
      failedLlmCalls: 0,
      costUsd: 0.42,
      riskScore: 0,
      reasons: ["completed without semantic-gate signals"],
    })
  })

  test("keeps pending gate evidence as a reportable baseline", () => {
    const baseline = minimalBaseline({
      completed: false,
      approvedChapters: 1,
      totalWords: 2300,
      terminalStatus: "pending-plan-assist",
      latestPlanAssistGate: { pending: true },
      bySignal: {
        checker_blocker: 1,
        no_draft: 1,
        outline_shape: 0,
        plan_adherence_drift: 1,
        plan_assist_gate: 1,
        writer_expansion: 0,
      },
      failedLlmCalls: 1,
    })

    const assessment = buildVariantAssessment(baseline, 2)

    expect(assessment.completed).toBe(false)
    expect(assessment.pendingPlanAssistGate).toBe(true)
    expect(assessment.reasons).toContain("pending plan-assist gate")
    expect(assessment.reasons).toContain("1 plan-drift chapter(s)")
    expect(assessment.reasons).toContain("1 checker-blocker chapter(s)")
    expect(assessment.riskScore).toBeGreaterThan(1600)
  })

  test("marks missing summaries as orchestration failures", () => {
    const assessment = buildVariantAssessment(null, 2)

    expect(assessment).toMatchObject({
      completed: false,
      terminalStatus: "missing-summary",
      riskScore: 1000,
      reasons: ["missing baseline summary"],
    })
  })
})

describe("riskScoreBreakdownFor", () => {
  test("reports the weighted components that form a diagnostic risk score", () => {
    const components = riskScoreBreakdownFor({
      completed: true,
      pendingPlanAssistGate: false,
      signalCounts: {
        plan_adherence_drift: 1,
        writer_expansion: 2,
      },
      wordRatio: 1.345,
      failedLlmCalls: 0,
    })

    expect(components.map(component => ({
      key: component.key,
      value: component.value,
      weight: component.weight,
      points: Number(component.points.toFixed(2)),
    }))).toEqual([
      { key: "plan_adherence_drift", value: 1, weight: 80, points: 80 },
      { key: "writer_expansion", value: 2, weight: 15, points: 30 },
      { key: "word_ratio_delta", value: 0.345, weight: 10, points: 3.45 },
    ])
  })
})

describe("buildMatrixReport", () => {
  test("aggregates totals and ranks lower-risk variants first", () => {
    const clean = variantResult("beats-4", "beats 4", {
      riskScore: 0,
      completed: true,
      wordRatio: 1,
      costUsd: 0.6,
      semanticSignals: {},
      pendingPlanAssistGate: false,
      reasons: ["clean"],
    })
    const drift = variantResult("beats-6", "beats 6", {
      riskScore: 110,
      completed: true,
      wordRatio: 1.9,
      costUsd: 0.9,
      semanticSignals: { plan_adherence_drift: 1 },
      pendingPlanAssistGate: false,
      reasons: ["drift"],
    })
    const missing = variantResult("source", "source outline", {
      status: "failed",
      riskScore: 1000,
      completed: false,
      wordRatio: null,
      costUsd: 0,
      semanticSignals: {},
      pendingPlanAssistGate: false,
      reasons: ["missing baseline summary"],
    })

    const report = buildMatrixReport({
      sourceNovelId: "fixture-novel",
      chapters: 2,
      outputBase: "/tmp/matrix",
      parallel: 2,
      generatedAt: "2026-05-06T00:00:00.000Z",
      variants: [drift, missing, clean],
    })

    expect(report.totals).toEqual({
      variants: 3,
      completed: 2,
      failed: 1,
      cleanPass: 1,
      costUsd: 1.5,
      llmCalls: 0,
    })
    expect(report.ranking.map(item => item.variantId)).toEqual(["beats-4", "beats-6", "source"])
  })
})

describe("runBounded", () => {
  test("preserves result order while limiting in-flight work", async () => {
    let active = 0
    let maxActive = 0

    const results = await runBounded([15, 5, 10, 1], 2, async (delay, index) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, delay))
      active--
      return `${index}:${delay}`
    })

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(results).toEqual(["0:15", "1:5", "2:10", "3:1"])
  })
})

function minimalBaseline(overrides: {
  completed?: boolean
  approvedChapters?: number
  totalWords?: number
  terminalStatus?: string
  latestPlanAssistGate?: { pending: boolean } | null
  bySignal?: Record<string, number>
  failedLlmCalls?: number
} = {}): SemanticGateBaselineReport {
  const bySignal = overrides.bySignal ?? {
    checker_blocker: 0,
    no_draft: 0,
    outline_shape: 0,
    plan_adherence_drift: 0,
    plan_assist_gate: 0,
    writer_expansion: 0,
  }

  return {
    novel: { completed: overrides.completed ?? true },
    terminal: {
      status: overrides.terminalStatus ?? "completed",
      latestPlanAssistGate: overrides.latestPlanAssistGate ?? null,
    },
    drafts: {
      approvedChapters: overrides.approvedChapters ?? 2,
      totalWords: overrides.totalWords ?? 3000,
    },
    proposals: { total: 0 },
    llm: {
      calls: 12,
      failedCalls: overrides.failedLlmCalls ?? 0,
      costUsd: 0.42,
    },
    checker: {
      semanticGate: {
        chapters: [
          { draftWords: 1500, targetWords: 1500, wordRatio: 1 },
          { draftWords: 1500, targetWords: 1500, wordRatio: 1 },
        ],
        totals: { bySignal },
      },
      actionEvidence: { total: 4 },
    },
  } as unknown as SemanticGateBaselineReport
}

function variantResult(
  id: string,
  label: string,
  overrides: Partial<MatrixVariantResult["assessment"]> & { status?: MatrixVariantResult["status"] },
): MatrixVariantResult {
  return {
    variant: { id, label, maxBeatsPerChapter: null, packStrategy: null },
    status: overrides.status ?? "reported",
    exitCode: overrides.status === "failed" ? 1 : 0,
    signal: null,
    outputBase: `/tmp/${id}`,
    targetNovelId: `target-${id}`,
    command: [],
    stdoutPath: `/tmp/${id}/stdout.log`,
    stderrPath: `/tmp/${id}/stderr.log`,
    summaryPath: `/tmp/${id}/summary.json`,
    reportPath: `/tmp/${id}/report.md`,
    error: null,
    baseline: null,
    assessment: {
      completed: false,
      approvedChapters: 0,
      requestedChapters: 2,
      terminalStatus: "completed",
      totalWords: 0,
      draftedTargetWords: 0,
      wordRatio: null,
      meanChapterWordRatio: null,
      semanticSignals: {},
      pendingPlanAssistGate: false,
      proposalCount: 0,
      actionCount: 0,
      llmCalls: 0,
      failedLlmCalls: 0,
      costUsd: 0,
      riskScore: 0,
      riskBreakdown: [],
      reasons: [],
      ...overrides,
    },
  }
}
