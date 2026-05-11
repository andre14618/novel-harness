import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildDraftingRunComparisonReport,
  readDraftingRunRef,
  renderDraftingRunComparisonReport,
} from "./drafting-run-compare"
import type { SceneSemanticReplayReport } from "../evals/scene-semantic-review"

describe("drafting-run-compare", () => {
  test("compares separate drafting-isolated reports and preserves semantic trace ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-run-compare-"))
    try {
      const baselineSceneDir = join(dir, "baseline-scene")
      const candidateSceneDir = join(dir, "candidate-scene")
      const baselineContextDir = join(dir, "baseline-context")
      const candidateContextDir = join(dir, "candidate-context")
      writeSceneReport(baselineSceneDir, sceneReport("baseline", [
        semanticRow("endpointLanding", "ENDPOINT-2", 2, {
          obligationIds: ["obl-file"],
          relevantWorldFactIds: ["fact-foreman"],
        }),
      ]))
      writeSceneReport(candidateSceneDir, sceneReport("candidate", [
        semanticRow("endpointLanding", "ENDPOINT-1", 1, {
          obligationIds: ["obl-file"],
          relevantWorldFactIds: ["fact-foreman", "fact-seal"],
          relevantCharacterIds: ["char-maren"],
          missingForNextLevel: "Needs the endpoint action to land on the page.",
        }),
      ]))
      writeContextReport(baselineContextDir, {
        maxScenesPerChapter: 4,
        minTargetWordsPerScene: 450,
        overloadedChapterCount: 0,
        missingCharacterIds: 0,
      })
      writeContextReport(candidateContextDir, {
        maxScenesPerChapter: 4,
        minTargetWordsPerScene: 450,
        overloadedChapterCount: 0,
        missingCharacterIds: 2,
      })

      const baselineReport = join(dir, "baseline-report.json")
      const candidateReport = join(dir, "candidate-report.json")
      writeRunReport(baselineReport, {
        targetPrefix: "baseline-run",
        arm: "drafting-brief-v1",
        novelId: "baseline-novel",
        totalWords: 4000,
        totalTarget: 3000,
        meanRatio: 1.333,
        sceneOutputDir: baselineSceneDir,
        contextOutputDir: baselineContextDir,
        sceneLowRows: 0,
        missingReadiness: 0,
      })
      writeRunReport(candidateReport, {
        targetPrefix: "candidate-run",
        arm: "drafting-brief-tight-v1",
        novelId: "candidate-novel",
        totalWords: 3400,
        totalTarget: 3000,
        meanRatio: 1.133,
        sceneOutputDir: candidateSceneDir,
        contextOutputDir: candidateContextDir,
        sceneLowRows: 1,
        missingReadiness: 0,
      })

      const report = buildDraftingRunComparisonReport({
        baseline: readDraftingRunRef(baselineReport),
        candidates: [readDraftingRunRef(candidateReport)],
        generatedAt: "2026-05-11T00:00:00.000Z",
      })

      const comparison = report.comparisons[0]!
      expect(comparison.signal).toBe("regressed")
      expect(comparison.length.totalWordsDelta).toBe(-600)
      expect(comparison.sceneSemantic.lowRowsDelta).toBe(1)
      expect(comparison.sceneSemantic.comparisonVerdict).toBe("regressed")
      expect(comparison.planningContext.missingCharacterIdsDelta).toBe(2)
      expect(comparison.reasons).toContain("Length improved while semantic evidence regressed; treat the candidate as source-sensitive rather than a default candidate.")
      expect(comparison.sceneSemantic.changedRows[0]?.traceIds.relevantWorldFactIds).toEqual(["fact-foreman", "fact-seal"])
      expect(comparison.sceneSemantic.changedRows[0]?.traceIds.relevantCharacterIds).toEqual(["char-maren"])

      const rendered = renderDraftingRunComparisonReport(report)
      expect(rendered).toContain("Signal: regressed")
      expect(rendered).toContain("ids=obligations:obl-file; characters:char-maren; worldFacts:fact-foreman,fact-seal")
      expect(rendered).toContain("Length improved while semantic evidence regressed")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("selects an explicitly requested arm from a multi-arm report", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-run-compare-arm-"))
    try {
      const reportPath = join(dir, "multi-report.json")
      writeFileSync(reportPath, `${JSON.stringify({
        v: "drafting-isolated-report-v1",
        source: "source",
        targetPrefix: "multi",
        sourceAssessment: { clean: true, issue: null },
        results: [
          arm({ arm: "baseline", novelId: "multi-baseline", totalWords: 3000, meanRatio: 1 }),
          arm({ arm: "drafting-brief-v1", novelId: "multi-brief", totalWords: 2800, meanRatio: 0.93 }),
        ],
      }, null, 2)}\n`)

      expect(readDraftingRunRef(reportPath).summary.arm).toBe("baseline")
      expect(readDraftingRunRef(reportPath, "drafting-brief-v1").summary.novelId).toBe("multi-brief")
      expect(() => readDraftingRunRef(reportPath, "missing-arm")).toThrow(/arm missing-arm not found/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("does not call a shorter candidate promising without aligned scene semantics", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-run-compare-incomplete-"))
    try {
      const baselineReport = join(dir, "baseline-report.json")
      const candidateReport = join(dir, "candidate-report.json")
      writeFileSync(baselineReport, `${JSON.stringify({
        v: "drafting-isolated-report-v1",
        source: "source",
        targetPrefix: "baseline",
        sourceAssessment: { clean: true, issue: null },
        results: [arm({ arm: "drafting-brief-v1", totalWords: 4000, totalTarget: 3000, meanRatio: 1.33 })],
      }, null, 2)}\n`)
      writeFileSync(candidateReport, `${JSON.stringify({
        v: "drafting-isolated-report-v1",
        source: "source",
        targetPrefix: "candidate",
        sourceAssessment: { clean: true, issue: null },
        results: [arm({ arm: "drafting-brief-tight-v1", totalWords: 3300, totalTarget: 3000, meanRatio: 1.1 })],
      }, null, 2)}\n`)

      const report = buildDraftingRunComparisonReport({
        baseline: readDraftingRunRef(baselineReport),
        candidates: [readDraftingRunRef(candidateReport)],
      })

      expect(report.comparisons[0]?.signal).toBe("incomplete")
      expect(report.comparisons[0]?.reasons.join("\n")).toContain("Aligned scene-semantic comparison was unavailable")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function writeRunReport(path: string, opts: {
  targetPrefix: string
  arm: string
  novelId: string
  totalWords: number
  totalTarget: number
  meanRatio: number
  sceneOutputDir: string
  contextOutputDir: string
  sceneLowRows: number
  missingReadiness: number
}): void {
  writeFileSync(path, `${JSON.stringify({
    v: "drafting-isolated-report-v1",
    source: "source-novel",
    targetPrefix: opts.targetPrefix,
    sourceAssessment: { clean: true, issue: null },
    results: [arm({
      arm: opts.arm,
      novelId: opts.novelId,
      totalWords: opts.totalWords,
      totalTarget: opts.totalTarget,
      meanRatio: opts.meanRatio,
      sceneSemantic: {
        outputDir: opts.sceneOutputDir,
        taskCount: 1,
        skipCount: 0,
        lowRows: opts.sceneLowRows,
        errorRows: 0,
        dimensions: [{
          dimension: "endpointLanding",
          count: 1,
          meanOrdinal: opts.sceneLowRows > 0 ? 1 : 2,
          lowCount: opts.sceneLowRows,
          labelCounts: opts.sceneLowRows > 0 ? { "ENDPOINT-1": 1 } : { "ENDPOINT-2": 1 },
        }],
      },
      planningContext: {
        outputDir: opts.contextOutputDir,
        surfaceCount: 11,
        gapCount: 0,
        readiness: {
          groupCount: opts.missingReadiness,
          findingCount: opts.missingReadiness,
          labels: {},
        },
        gaps: [],
      },
    })],
  }, null, 2)}\n`)
}

function arm(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    arm: "baseline",
    novelId: "novel",
    totalWords: 3000,
    totalTarget: 3000,
    meanRatio: 1,
    expansionEvents: 0,
    draftingBrief: {
      events: 1,
      enabledEvents: 1,
      modes: { "scene-budget-v1": 1 },
      avgCharsRatio: 1,
      avgSelectedPromptChars: 7000,
      avgFullContextPromptChars: 7000,
      totalCharsDelta: 0,
    },
    ...overrides,
  }
}

function writeSceneReport(outputDir: string, report: SceneSemanticReplayReport): void {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "scene-semantic-review.json"), `${JSON.stringify(report, null, 2)}\n`)
}

function writeContextReport(outputDir: string, opts: {
  maxScenesPerChapter: number
  minTargetWordsPerScene: number
  overloadedChapterCount: number
  missingCharacterIds: number
}): void {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "planning-drafting-context-report.json"), `${JSON.stringify({
    upstream: {
      sceneLoad: {
        maxScenesPerChapter: opts.maxScenesPerChapter,
        minTargetWordsPerScene: opts.minTargetWordsPerScene,
        denseChapterCount: 0,
        overloadedChapterCount: opts.overloadedChapterCount,
      },
    },
    downstream: {
      events: 1,
      missingCharacterIds: opts.missingCharacterIds,
      withResolvedReferences: 0,
      referenceLookups: 0,
    },
  }, null, 2)}\n`)
}

function sceneReport(setName: string, results: SceneSemanticReplayReport["results"]): SceneSemanticReplayReport {
  return {
    generatedAt: "2026-05-11T00:00:00.000Z",
    novelId: "novel",
    setName,
    chapters: [1],
    live: true,
    model: "deepseek-v4-flash",
    thinking: true,
    promptMode: "evidence-first",
    dimensions: [...new Set(results.map(row => row.dimension))],
    taskCount: results.length,
    skipCount: 0,
    results,
    skips: [],
    summaries: [],
  }
}

function semanticRow(
  dimension: "endpointLanding",
  label: string,
  ordinal: number,
  overrides: Partial<SceneSemanticReplayReport["results"][number]> = {},
): SceneSemanticReplayReport["results"][number] {
  return {
    taskId: `scene-1-${dimension}`,
    chapterNumber: 1,
    sceneIndex: 0,
    sceneId: "scene-1",
    dimension,
    promptMode: "evidence-first",
    proseSource: "scene_writer_call",
    excerpt: "excerpt",
    obligationIds: [],
    relevantCharacterIds: [],
    relevantWorldFactIds: [],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [],
    label,
    ordinal,
    confidence: 0.9,
    evidenceFields: 3,
    missingForNextLevel: "",
    output: {
      label,
      confidence: 0.9,
      evidence: { strength: "x", weakness: "y", cue: "z" },
      missingForNextLevel: "",
      gates: {},
    },
    ...overrides,
  }
}
