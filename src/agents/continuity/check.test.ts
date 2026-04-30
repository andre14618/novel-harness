import { expect, test } from "bun:test"

import { buildStateUserPrompt, stateViolationToIssue } from "./check"
import type { ChapterOutline, CharacterState } from "../../types"

test("state prompt includes current plan and frames prior locations as starting context", () => {
  const prompt = buildStateUserPrompt(
    "Aldric stood in his study while Wren drew on the infirmary floor.",
    [characterState({ characterId: "char_aldric", location: "The Chancel Infirmary" })],
    outline(),
  )

  expect(prompt).toContain("CURRENT CHAPTER PLAN")
  expect(prompt).toContain('Chapter 2: "The Echo Chamber"')
  expect(prompt).toContain("Setting: The Chancel Infirmary and the High Ward")
  expect(prompt).toContain("Aldric Vane: location=His study in the High Ward")
  expect(prompt).toContain("starting context, not an immovable location requirement")
})

test("prior-state location violations are warning-class even when the model asks for blocker", () => {
  const issue = stateViolationToIssue({
    character: "aldric",
    type: "location",
    severity: "blocker",
    evidence: "Aldric stood in his study.",
    reasoning: "Previous state had Aldric at the infirmary.",
  })

  expect(issue.severity).toBe("warning")
})

test("knowledge violations remain blocker-class by default", () => {
  const issue = stateViolationToIssue({
    character: "wren",
    type: "knowledge",
    evidence: "Wren named the hidden culprit.",
    reasoning: "Wren acts on information she has not learned.",
  })

  expect(issue.severity).toBe("blocker")
})

function characterState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    characterId: "char_wren",
    chapterNumber: 1,
    location: "The Chancel Infirmary",
    emotionalState: "calm",
    knows: [],
    doesNotKnow: [],
    ...overrides,
  }
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 2,
    title: "The Echo Chamber",
    povCharacter: "Istra Vayne",
    setting: "The Chancel Infirmary and the High Ward",
    purpose: "Show the echo spreading and Aldric forcing production.",
    targetWords: 3000,
    charactersPresent: ["Istra Vayne", "Aldric Vane", "Wren"],
    scenes: [
      {
        kind: "dialogue",
        description: "Aldric welcomes Istra into his study in the High Ward.",
        characters: ["Aldric Vane", "Istra Vayne"],
        requiredPayoffs: [],
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ],
    establishedFacts: [],
    characterStateChanges: [
      {
        name: "Aldric Vane",
        location: "His study in the High Ward",
        emotionalState: "desperate and authoritative",
        knows: ["Istra has reported echoing side effects"],
        doesNotKnow: ["Istra's decision to resist"],
      },
    ],
    knowledgeChanges: [],
    ...overrides,
  }
}
