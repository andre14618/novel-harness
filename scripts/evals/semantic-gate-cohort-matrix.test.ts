import { describe, expect, test } from "bun:test"

import type { MatrixVariantResult, SemanticGateMatrixReport } from "./semantic-gate-matrix"
import {
  buildCohortReport,
  candidateSourcesFromReportJson,
  cohortChaptersFor,
  parseArgs,
  renderCohortReport,
  type CohortMatrixRun,
} from "./semantic-gate-cohort-matrix"

describe("semantic-gate-cohort-matrix parseArgs", () => {
  test("accepts repeated sources, variants, and replicate controls", () => {
    const args = parseArgs([
      "--source", "novel-a",
      "--source=novel-b",
      "--chapters", "3",
      "--replicates", "2",
      "--parallel-sources", "4",
      "--parallel-variants", "3",
      "--child-timeout-minutes", "16",
      "--variant", "tight:beats=4",
      "--variant", "control:source",
      "--keep-novels",
      "--continuity-editorial-flag-proposals",
      "--output-base", "output/evals/custom-cohort",
    ])

    expect(args.sources).toEqual(["novel-a", "novel-b"])
    expect(args.chapters).toBe(3)
    expect(args.replicates).toBe(2)
    expect(args.parallelSources).toBe(4)
    expect(args.parallelVariants).toBe(3)
    expect(args.childTimeoutMinutes).toBe(16)
    expect(args.keepNovels).toBe(true)
    expect(args.continuityEditorialFlagProposals).toBe(true)
    expect(args.variantSpecs).toEqual(["tight:beats=4", "control:source"])
    expect(args.variants.map(variant => variant.id)).toEqual(["tight", "control"])
  })

  test("accepts existing summary artifacts without live sources", () => {
    const args = parseArgs(["--summary", "output/evals/semantic-gate-matrix/run/summary.json"])

    expect(args.sources).toEqual([])
    expect(args.summaries[0]).toContain("output/evals/semantic-gate-matrix/run/summary.json")
    expect(args.candidateReports).toEqual([])
    expect(args.variantSpecs).toEqual(["beats=4", "beats=5", "beats=6"])
  })

  test("accepts candidate reports as source input", () => {
    const args = parseArgs([
      "--candidate-report", "output/evals/candidates.json",
      "--candidate-limit", "2",
    ])

    expect(args.sources).toEqual([])
    expect(args.summaries).toEqual([])
    expect(args.candidateReports[0]).toContain("output/evals/candidates.json")
    expect(args.candidateLimit).toBe(2)
    expect(args.childTimeoutMinutes).toBe(30)
  })

  test("requires a source, summary, or candidate report", () => {
    expect(() => parseArgs([])).toThrow("at least one --source, --summary, or --candidate-report is required")
  })
})

describe("candidateSourcesFromReportJson", () => {
  test("extracts candidate novel ids with an optional limit", () => {
    const sources = candidateSourcesFromReportJson(JSON.stringify({
      candidates: [
        { novelId: "novel-a" },
        { novelId: "novel-b" },
        { notNovelId: "ignored" },
      ],
    }), 2)

    expect(sources).toEqual(["novel-a", "novel-b"])
  })

  test("rejects malformed candidate reports", () => {
    expect(() => candidateSourcesFromReportJson("{}")).toThrow("candidate report missing candidates array")
  })
})

describe("cohortChaptersFor", () => {
  test("derives chapters from summary-only matrix artifacts", () => {
    const chapters = cohortChaptersFor(
      { sources: [], candidateReports: [], chapters: 2 },
      [matrixRun("novel-a", [variantResult("beats-4", "beats 4", {})], 1)],
    )

    expect(chapters).toBe(1)
  })

  test("keeps the configured chapter count for live cohort runs", () => {
    const chapters = cohortChaptersFor(
      { sources: ["novel-a"], candidateReports: [], chapters: 2 },
      [matrixRun("novel-a", [variantResult("beats-4", "beats 4", {})], 1)],
    )

    expect(chapters).toBe(2)
  })
})

