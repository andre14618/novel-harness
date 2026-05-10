import { expect, test } from "bun:test"
import { buildComparison, renderComparisonMarkdown } from "./compare-runs"

function summary(overrides: Record<string, any> = {}) {
  return {
    runId: overrides.runId ?? "run",
    profile: overrides.profile ?? "P3-pre-resolved",
    fixturePath: overrides.fixturePath ?? "fixture.json",
    chaptersRendered: overrides.chaptersRendered ?? 3,
    chaptersRequested: overrides.chaptersRequested ?? 3,
    reviewStats: {
      totalScenes: 18,
      coreContractFieldScenes: 18,
      choiceAlternativeScenes: 11,
      sceneIds: 18,
      beatIds: 0,
      obligationIds: 40,
      sourceIds: 39,
      characterIds: 21,
      threadIds: 7,
      promiseIds: 7,
      payoffIds: 0,
      proseWords: 17817,
      targetWords: 5300,
      ...(overrides.reviewStats ?? {}),
    },
    diagnosticStats: {
      endpointJudged: 3,
      endpointErrors: 0,
      endpointScores: [2, 3, 3],
      sceneDramaturgyJudged: 18,
      sceneDramaturgyErrors: 0,
      sceneValueShiftAverage: 2.28,
      conflictVisibleScenes: 18,
      decisionOrRevelationScenes: 14,
      characterAgencyJudged: 18,
      characterAgencyErrors: 0,
      characterAgencyAverage: 2.61,
      ...(overrides.diagnosticStats ?? {}),
    },
    findings: overrides.findings ?? [],
  }
}

test("builds directional verdicts for improved POC variants", () => {
  const baseline = summary({ runId: "baseline" })
  const variant = summary({
    runId: "variant",
    reviewStats: {
      totalScenes: 9,
      coreContractFieldScenes: 9,
      choiceAlternativeScenes: 8,
      sceneIds: 9,
      obligationIds: 15,
      sourceIds: 15,
      proseWords: 7200,
      targetWords: 3900,
    },
    diagnosticStats: {
      endpointScores: [3, 3, 3],
      sceneDramaturgyJudged: 9,
      characterAgencyJudged: 9,
    },
  })

  const comparison = buildComparison(baseline, variant)
  const markdown = renderComparisonMarkdown(comparison)

  expect(comparison.deltas.totalScenesDelta).toBe(-9)
  expect(comparison.deltas.chapterOneEndpointDelta).toBe(1)
  expect(markdown).toContain("Word overshoot is mainly a planner-scope problem")
  expect(markdown).toContain("Supported: tighter scene count")
  expect(markdown).toContain("Needs another POC loop before promotion")
})

test("marks fully successful variants as production-change candidates", () => {
  const comparison = buildComparison(
    summary({ runId: "baseline" }),
    summary({
      runId: "variant",
      reviewStats: {
        totalScenes: 9,
        coreContractFieldScenes: 9,
        choiceAlternativeScenes: 9,
        sceneIds: 9,
        obligationIds: 14,
        sourceIds: 14,
        proseWords: 5700,
        targetWords: 3900,
      },
      diagnosticStats: {
        endpointScores: [3, 3, 3],
        sceneDramaturgyJudged: 9,
        characterAgencyJudged: 9,
      },
    }),
  )

  expect(comparison.promotionVerdict).toContain("Candidate for a production change packet")
})
