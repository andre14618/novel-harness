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
        withCharacterContext: 1,
        withWorldContext: 1,
        withCanonFactContext: 1,
        canonSourceRefs: 1,
        withFactContinuityAnchors: 0,
        withStoryContext: 1,
        storyRefIds: 1,
        withReaderInfoState: 1,
        readerInfoStateChars: 100,
        withResolvedReferences: 0,
        missingCharacterIds: 0,
        referenceContextAttempts: [
          { eventCount: 1, sceneRef: "scene-a" },
        ],
      })
      writeContextReport(candidateContextDir, {
        maxScenesPerChapter: 4,
        minTargetWordsPerScene: 450,
        overloadedChapterCount: 0,
        withCharacterContext: 1,
        withWorldContext: 1,
        withCanonFactContext: 1,
        canonSourceRefs: 3,
        withFactContinuityAnchors: 1,
        withStoryContext: 1,
        storyRefIds: 3,
        withReaderInfoState: 0,
        readerInfoStateChars: 20,
        withResolvedReferences: 0,
        missingCharacterIds: 2,
        referenceContextAttempts: [
          { eventCount: 2, sceneRef: "scene-a" },
          { eventCount: 1, sceneRef: "scene-b" },
        ],
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
      writeCheckerReadinessSidecar(dir, "baseline-run", "drafting-brief-v1", {
        items: 1,
        blockers: 0,
        warnings: 1,
        findings: 0,
      })
      writeCheckerReadinessSidecar(dir, "candidate-run", "drafting-brief-tight-v1", {
        items: 3,
        blockers: 1,
        warnings: 2,
        findings: 1,
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
      expect(comparison.planningContext.canonSourceRefsDelta).toBe(2)
      expect(comparison.planningContext.factContinuityAnchorDelta).toBe(1)
      expect(comparison.planningContext.storyRefIdsDelta).toBe(2)
      expect(comparison.planningContext.readerInfoStateDelta).toBe(-1)
      expect(comparison.planningContext.readerInfoStateCharsDelta).toBe(-80)
      expect(comparison.planningContext.referenceAttemptSceneDelta).toBe(1)
      expect(comparison.planningContext.referenceAttemptEventDelta).toBe(2)
      expect(comparison.manualReadiness.checkerItemDelta).toBe(2)
      expect(comparison.manualReadiness.checkerBlockerDelta).toBe(1)
      expect(comparison.manualReadiness.checkerWarningDelta).toBe(1)
      expect(comparison.reasons).toContain("Length improved while semantic evidence regressed; treat the candidate as source-sensitive rather than a default candidate.")
      expect(comparison.reasons).toContain("Checker blocker items increased by 1.")
      expect(comparison.sceneSemantic.changedRows[0]?.traceIds.relevantWorldFactIds).toEqual(["fact-foreman", "fact-seal"])
      expect(comparison.sceneSemantic.changedRows[0]?.traceIds.relevantCharacterIds).toEqual(["char-maren"])

      const rendered = renderDraftingRunComparisonReport(report)
      expect(rendered).toContain("Signal: regressed")
      expect(rendered).toContain("Context coverage: character=1 -> 1, world=1 -> 1, canon=1 -> 1 (sourceRefs=1 -> 3, factAnchors=0 -> 1), story=1 -> 1 (storyRefs=1 -> 3), reader=1 -> 0 (chars=100 -> 20), refs=0 -> 0 (lookups=0 -> 0)")
      expect(rendered).toContain("Reference attempts: scenes=1 -> 2, events=1 -> 3")
      expect(rendered).toContain("Manual readiness: planAssist=n/a -> n/a (pending=n/a -> n/a), checker=0 -> 1 (items=1 -> 3, blockers=0 -> 1, warnings=1 -> 2)")
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

  test("renders failed arm comparisons as incomplete without comparable semantic deltas", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-run-compare-failed-arm-"))
    try {
      const baselineReport = join(dir, "baseline-report.json")
      const candidateReport = join(dir, "candidate-report.json")
      writeFileSync(baselineReport, `${JSON.stringify({
        v: "drafting-isolated-report-v1",
        source: "source",
        targetPrefix: "baseline",
        sourceAssessment: { clean: true, issue: null },
        results: [arm({
          arm: "drafting-brief-v1",
          totalWords: 0,
          totalTarget: 0,
          meanRatio: 0,
          error: "Pipeline bailed at plan-assist gate",
          sceneSemantic: {
            outputDir: join(dir, "baseline-scene"),
            taskCount: 0,
            skipCount: 0,
            lowRows: 0,
            errorRows: 1,
            dimensions: [],
          },
        })],
      }, null, 2)}\n`)
      writeFileSync(candidateReport, `${JSON.stringify({
        v: "drafting-isolated-report-v1",
        source: "source",
        targetPrefix: "candidate",
        sourceAssessment: { clean: true, issue: null },
        results: [arm({
          arm: "drafting-brief-tight-v1",
          totalWords: 4407,
          totalTarget: 3800,
          meanRatio: 1.158,
          sceneSemantic: {
            outputDir: join(dir, "candidate-scene"),
            taskCount: 36,
            skipCount: 8,
            lowRows: 3,
            errorRows: 0,
            dimensions: [],
          },
        })],
      }, null, 2)}\n`)

      const report = buildDraftingRunComparisonReport({
        baseline: readDraftingRunRef(baselineReport),
        candidates: [readDraftingRunRef(candidateReport)],
      })
      const comparison = report.comparisons[0]!

      expect(comparison.signal).toBe("incomplete")
      expect(comparison.sceneSemantic.lowRowsDelta).toBe(3)
      expect(comparison.reasons.join("\n")).toContain("Length and semantic deltas are non-comparable")
      expect(comparison.reasons.join("\n")).not.toContain("Candidate is longer")
      expect(comparison.reasons.join("\n")).not.toContain("Scene-semantic lows worsened")

      const rendered = renderDraftingRunComparisonReport(report)
      expect(rendered).toContain("Signal: incomplete")
      expect(rendered).toContain("delta=n/a (failed arm; reported totals may be partial)")
      expect(rendered).toContain("Telemetry: proseLows=n/a, sceneLows=n/a")
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

function writeCheckerReadinessSidecar(root: string, targetPrefix: string, armName: string, counts: {
  items: number
  blockers: number
  warnings: number
  findings: number
}): void {
  const dir = join(root, "output/checker-readiness", targetPrefix, armName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "checker-readiness.json"), `${JSON.stringify({
    generatedAt: "2026-05-11T00:00:00.000Z",
    sourceReports: [`checker-warning-report:${targetPrefix}`],
    labels: counts.findings > 0 ? ["CONTINUITY-BLOCKER"] : [],
    maxOrdinal: 1,
    findingCount: counts.findings,
    groupCount: counts.findings,
    groups: [],
  }, null, 2)}\n`)
  writeFileSync(join(dir, "checker-warning-report.json"), `${JSON.stringify({
    novelId: `${targetPrefix}-${armName}`,
    totalItems: counts.items,
    bySeverity: {
      blocker: counts.blockers,
      warning: counts.warnings,
    },
    byPolarity: { negative: counts.blockers, positive: 0, ambiguous: counts.warnings },
    byCalibration: { standard: counts.items, "low-confidence": 0 },
    chapters: [],
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
  withCharacterContext?: number
  withWorldContext?: number
  withCanonFactContext?: number
  withFactContinuityAnchors?: number
  canonSourceRefs?: number
  withStoryContext?: number
  storyRefIds?: number
  withReaderInfoState?: number
  readerInfoStateChars?: number
  withResolvedReferences?: number
  missingCharacterIds: number
  referenceContextAttempts?: Array<{
    eventCount: number
    sceneRef: string
  }>
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
      withCharacterContext: opts.withCharacterContext ?? 0,
      withWorldContext: opts.withWorldContext ?? 0,
      withCanonFactContext: opts.withCanonFactContext ?? 0,
      withFactContinuityAnchors: opts.withFactContinuityAnchors ?? 0,
      canonSourceRefs: opts.canonSourceRefs ?? 0,
      withStoryContext: opts.withStoryContext ?? 0,
      storyRefIds: opts.storyRefIds ?? 0,
      withReaderInfoState: opts.withReaderInfoState ?? 0,
      readerInfoStateChars: opts.readerInfoStateChars ?? 0,
      missingCharacterIds: opts.missingCharacterIds,
      withResolvedReferences: opts.withResolvedReferences ?? 0,
      referenceLookups: 0,
    },
    referenceContextAttempts: opts.referenceContextAttempts ?? [],
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
