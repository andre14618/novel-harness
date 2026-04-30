import { expect, test } from "bun:test"
import { runFunctionalStoryChecks } from "./functional-checks"
import type { ChapterOutline } from "../types"

test("functional checks pass valid payoff links", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      { description: "Aldric plants a clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "cure", payoff_beat: 1 }] },
      { description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action", requiredPayoffs: [] },
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
})

test("functional checks block payoff links with missing fact ids", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      { description: "Aldric plants a clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "missing", payoff_beat: 1 }] },
      { description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action", requiredPayoffs: [] },
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("missing")
})

test("functional checks block duplicate established fact ids", () => {
  const outline = baseOutline({
    establishedFacts: [
      { id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" },
      { id: "cure", fact: "The apothecary hides the fever cure", category: "knowledge" },
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("duplicated")
})

test("functional checks block payoff links that point backward or to the same beat", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      { description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action", requiredPayoffs: [] },
      { description: "Aldric plants a late clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "cure", payoff_beat: 0 }] },
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("later beat")
})

function baseOutline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    povCharacter: "Aldric",
    setting: "Istra's apothecary",
    purpose: "Test the checks",
    targetWords: 1000,
    charactersPresent: ["Aldric", "Wren"],
    scenes: [
      { description: "Aldric speaks with Wren.", characters: ["Aldric", "Wren"], kind: "dialogue", requiredPayoffs: [] },
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}
