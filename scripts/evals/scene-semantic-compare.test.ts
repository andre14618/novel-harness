import { describe, expect, test } from "bun:test"

import {
  buildSceneSemanticComparisonReport,
  renderSceneSemanticComparisonReport,
  type SceneSemanticReportRef,
} from "./scene-semantic-compare"
import type { SceneSemanticReplayReport, SceneSemanticReplayResult } from "./scene-semantic-review"
import type { Dimension } from "./planner-discernment-calibration"

describe("scene-semantic-compare", () => {
  test("aligns rows and summarizes resolved and regressed lows", () => {
    const baseline = reportRef("baseline.json", report("baseline", [
      row("scene-a", "endpointLanding", "ENDPOINT-1", 1),
      row("scene-b", "endpointLanding", "ENDPOINT-3", 3),
      row("scene-a", "characterMateriality", "MATERIAL-2", 2),
    ]))
    const candidate = reportRef("candidate.json", report("candidate", [
      row("scene-a", "endpointLanding", "ENDPOINT-2", 2),
      row("scene-b", "endpointLanding", "ENDPOINT-1", 1),
      row("scene-a", "characterMateriality", "MATERIAL-3", 3),
    ]))

    const comparison = buildSceneSemanticComparisonReport({
      baseline,
      candidates: [candidate],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(comparison.comparisons).toHaveLength(1)
    const result = comparison.comparisons[0]!
    expect(result.verdict).toBe("mixed")
    expect(result.comparedRows).toBe(3)
    const endpoint = result.dimensions.find(row => row.dimension === "endpointLanding")!
    expect(endpoint.resolvedLowRows).toBe(1)
    expect(endpoint.regressedLowRows).toBe(1)
    expect(endpoint.lowDelta).toBe(0)
    const materiality = result.dimensions.find(row => row.dimension === "characterMateriality")!
    expect(materiality.meanDelta).toBe(1)
    expect(result.rowChanges.map(row => row.status).sort()).toEqual([
      "improved",
      "regressed_low",
      "resolved_low",
    ])
    expect(renderSceneSemanticComparisonReport(comparison)).toContain("ENDPOINT-1 -> ENDPOINT-2")
  })

  test("tracks rows missing from either report", () => {
    const baseline = reportRef("baseline.json", report("baseline", [
      row("scene-a", "endpointLanding", "ENDPOINT-1", 1),
      row("scene-b", "sceneDramaturgy", "SCENE-3", 3),
    ]))
    const candidate = reportRef("candidate.json", report("candidate", [
      row("scene-a", "endpointLanding", "ENDPOINT-2", 2),
      row("scene-c", "worldFactPressure", "WFACT-2", 2),
    ]))

    const comparison = buildSceneSemanticComparisonReport({
      baseline,
      candidates: [candidate],
      generatedAt: "2026-05-11T00:00:00.000Z",
    }).comparisons[0]!

    expect(comparison.comparedRows).toBe(1)
    expect(comparison.missingInCandidate).toEqual(["ch1:scene-b:sceneDramaturgy"])
    expect(comparison.missingInBaseline).toEqual(["ch1:scene-c:worldFactPressure"])
    expect(comparison.verdict).toBe("incomplete")
    expect(renderSceneSemanticComparisonReport(buildSceneSemanticComparisonReport({
      baseline,
      candidates: [candidate],
      generatedAt: "2026-05-11T00:00:00.000Z",
    }))).toContain("Verdict: incomplete")
  })
})

function reportRef(path: string, report: SceneSemanticReplayReport): SceneSemanticReportRef {
  return { path, report }
}

function report(setName: string, results: SceneSemanticReplayResult[]): SceneSemanticReplayReport {
  return {
    generatedAt: "2026-05-11T00:00:00.000Z",
    novelId: "novel-a",
    setName,
    chapters: [1],
    live: true,
    model: "deepseek-v4-flash",
    thinking: true,
    promptMode: "evidence-first",
    dimensions: [...new Set(results.map(result => result.dimension))],
    taskCount: results.length,
    skipCount: 0,
    results,
    skips: [],
    summaries: [],
  }
}

function row(sceneId: string, dimension: Dimension, label: string, ordinal: number): SceneSemanticReplayResult {
  return {
    taskId: `${sceneId}-${dimension}`,
    chapterNumber: 1,
    sceneIndex: 0,
    sceneId,
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
      evidence: {},
      missingForNextLevel: "",
      gates: {},
    },
  }
}
