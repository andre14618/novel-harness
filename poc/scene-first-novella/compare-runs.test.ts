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
      choiceAlternativeCount: 22,
      sceneContractPayloadChars: 14000,
      sceneIds: 18,
      beatIds: 0,
      obligationIds: 40,
      sourceIds: 39,
      characterIds: 21,
      threadIds: 7,
      promiseIds: 7,
      payoffIds: 0,
      obligationTypeCounts: {
        mustEstablish: 18,
        mustPayOff: 0,
        mustTransferKnowledge: 14,
        mustShowStateChange: 8,
        mustNotReveal: 0,
        allowedNewEntities: 2,
        loadBearing: 40,
      },
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
    runtimeStats: {
      traceEvents: 90,
      llmCalls: 30,
      writerCalls: 18,
      writerExpansionEvents: 0,
      writerContextEvents: 18,
      contextWithCharacterContext: 18,
      contextWithSceneContract: 11,
      contextWithWorldBible: 18,
      ...(overrides.runtimeStats ?? {}),
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
        choiceAlternativeCount: 16,
        sceneContractPayloadChars: 7600,
        sceneIds: 9,
      obligationIds: 15,
      sourceIds: 15,
      obligationTypeCounts: {
        mustEstablish: 7,
        mustPayOff: 0,
        mustTransferKnowledge: 5,
        mustShowStateChange: 3,
        mustNotReveal: 0,
        allowedNewEntities: 1,
        loadBearing: 15,
      },
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
  expect(markdown).toContain("Scene-contract payload chars")
  expect(markdown).toContain("Obligation type counts")
  expect(markdown).toContain("Writer-expansion events")
  expect(markdown).toContain("Writer context surface")
  expect(markdown).toContain("char 18/18")
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
        obligationTypeCounts: {
          mustEstablish: 6,
          mustPayOff: 0,
          mustTransferKnowledge: 5,
          mustShowStateChange: 3,
          mustNotReveal: 0,
          allowedNewEntities: 0,
          loadBearing: 14,
        },
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

test("labels density-only comparisons when scene count is unchanged", () => {
  const comparison = buildComparison(
    summary({
      runId: "tight",
      reviewStats: {
        totalScenes: 9,
        sceneIds: 9,
        obligationIds: 27,
        obligationTypeCounts: {
          mustEstablish: 13,
          mustPayOff: 0,
          mustTransferKnowledge: 9,
          mustShowStateChange: 5,
          mustNotReveal: 0,
          allowedNewEntities: 3,
          loadBearing: 27,
        },
        proseWords: 8772,
        targetWords: 3900,
      },
    }),
    summary({
      runId: "density-cap",
      reviewStats: {
        totalScenes: 9,
        sceneIds: 9,
        obligationIds: 11,
        obligationTypeCounts: {
          mustEstablish: 5,
          mustPayOff: 0,
          mustTransferKnowledge: 4,
          mustShowStateChange: 2,
          mustNotReveal: 0,
          allowedNewEntities: 0,
          loadBearing: 11,
        },
        proseWords: 6500,
        targetWords: 3900,
      },
      diagnosticStats: {
        endpointScores: [3, 3, 3],
        sceneDramaturgyJudged: 9,
        characterAgencyJudged: 9,
      },
    }),
  )

  expect(comparison.hypothesisVerdicts[0]).toContain("Density isolation")
  expect(comparison.hypothesisVerdicts[1]).toContain("Supported: obligation density fell")
})
