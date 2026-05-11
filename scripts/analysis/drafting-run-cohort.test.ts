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
        { path: "lit.json", report: comparisonReport("lit", "promising", -500, 0, 0, 2, "improved", 3, 80) },
        { path: "corso.json", report: comparisonReport("corso", "regressed", 224, 4, 3, 0, "regressed", -1, -30) },
      ],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(report.comparisonCount).toBe(2)
    expect(report.cleanComparisonCount).toBe(2)
    expect(report.signal).toBe("regressed")
    expect(report.cleanSignalCounts).toEqual({ promising: 1, regressed: 1 })
    expect(report.aggregate.meanWordsDelta).toBe(-138)
    expect(report.aggregate.sceneLowDeltaSum).toBe(4)
    expect(report.aggregate.contextDeltas.canonSourceRefs).toBe(2)
    expect(report.aggregate.contextDeltas.storyRefIds).toBe(2)
    expect(report.aggregate.contextDeltas.readerInfoStateChars).toBe(50)
    expect(report.dimensions.find(row => row.dimension === "endpointLanding")).toMatchObject({
      comparisons: 2,
      lowDeltaSum: 3,
      regressedLowRows: 3,
    })

    const rendered = renderDraftingRunCohortReport(report)
    expect(rendered).toContain("Signal: regressed")
    expect(rendered).toContain("canonSourceRefs=+2")
    expect(rendered).toContain("storyRefs=+2")
    expect(rendered).toContain("readerChars=+50")
    expect(rendered).toContain("| endpointLanding | 2 |")
    expect(rendered).toContain("| corso | drafting-brief-v1 | drafting-brief-tight-v1 | yes | regressed | +224 | +4 | 0 |")
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
        overloadedChapterDelta: 0,
        minTargetWordsPerSceneDelta: 0,
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
        changedRows: [],
      },
    }],
  }
}
