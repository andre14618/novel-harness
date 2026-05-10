import { expect, test } from "bun:test"
import { computeReviewStats, proseWordCount } from "./render-html"

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
