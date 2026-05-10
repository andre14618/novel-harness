import { expect, test } from "bun:test"
import { buildFindingsMarkdown, buildReviewSummary, computeDiagnosticStats, computeReviewStats, proseWordCount } from "./render-html"

function chapter(overrides: Record<string, unknown> = {}) {
  return {
    chapterNumber: 1,
    prose: "# Chapter 1: Test\n\n*POV: A*\n*Setting: B*\n*Word count: 123 (target 200)*\n\none two three",
    trace: null,
    diagnostics: null,
    contracts: {
      targetWords: 200,
      scenes: [
        {
          sceneId: "scene-1",
          beatId: null,
          povPersonalStake: "stakes",
          contract: {
            goal: "goal",
            opposition: "opposition",
            turningPoint: "turn",
            crisisChoice: "",
            choiceAlternatives: [],
            outcome: "outcome",
            consequence: "consequence",
            valueIn: "stable",
            valueOut: "unstable",
          },
          obligations: {
            mustEstablish: [
              {
                text: "fact",
                obligationId: "obl-1",
                sourceId: "src-1",
                characterId: "char-1",
                threadId: "thread-1",
                promiseId: "promise-1",
              },
            ],
          },
        },
      ],
      ...overrides,
    },
  }
}

function diagnosedChapter() {
  return chapter({
    title: "Test",
  }) as any
}

test("uses captured prose word count instead of markdown header words", () => {
  expect(proseWordCount(chapter())).toBe(123)
})

test("computes precise scene-contract and traceability coverage", () => {
  const stats = computeReviewStats([chapter()])

  expect(stats.totalScenes).toBe(1)
  expect(stats.anyContractFieldScenes).toBe(1)
  expect(stats.coreContractFieldScenes).toBe(1)
  expect(stats.choiceAlternativeScenes).toBe(0)
  expect(stats.sceneIds).toBe(1)
  expect(stats.beatIds).toBe(0)
  expect(stats.obligationIds).toBe(1)
  expect(stats.sourceIds).toBe(1)
  expect(stats.characterIds).toBe(1)
  expect(stats.threadIds).toBe(1)
  expect(stats.promiseIds).toBe(1)
  expect(stats.payoffIds).toBe(0)
  expect(stats.proseWords).toBe(123)
  expect(stats.targetWords).toBe(200)
})

test("computes diagnostic coverage from optional post-hoc judge files", () => {
  const ch = diagnosedChapter()
  ch.diagnostics = {
    endpointLanding: { arrived: 2 },
    endpointLandingError: null,
    scenes: [
      {
        sceneDramaturgy: {
          value_shift: 3,
          conflict_visible: true,
          decision_or_revelation: false,
        },
        sceneDramaturgyError: null,
        characterAgency: { agency: 2 },
        characterAgencyError: null,
      },
      {
        sceneDramaturgy: null,
        sceneDramaturgyError: "bad JSON",
        characterAgency: null,
        characterAgencyError: "timeout",
      },
    ],
  }

  const stats = computeDiagnosticStats([ch])

  expect(stats.endpointJudged).toBe(1)
  expect(stats.endpointScores).toEqual([2])
  expect(stats.sceneDramaturgyJudged).toBe(1)
  expect(stats.sceneDramaturgyErrors).toBe(1)
  expect(stats.sceneValueShiftAverage).toBe(3)
  expect(stats.conflictVisibleScenes).toBe(1)
  expect(stats.decisionOrRevelationScenes).toBe(0)
  expect(stats.characterAgencyJudged).toBe(1)
  expect(stats.characterAgencyErrors).toBe(1)
  expect(stats.characterAgencyAverage).toBe(2)
})

test("builds reader-visible findings with L102 planner-scope framing", () => {
  const summary = buildReviewSummary(
    "run-1",
    {
      profile: "P3-pre-resolved",
      fixturePath: "fixture.json",
      chaptersRequested: 1,
      pipelineOverrides: {
        scenePlanContractV1: true,
        sceneCallWriterV1: true,
      },
    },
    [chapter()],
  )
  const markdown = buildFindingsMarkdown(summary)

  expect(markdown).toContain("P3-pre-resolved")
  expect(markdown).toContain("Word-count finding (L102)")
  expect(markdown).toContain("planner-scope scene/chapter-load finding")
  expect(markdown).toContain("production defaults stayed untouched")
  expect(markdown).toContain("review-summary.json")
})
