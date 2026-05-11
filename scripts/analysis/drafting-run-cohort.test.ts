import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildDraftingRunCohortReport,
  loadDraftingRunComparisonReportRef,
  renderDraftingRunCohortReport,
} from "./drafting-run-cohort"
import type { DraftingRunComparisonReport } from "./drafting-run-compare"

describe("drafting-run-cohort", () => {
  test("aggregates clean-source comparison reports by signal, semantic dimension, and context delta", () => {
    const report = buildDraftingRunCohortReport({
      refs: [
        { path: "lit.json", report: comparisonReport("lit", "promising", -500, 0, 0, 2, "improved", 3, 80, 2, 3) },
        { path: "corso.json", report: comparisonReport("corso", "regressed", 224, 4, 3, 0, "regressed", -1, -30, -1, -2) },
      ],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(report.comparisonCount).toBe(2)
    expect(report.cleanComparisonCount).toBe(2)
    expect(report.evidenceComparisonCount).toBe(2)
    expect(report.signal).toBe("regressed")
    expect(report.cleanSignalCounts).toEqual({ promising: 1, regressed: 1 })
    expect(report.aggregate.meanWordsDelta).toBe(-138)
    expect(report.aggregate.sceneLowDeltaSum).toBe(4)
    expect(report.aggregate.contextDeltas.canonSourceRefs).toBe(2)
    expect(report.aggregate.contextDeltas.storyRefIds).toBe(2)
    expect(report.aggregate.contextDeltas.readerInfoStateChars).toBe(50)
    expect(report.aggregate.contextDeltas.referenceAttemptScenes).toBe(1)
    expect(report.aggregate.contextDeltas.referenceAttemptEvents).toBe(1)
    expect(report.aggregate.checkerBlockerDeltaSum).toBe(0)
    expect(report.aggregate.checkerNegativeDeltaSum).toBe(0)
    expect(report.alignment.qualityMovementCounts).toEqual({ improved: 1, regressed: 1 })
    expect(report.alignment.contextLoadMovementCounts).toEqual({ contracted: 1, expanded: 1 })
    expect(report.alignment.contextQualityAlignmentCounts).toEqual({
      "context-contracted-with-quality-regression": 1,
      "quality-gain-with-load-change": 1,
    })
    expect(report.alignment.leanerWithoutQualityLoss).toBe(0)
    expect(report.alignment.contextContractedWithQualityRegression).toBe(1)
    expect(report.pairs[0]).toMatchObject({
      canonSourceRefsDelta: 2,
      storyRefIdsDelta: 3,
      readerInfoStateCharsDelta: 80,
      qualityMovement: "improved",
      contextLoadMovement: "expanded",
      contextQualityAlignment: "quality-gain-with-load-change",
      referenceAttemptSceneDelta: 2,
      referenceAttemptEventDelta: 3,
    })
    expect(report.dimensions.find(row => row.dimension === "endpointLanding")).toMatchObject({
      comparisons: 2,
      lowDeltaSum: 3,
      regressedLowRows: 3,
    })
    expect(report.semanticRowExamples.regressions[0]).toMatchObject({
      source: "corso",
      dimension: "endpointLanding",
      status: "regressed_low",
      baselineLabel: "ENDPOINT-3",
      candidateLabel: "ENDPOINT-1",
    })

    const rendered = renderDraftingRunCohortReport(report)
    expect(rendered).toContain("Signal: regressed")
    expect(rendered).toContain("quality movement: improved: 1, regressed: 1")
    expect(rendered).toContain("context load movement: contracted: 1, expanded: 1")
    expect(rendered).toContain("context contracted with quality regression: 1")
    expect(rendered).toContain("canonSourceRefs=+2")
    expect(rendered).toContain("storyRefs=+2")
    expect(rendered).toContain("readerChars=+50")
    expect(rendered).toContain("refAttemptScenes=+1")
    expect(rendered).toContain("refAttemptEvents=+1")
    expect(rendered).toContain("manual readiness deltas: planAssist=0, checker=0, checkerBlockers=0, checkerWarnings=0, checkerNegative=0, checkerPositive=0, checkerAmbiguous=0, checkerLowConfidence=0")
    expect(rendered).toContain("| endpointLanding | 2 |")
    expect(rendered).toContain("## Semantic Row Examples")
    expect(rendered).toContain("Advisory examples for manual review")
    expect(rendered).toContain("corso ch1 corso-scene endpointLanding: ENDPOINT-3 -> ENDPOINT-1 (-2; regressed_low); ids=obligations:obl-corso; characters:char-corso; worldFacts:fact-corso; sources:source-corso")
    expect(rendered).toContain("Comparisons: 2 (2 clean-source, 2 evidence-comparable)")
    expect(rendered).toContain("| Source | Baseline | Candidate | Clean | Signal | Quality | Context Load | Alignment | Words | Scene Lows | Checker Blockers | Canon Refs | Story Refs | Reader | Reader Chars | Ref Attempt Scenes | Ref Attempt Events | Missing Chars |")
    expect(rendered).toContain("| corso | drafting-brief-v1 | drafting-brief-tight-v1 | yes | regressed | regressed | contracted | context-contracted-with-quality-regression | +224 | +4 | 0 | 0 | -1 | 0 | -30 | -1 | -2 | 0 |")
  })

  test("loads comparison JSON artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-run-cohort-"))
    try {
      const path = join(dir, "comparison.json")
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, `${JSON.stringify(comparisonReport("novel", "mixed", -100, 0, 0, 1, "mixed"), null, 2)}\n`)
      expect(loadDraftingRunComparisonReportRef(path).report.comparisons[0]?.signal).toBe("mixed")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("renders missing context deltas as unavailable instead of zero", () => {
    const legacy = comparisonReport("legacy", "mixed", 0, 0, 0, 1, "mixed") as unknown as {
      comparisons: Array<{ planningContext: Record<string, unknown> }>
    } & DraftingRunComparisonReport
    delete legacy.comparisons[0]!.planningContext.storyRefIdsDelta
    delete legacy.comparisons[0]!.planningContext.readerInfoStateCharsDelta

    const report = buildDraftingRunCohortReport({
      refs: [{ path: "legacy.json", report: legacy }],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(report.aggregate.contextDeltas.canonSourceRefs).toBe(1)
    expect(report.aggregate.contextDeltas.storyRefIds).toBeNull()
    expect(report.aggregate.contextDeltas.readerInfoStateChars).toBeNull()

    const rendered = renderDraftingRunCohortReport(report)
    expect(rendered).toContain("canonSourceRefs=+1")
    expect(rendered).toContain("storyRefs=n/a")
    expect(rendered).toContain("readerChars=n/a")
    expect(rendered).toContain("context expanded without clear quality gain: 1")
    expect(rendered).toContain("| legacy | drafting-brief-v1 | drafting-brief-tight-v1 | yes | mixed | mixed | expanded | context-expanded-without-clear-quality-gain | 0 | 0 | 0 | +1 | n/a | 0 | n/a | 0 | 0 | 0 |")
  })

  test("excludes incomplete clean comparisons from aggregate evidence while preserving rows", () => {
    const report = buildDraftingRunCohortReport({
      refs: [
        { path: "complete.json", report: comparisonReport("complete", "mixed", -120, -1, -1, 2, "mixed") },
        { path: "gated.json", report: incompleteComparisonReport("gated") },
      ],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(report.comparisonCount).toBe(2)
    expect(report.cleanComparisonCount).toBe(2)
    expect(report.evidenceComparisonCount).toBe(1)
    expect(report.cleanSignalCounts).toEqual({ incomplete: 1, mixed: 1 })
    expect(report.signal).toBe("mixed")
    expect(report.aggregate.meanWordsDelta).toBe(-120)
    expect(report.aggregate.sceneLowDeltaSum).toBe(-1)
    expect(report.aggregate.contextDeltas.canonSourceRefs).toBe(2)
    expect(report.alignment.qualityMovementCounts).toEqual({ improved: 1 })
    expect(report.alignment.missingSemanticEvidence).toBe(0)
    expect(report.semanticRowExamples.resolutions[0]).toMatchObject({
      source: "complete",
      status: "resolved_low",
      candidateLabel: "ENDPOINT-2",
    })

    const rendered = renderDraftingRunCohortReport(report)
    expect(rendered).toContain("Comparisons: 2 (2 clean-source, 1 evidence-comparable)")
    expect(rendered).toContain("complete ch1 complete-scene endpointLanding: ENDPOINT-1 -> ENDPOINT-2 (+1; resolved_low)")
    expect(rendered).toContain("| gated | drafting-brief-v1 | drafting-brief-tight-v1 | yes | incomplete | incomplete | expanded | needs-semantic-evidence | n/a | n/a | n/a | +14 | 0 | +9 | +5886 | 0 | 0 | +6 |")
  })
})

function comparisonReport(
  source: string,
  signal: "promising" | "regressed" | "mixed",
  totalWordsDelta: number,
  sceneLowDelta: number,
  endpointLowDelta: number,
  canonSourceRefsDelta: number,
  verdict: "improved" | "regressed" | "mixed",
  storyRefIdsDelta = 0,
  readerInfoStateCharsDelta = 0,
  referenceAttemptSceneDelta = 0,
  referenceAttemptEventDelta = 0,
): DraftingRunComparisonReport {
  return {
    generatedAt: "2026-05-11T00:00:00.000Z",
    baseline: {
      reportPath: `${source}-baseline.json`,
      source,
      targetPrefix: `${source}-baseline`,
      arm: "drafting-brief-v1",
      novelId: `${source}-baseline-novel`,
      cleanSource: true,
      sourceIssue: null,
      totalWords: 4000,
      totalTarget: 3000,
      meanRatio: 1.33,
      error: null,
      draftingBrief: null,
      planningContext: null,
      manualReadiness: manualReadiness(),
      proseSemantic: null,
      sceneSemantic: null,
    },
    comparisons: [{
      candidate: {
        reportPath: `${source}-candidate.json`,
        source,
        targetPrefix: `${source}-candidate`,
        arm: "drafting-brief-tight-v1",
        novelId: `${source}-candidate-novel`,
        cleanSource: true,
        sourceIssue: null,
        totalWords: 4000 + totalWordsDelta,
        totalTarget: 3000,
        meanRatio: 1.33 + totalWordsDelta / 3000,
        error: null,
        draftingBrief: null,
        planningContext: null,
        manualReadiness: manualReadiness(),
        proseSemantic: null,
        sceneSemantic: null,
      },
      signal,
      reasons: [],
      length: {
        totalWordsDelta,
        meanRatioDelta: totalWordsDelta / 3000,
        targetWordsDelta: 0,
      },
      prompt: {
        avgCharsRatioDelta: null,
        avgSelectedPromptCharsDelta: null,
        totalCharsDeltaDelta: null,
      },
      planningContext: {
        gapDelta: 0,
        readinessFindingDelta: 0,
        characterContextDelta: 0,
        worldContextDelta: 0,
        canonFactContextDelta: 0,
        factContinuityAnchorDelta: 0,
        canonSourceRefsDelta,
        storyContextDelta: 0,
        storyRefIdsDelta,
        readerInfoStateDelta: 0,
        readerInfoStateCharsDelta,
        missingCharacterIdsDelta: 0,
        resolvedReferencesDelta: 0,
        referenceAttemptSceneDelta,
        referenceAttemptEventDelta,
        overloadedChapterDelta: 0,
        minTargetWordsPerSceneDelta: 0,
      },
      manualReadiness: {
        planAssistFindingDelta: 0,
        planAssistExhaustionRowsDelta: 0,
        planAssistPendingRowsDelta: 0,
        checkerFindingDelta: 0,
        checkerItemDelta: 0,
        checkerBlockerDelta: 0,
        checkerWarningDelta: 0,
        checkerNegativeDelta: 0,
        checkerPositiveDelta: 0,
        checkerAmbiguousDelta: 0,
        checkerLowConfidenceDelta: 0,
      },
      proseSemantic: {
        lowRowsDelta: 0,
        errorRowsDelta: 0,
      },
      sceneSemantic: {
        lowRowsDelta: sceneLowDelta,
        errorRowsDelta: 0,
        comparisonVerdict: verdict,
        comparedRows: 4,
        missingInCandidate: 0,
        missingInBaseline: 0,
        dimensions: [{
          dimension: "endpointLanding",
          meanDelta: endpointLowDelta > 0 ? -0.3 : 0.2,
          lowDelta: endpointLowDelta,
          resolvedLowRows: endpointLowDelta < 0 ? Math.abs(endpointLowDelta) : 0,
          regressedLowRows: endpointLowDelta > 0 ? endpointLowDelta : 0,
          improvedRows: endpointLowDelta <= 0 ? 1 : 0,
          worsenedRows: endpointLowDelta > 0 ? 1 : 0,
        }],
        changedRows: semanticChangedRows(source, endpointLowDelta),
      },
    }],
  }
}

function semanticChangedRows(
  source: string,
  endpointLowDelta: number,
): DraftingRunComparisonReport["comparisons"][number]["sceneSemantic"]["changedRows"] {
  if (endpointLowDelta > 0) {
    return [semanticChangedRow(source, {
      baselineLabel: "ENDPOINT-3",
      candidateLabel: "ENDPOINT-1",
      baselineOrdinal: 3,
      candidateOrdinal: 1,
      ordinalDelta: -2,
      status: "regressed_low",
      candidateMissingForNextLevel: "Needs a concrete final action that changes the scene state.",
    })]
  }
  if (endpointLowDelta < 0) {
    return [semanticChangedRow(source, {
      baselineLabel: "ENDPOINT-1",
      candidateLabel: "ENDPOINT-2",
      baselineOrdinal: 1,
      candidateOrdinal: 2,
      ordinalDelta: 1,
      status: "resolved_low",
      candidateMissingForNextLevel: "Needs a stronger hook to reach the highest endpoint level.",
    })]
  }
  return []
}

function semanticChangedRow(
  source: string,
  overrides: Partial<DraftingRunComparisonReport["comparisons"][number]["sceneSemantic"]["changedRows"][number]>,
): DraftingRunComparisonReport["comparisons"][number]["sceneSemantic"]["changedRows"][number] {
  const traceIds = {
    obligationIds: [`obl-${source}`],
    relevantCharacterIds: [`char-${source}`],
    relevantWorldFactIds: [`fact-${source}`],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [`source-${source}`],
  }
  return {
    key: `${source}:endpoint`,
    chapterNumber: 1,
    sceneId: `${source}-scene`,
    dimension: "endpointLanding",
    baselineLabel: "ENDPOINT-2",
    candidateLabel: "ENDPOINT-2",
    baselineOrdinal: 2,
    candidateOrdinal: 2,
    ordinalDelta: 0,
    status: "unchanged",
    traceIds,
    baselineTraceIds: traceIds,
    candidateTraceIds: traceIds,
    baselineConfidence: 0.8,
    candidateConfidence: 0.8,
    baselineMissingForNextLevel: "",
    candidateMissingForNextLevel: "",
    ...overrides,
  }
}

function manualReadiness(): DraftingRunComparisonReport["baseline"]["manualReadiness"] {
  return {
    planAssistFindingCount: 0,
    planAssistExhaustionRows: 0,
    planAssistPendingRows: 0,
    checkerFindingCount: 0,
    checkerItems: 0,
    checkerBlockerItems: 0,
    checkerWarningItems: 0,
    checkerNegativeItems: 0,
    checkerPositiveItems: 0,
    checkerAmbiguousItems: 0,
    checkerLowConfidenceItems: 0,
  }
}

function incompleteComparisonReport(source: string): DraftingRunComparisonReport {
  const report = comparisonReport(source, "mixed", 4407, 3, 0, 14, "mixed")
  report.baseline.error = "Pipeline bailed at plan-assist gate"
  report.baseline.totalWords = 0
  report.baseline.totalTarget = 0
  report.baseline.meanRatio = 0
  const comparison = report.comparisons[0]!
  comparison.signal = "incomplete"
  comparison.reasons = ["Baseline arm has error: Pipeline bailed at plan-assist gate"]
  comparison.length = {
    totalWordsDelta: 4407,
    meanRatioDelta: 1.158,
    targetWordsDelta: 3800,
  }
  comparison.planningContext.canonSourceRefsDelta = 14
  comparison.planningContext.readerInfoStateDelta = 9
  comparison.planningContext.readerInfoStateCharsDelta = 5886
  comparison.planningContext.missingCharacterIdsDelta = 6
  comparison.sceneSemantic = {
    lowRowsDelta: 3,
    errorRowsDelta: 1,
    comparisonVerdict: null,
    comparedRows: null,
    missingInCandidate: null,
    missingInBaseline: null,
    dimensions: [],
    changedRows: [],
  }
  return report
}