describe("buildCohortReport", () => {
  test("aggregates variant runs across reported matrices", () => {
    const report = buildCohortReport({
      chapters: 2,
      outputBase: "/tmp/cohort",
      variantSpecs: ["beats=4", "beats=5"],
      generatedAt: "2026-05-06T00:00:00.000Z",
      runs: [
        matrixRun("novel-a", [
          variantResult("beats-4", "beats 4", { completed: true, riskScore: 5, wordRatio: 1.1, costUsd: 0.1, reasons: ["clean"] }),
          variantResult("beats-5", "beats 5", { completed: false, status: "reported", riskScore: 500, wordRatio: 1.4, costUsd: 0.2, pendingPlanAssistGate: true, reasons: ["pending plan-assist gate"] }),
        ]),
        matrixRun("novel-b", [
          variantResult("beats-4", "beats 4", {
            completed: true,
            riskScore: 15,
            wordRatio: 1.2,
            costUsd: 0.3,
            reasons: ["1 writer-expansion chapter(s)"],
            semanticSignals: { writer_expansion: 1 },
            riskBreakdown: [{ key: "writer_expansion", label: "writer expansion", value: 1, weight: 15, points: 15 }],
          }),
          variantResult("beats-5", "beats 5", {
            completed: true,
            riskScore: 100,
            wordRatio: 1.8,
            costUsd: 0.4,
            reasons: ["1 plan-drift chapter(s)"],
            semanticSignals: { plan_adherence_drift: 1 },
            riskBreakdown: [{ key: "plan_adherence_drift", label: "plan drift", value: 1, weight: 80, points: 80 }],
          }),
        ]),
      ],
    })

    const beats4 = report.variants.find(variant => variant.variantId === "beats-4")
    expect(beats4).toMatchObject({
      runs: 2,
      reported: 2,
      completed: 2,
      failed: 0,
      cleanPass: 2,
      meanRiskScore: 10,
      meanWordRatio: 1.15,
      totalCostUsd: 0.4,
      totalLlmCalls: 20,
      semanticSignals: { writer_expansion: 1 },
      riskDrivers: { "writer expansion": 15 },
    })
    expect(report.ranking[0].topRiskDrivers).toEqual(["writer expansion (15)"])
    expect(report.totals).toMatchObject({
      matrixRuns: 2,
      reportedMatrices: 2,
      failedMatrices: 0,
      variantRuns: 4,
      completedVariantRuns: 3,
      cleanPass: 2,
      costUsd: 1,
      llmCalls: 40,
    })
    expect(report.ranking[0].variantId).toBe("beats-4")
  })

  test("preserves failed child matrix rows without hiding reported summaries", () => {
    const report = buildCohortReport({
      chapters: 2,
      outputBase: "/tmp/cohort",
      variantSpecs: ["beats=4"],
      generatedAt: "2026-05-06T00:00:00.000Z",
      runs: [
        matrixRun("novel-a", [
          variantResult("beats-4", "beats 4", { completed: true, riskScore: 0, wordRatio: 1, costUsd: 0.1, reasons: ["clean"] }),
        ]),
        failedRun("missing-summary"),
      ],
    })

    expect(report.totals.matrixRuns).toBe(2)
    expect(report.totals.reportedMatrices).toBe(1)
    expect(report.totals.failedMatrices).toBe(1)
    expect(report.variants).toHaveLength(1)
    expect(renderCohortReport(report)).toContain("missing-summary r1: failed")
  })
})

function matrixRun(sourceNovelId: string, variants: MatrixVariantResult[], chapters = 2): CohortMatrixRun {
  return {
    sourceNovelId,
    replicate: 1,
    status: "reported",
    outputBase: `/tmp/${sourceNovelId}`,
    command: [],
    stdoutPath: null,
    stderrPath: null,
    summaryPath: `/tmp/${sourceNovelId}/summary.json`,
    reportPath: `/tmp/${sourceNovelId}/report.md`,
    error: null,
    matrix: {
      sourceNovelId,
      chapters,
      variants,
    } as unknown as SemanticGateMatrixReport,
  }
}

function failedRun(sourceNovelId: string): CohortMatrixRun {
  return {
    sourceNovelId,
    replicate: 1,
    status: "failed",
    outputBase: `/tmp/${sourceNovelId}`,
    command: [],
    stdoutPath: null,
    stderrPath: null,
    summaryPath: `/tmp/${sourceNovelId}/summary.json`,
    reportPath: `/tmp/${sourceNovelId}/report.md`,
    error: "summary.json not found",
    matrix: null,
  }
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
      completed: overrides.completed ?? false,
      approvedChapters: overrides.approvedChapters ?? 0,
      requestedChapters: overrides.requestedChapters ?? 2,
      terminalStatus: overrides.terminalStatus ?? "completed",
      totalWords: overrides.totalWords ?? 0,
      draftedTargetWords: overrides.draftedTargetWords ?? 0,
      wordRatio: overrides.wordRatio ?? null,
      meanChapterWordRatio: overrides.meanChapterWordRatio ?? null,
      semanticSignals: overrides.semanticSignals ?? {},
      pendingPlanAssistGate: overrides.pendingPlanAssistGate ?? false,
      proposalCount: overrides.proposalCount ?? 0,
      actionCount: overrides.actionCount ?? 0,
      llmCalls: overrides.llmCalls ?? 10,
      failedLlmCalls: overrides.failedLlmCalls ?? 0,
      costUsd: overrides.costUsd ?? 0,
      riskScore: overrides.riskScore ?? 0,
      riskBreakdown: overrides.riskBreakdown ?? [],
      reasons: overrides.reasons ?? ["clean"],
    },
  }
}
